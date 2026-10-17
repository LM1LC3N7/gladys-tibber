// -----------------------------------------------------------------------------
// The integration itself: the homes of the account, the price sensors moved
// at every slot, tomorrow's publication, the hourly consumption fed to the
// energy monitoring, the live measurements of a Pulse, the scene triggers
// and actions, the widgets and the delegated contract. index.js only wires
// the SDK handlers to it.
// -----------------------------------------------------------------------------

import { join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './config.js';
import {
  CONSUMPTION_HOURS,
  CONSUMPTION_INTERVAL,
  LIVE_THROTTLE,
  PRICES_INTERVAL,
  RATE_LIMIT,
  STORE_FILE,
  TOMORROW_FROM,
  TOMORROW_RETRY,
  WIDGETS,
} from './constants.js';
import {
  FEATURE,
  buildHomeDevice,
  dailyStates,
  ids,
  liveStates,
  parseExternalId,
  priceStates,
} from './devices.js';
import { hoursToFetch, intervalCosts, rangeStart, supportsEnergyConsumption } from './energy.js';
import { T } from './i18n.js';
import { PERIODS, cheapestWindowOutputs, priceOutputs } from './scenes.js';
import { TibberClient } from './tibber/api.js';
import { LiveSubscription } from './tibber/live.js';
import {
  dailyTotals,
  halfHours,
  liveOf,
  localClock,
  localDate,
  priceState,
  slotsOf,
} from './tibber/model.js';
import { powerEvents, priceEvents, tomorrowEvent } from './triggers.js';
import { TibberError } from './http.js';
import { Store } from './store.js';
import { liveWidget, pricesWidget } from './widget.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

export class TibberApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'tibber' }),
    now = Date.now,
    timers = defaultTimers,
    clientFactory = (token) => new TibberClient({ token }),
    liveFactory = (options) => new LiveSubscription(options),
    dataDir = process.env.DATA_DIR ?? '/data',
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.clientFactory = clientFactory;
    this.liveFactory = liveFactory;
    this.store = new Store({ filePath: join(dataDir, STORE_FILE), logger });
    this.config = normalizeConfig();
    this.raw = {};
    this.client = undefined;
    /** homeId -> entry { home, slots, price, announced: Set, totals, live, lastLive, lastLiveAt, lastPower, liveConnected, consumptionWarned } */
    this.homes = new Map();
    /** HMAC of the token the homes above were read with (src/store.js). */
    this.homesKey = undefined;
    /** HMAC of the current token. */
    this.tokenKey = undefined;
    /** The current token was refused by Tibber: no call until the configuration is saved. */
    this.refused = false;
    /** End of a 429 pause (ms): no call at all before, on every path. */
    this.pausedUntil = 0;
    this.timerIds = [];
    this.tickTimer = undefined;
    this.tomorrowTimer = undefined;
    this.resumeTimer = undefined;
    this.lastStatus = undefined;
    /** false on a Gladys older than 5.2.0 (no publishEnergyConsumption). */
    this.energySupported = true;
    this.generation = 0;
    this.lifecycle = Promise.resolve();
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * (Re)start with a configuration. `userSaved`: the user saved the
   * configuration (onConfigUpdated), which lifts a refused-token block, even
   * with the same token; a reconnection to Gladys keeps it, and the 429 pause.
   */
  start(raw = {}, { userSaved = false } = {}) {
    return this.serialize(() => this.doStart(raw, { userSaved }));
  }

  stop() {
    return this.serialize(() => this.doStop());
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async doStart(raw, { userSaved = false } = {}) {
    await this.doStop();
    // Gladys keeps the status in memory only: a (re)connection may follow a
    // restart of the core, so the status is published again, never assumed kept.
    this.lastStatus = undefined;
    const generation = ++this.generation;
    this.raw = raw ?? {};
    this.config = normalizeConfig(raw);
    this.client = this.gate(this.clientFactory(this.config.accessToken));
    await this.store.load();
    // A 429 pause survives a restart of the container (kept in /data), never
    // longer than RATE_LIMIT.maxMs from now (a damaged or far value is cut
    // down and written back).
    const saved = Number(this.store.get('meta', 'pausedUntil'));
    if (Number.isFinite(saved) && saved > this.pausedUntil) {
      this.pausedUntil = saved;
    }
    const longest = this.now() + RATE_LIMIT.maxMs;
    if (this.pausedUntil > longest) {
      this.pausedUntil = longest;
      await this.store.set('meta', 'pausedUntil', String(longest));
    }
    if (!this.config.accessToken) {
      this.tokenKey = undefined;
      this.refused = false;
      await this.setStatus(false, T.noToken);
      return;
    }
    this.tokenKey = await this.store.tokenKey(this.config.accessToken);
    if (userSaved && this.store.get('refusals', 'token')) {
      await this.store.set('refusals', 'token', null);
    }
    this.refused = this.store.get('refusals', 'token') === this.tokenKey;
    if (this.refused) {
      // The same token Tibber refused: not sent again until the user saves.
      this.logger.warn('Tibber refused this access token earlier: not tried again');
      await this.setStatus(false, T.badToken);
      await this.publishKnownHomes();
      return;
    }
    if (this.now() < this.pausedUntil) {
      await this.setStatus(this.homes.size > 0, T.paused(this.pausedUntil));
      await this.publishKnownHomes();
      await this.keepTicking();
      this.scheduleResume();
      return;
    }
    await this.checkEnergySupport();
    let discovered = false;
    try {
      await this.discover();
      discovered = true;
      await this.refreshPrices();
      await this.refreshConsumption();
    } catch (err) {
      await this.reportError(err);
      if (!discovered) {
        // Gladys may have restarted: the last homes known stay in Discovery.
        await this.publishKnownHomes();
      }
      if (err instanceof TibberError && (err.code === 'bad_token' || err.code === 'no_token')) {
        return;
      }
      if (err instanceof TibberError && err.code === 'rate_limited' && !discovered) {
        // No home read yet: start again once the pause is over; the prices
        // already known keep moving meanwhile.
        await this.keepTicking();
        this.scheduleResume();
        return;
      }
    }
    if (generation !== this.generation) {
      return;
    }
    this.timerIds.push(
      this.timers.setInterval(
        () => this.refreshPrices().catch((err) => this.reportError(err)),
        PRICES_INTERVAL,
      ),
    );
    this.timerIds.push(
      this.timers.setInterval(
        () => this.refreshConsumption().catch((err) => this.reportError(err)),
        CONSUMPTION_INTERVAL,
      ),
    );
    this.scheduleTick();
    this.startLive();
  }

  async doStop() {
    this.generation += 1;
    for (const id of this.timerIds) {
      this.timers.clearInterval(id);
    }
    this.timerIds = [];
    this.timers.clearTimeout(this.tickTimer);
    this.timers.clearTimeout(this.tomorrowTimer);
    this.timers.clearTimeout(this.resumeTimer);
    this.tickTimer = undefined;
    this.tomorrowTimer = undefined;
    this.resumeTimer = undefined;
    for (const entry of this.homes.values()) {
      entry.live?.stop();
      entry.live = undefined;
    }
  }

  /**
   * During a pause: the prices already known (memory, no call) still follow
   * the slots, the triggers fire and energyCurrent stays right.
   */
  async keepTicking() {
    if (this.homes.size === 0 || this.homesKey !== this.tokenKey) {
      return;
    }
    await this.tick().catch((err) => this.logger.warn(`Tick failed: ${err.message}`));
    this.scheduleTick();
  }

  /** Start again at the end of the 429 pause: never a dead integration. */
  scheduleResume() {
    this.timers.clearTimeout(this.resumeTimer);
    const generation = this.generation;
    this.resumeTimer = this.timers.setTimeout(
      () => {
        this.resumeTimer = undefined;
        if (generation === this.generation) {
          return this.start(this.raw).catch((err) =>
            this.logger.warn(`Restart failed: ${err.message}`),
          );
        }
      },
      // Bounded: above 2^31-1 ms Node would fire at once, in a loop.
      Math.min(RATE_LIMIT.maxMs, Math.max(1000, this.pausedUntil - this.now())),
    );
  }

  /**
   * Every Tibber call goes through here: none during a 429 pause nor with a
   * refused token (no network at all), and their answers set both.
   */
  gate(client) {
    return new Proxy(client, {
      get: (target, prop) => {
        const value = target[prop];
        if (typeof value !== 'function') {
          return value;
        }
        return async (...args) => {
          if (this.refused) {
            throw new TibberError('bad_token', 'Tibber refused the access token');
          }
          if (this.now() < this.pausedUntil) {
            throw new TibberError('rate_limited', 'Tibber asked to slow down (429)');
          }
          try {
            return await value.apply(target, args);
          } catch (err) {
            await this.noteFailure(err);
            throw err;
          }
        };
      },
    });
  }

  async noteFailure(err) {
    if (!(err instanceof TibberError)) {
      return;
    }
    if (err.code === 'rate_limited') {
      const wanted = Number.isFinite(err.retryAfter) ? err.retryAfter * 1000 : RATE_LIMIT.defaultMs;
      const until = this.now() + Math.min(RATE_LIMIT.maxMs, Math.max(RATE_LIMIT.minMs, wanted));
      if (until > this.pausedUntil) {
        this.pausedUntil = until;
        await this.store.set('meta', 'pausedUntil', String(until));
      }
    } else if (err.code === 'bad_token' && this.tokenKey && !this.refused) {
      this.refused = true;
      await this.store.set('refusals', 'token', this.tokenKey);
    }
  }

  /** The Discovery list from the homes last read with this token (none if unknown). */
  async publishKnownHomes() {
    if (this.homes.size === 0 || this.homesKey !== this.tokenKey) {
      return;
    }
    await this.gladys
      .publishDiscoveredDevices(
        [...this.homes.values()].map((e) => buildHomeDevice(this.gladys, e.home)),
      )
      .catch((err) => this.logger.warn(`Publishing the discovered devices failed: ${err.message}`));
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  async reportError(err) {
    this.logger.warn(`Tibber: ${err.message}`);
    if (err instanceof TibberError && err.code === 'bad_token') {
      // Stop every timer and the live sockets: nothing more is sent with it.
      await this.doStop();
      await this.setStatus(false, T.badToken);
      return;
    }
    if (err instanceof TibberError && err.code === 'no_token') {
      await this.setStatus(false, T.noToken);
      return;
    }
    if (err instanceof TibberError && err.code === 'rate_limited') {
      await this.setStatus(this.homes.size > 0, T.paused(this.pausedUntil));
      return;
    }
    await this.setStatus(this.homes.size > 0, T.unreachable(err.message));
  }

  async reportOk() {
    const live = [...this.homes.values()].filter((e) => e.liveConnected).map((e) => e.home.name);
    await this.setStatus(true, T.ok(this.homes.size, live.join(', '), !this.energySupported));
  }

  /**
   * publishEnergyConsumption exists from Gladys 5.2.0. On an older Gladys the
   * consumption is not sent at all (no crash, no request refused every hour)
   * and the status says why; prices, sensors and live power keep working. An
   * unreadable status gives the benefit of the doubt.
   */
  async checkEnergySupport() {
    if (typeof this.gladys.publishEnergyConsumption !== 'function') {
      this.energySupported = false;
    } else {
      try {
        const status = await this.gladys.getStatus();
        this.energySupported = supportsEnergyConsumption(status?.gladys_version);
      } catch (err) {
        this.logger.debug?.(`Gladys version unknown: ${err.message}`);
        this.energySupported = true;
      }
    }
    if (!this.energySupported) {
      this.logger.warn(
        'Gladys is older than 5.2.0: the consumption is not sent to the energy monitoring.',
      );
    }
  }

  // --- Discovery -------------------------------------------------------------------

  async discover() {
    if (this.refused || this.now() < this.pausedUntil) {
      // Scan during a block or a pause: the last known homes, no call.
      await this.publishKnownHomes();
      return;
    }
    const viewer = await this.client.viewer();
    const homes = new Map();
    for (const raw of viewer.homes ?? []) {
      if (raw.currentSubscription?.status && raw.currentSubscription.status !== 'running') {
        this.logger.info(`Home ${raw.id} skipped: subscription ${raw.currentSubscription.status}`);
      }
      const home = {
        id: String(raw.id),
        name: raw.appNickname || raw.address?.address1 || `Home ${raw.id}`,
        timeZone: raw.timeZone || 'Europe/Oslo',
        currency: raw.currentSubscription?.priceInfo?.current?.currency ?? null,
        live: this.config.live && raw.features?.realTimeConsumptionEnabled === true,
      };
      const known = this.homes.get(home.id);
      homes.set(home.id, {
        home,
        slots: known?.slots ?? [],
        price: known?.price,
        announced: known?.announced ?? new Set(),
        totals: known?.totals,
        lastLive: known?.lastLive,
        lastLiveAt: 0,
        lastPower: known?.lastPower ?? null,
        liveConnected: false,
        consumptionWarned: known?.consumptionWarned ?? false,
      });
    }
    this.homes = homes;
    this.homesKey = this.tokenKey;
    if (this.homes.size === 0) {
      await this.setStatus(false, T.noHome);
    }
    await this.gladys.publishDiscoveredDevices(
      [...this.homes.values()].map((e) => buildHomeDevice(this.gladys, e.home)),
    );
  }

  deviceId(homeId) {
    return ids.home(this.gladys, homeId);
  }

  // --- Prices ----------------------------------------------------------------------

  /** True from 12:45 local time: tomorrow's prices may be out. */
  tomorrowDue(timeZone, t = this.now()) {
    const { hour, minute } = localClock(t, timeZone);
    return (
      hour > TOMORROW_FROM.hour || (hour === TOMORROW_FROM.hour && minute >= TOMORROW_FROM.minute)
    );
  }

  async refreshPrices() {
    let failure;
    let tomorrowMissing = false;
    for (const entry of this.homes.values()) {
      try {
        const info = await this.client.prices(entry.home.id);
        entry.slots = slotsOf([
          ...(info.today ?? []),
          ...(info.tomorrow ?? []),
          ...(info.current ? [info.current] : []),
        ]);
        if (entry.slots.length > 0 && !entry.home.currency) {
          entry.home.currency = entry.slots[0].currency;
        }
        const now = this.now();
        const tomorrowDate = localDate(now + 24 * 60 * 60_000, entry.home.timeZone);
        const tomorrow = priceState(entry.slots, now, {
          timeZone: entry.home.timeZone,
          cheapHours: this.config.cheapHours,
        })?.tomorrow;
        if (tomorrow) {
          if (!entry.announced.has(tomorrowDate)) {
            entry.announced.add(tomorrowDate);
            if (entry.price) {
              await this.publishEvent(
                tomorrowEvent(this.deviceId(entry.home.id), tomorrow, this.config.cheapHours),
              );
            }
          }
        } else if (this.tomorrowDue(entry.home.timeZone)) {
          tomorrowMissing = true;
        }
      } catch (err) {
        if (err instanceof TibberError && err.code === 'bad_token') {
          throw err;
        }
        failure = err;
      }
    }
    await this.tick();
    if (failure) {
      throw failure;
    }
    await this.reportOk();
    if (tomorrowMissing && !this.tomorrowTimer) {
      this.tomorrowTimer = this.timers.setTimeout(() => {
        this.tomorrowTimer = undefined;
        return this.refreshPrices().catch((err) => this.reportError(err));
      }, TOMORROW_RETRY);
    }
  }

  /** Move the sensors to the current slot, fire the transitions. */
  async tick() {
    const now = this.now();
    for (const entry of this.homes.values()) {
      const price = priceState(entry.slots, now, {
        timeZone: entry.home.timeZone,
        cheapHours: this.config.cheapHours,
      });
      if (!price) {
        continue;
      }
      price.allSlots = entry.slots;
      const device = this.deviceId(entry.home.id);
      const previous = entry.price;
      entry.price = price;
      await this.gladys
        .publishChangedStates(priceStates(device, price), { heartbeat: 60 * 60_000 })
        .catch((err) => this.logger.warn(`States of ${entry.home.name} failed: ${err.message}`));
      for (const event of priceEvents(device, previous, price)) {
        await this.publishEvent(event);
      }
    }
    this.gladys.requestWidgetRefresh(WIDGETS.PRICES);
  }

  scheduleTick() {
    this.timers.clearTimeout(this.tickTimer);
    const now = this.now();
    let next = Infinity;
    for (const entry of this.homes.values()) {
      const end = entry.price?.slot?.endsAt;
      if (end) {
        next = Math.min(next, Date.parse(end));
      }
    }
    const delay = Number.isFinite(next) ? Math.max(1000, next - now + 500) : 15 * 60_000;
    this.tickTimer = this.timers.setTimeout(async () => {
      try {
        await this.tick();
      } catch (err) {
        this.logger.warn(`Tick failed: ${err.message}`);
      }
      this.scheduleTick();
    }, delay);
  }

  async publishEvent(event) {
    await this.gladys
      .publishSceneEvent(event.key, event.data)
      .catch((err) => this.logger.warn(`Scene event ${event.key} failed: ${err.message}`));
  }

  // --- Consumption --------------------------------------------------------------

  async refreshConsumption() {
    for (const entry of this.homes.values()) {
      let nodes;
      try {
        nodes = await this.client.consumption(entry.home.id, CONSUMPTION_HOURS);
      } catch (err) {
        if (err instanceof TibberError && err.code === 'bad_token') {
          throw err;
        }
        this.logger.warn(`Consumption of ${entry.home.name} unavailable: ${err.message}`);
        continue;
      }
      const device = this.deviceId(entry.home.id);
      entry.totals = dailyTotals(nodes, entry.home.timeZone, this.now());
      await this.gladys
        .publishChangedStates(dailyStates(device, entry.totals), { heartbeat: 6 * 60 * 60_000 })
        .catch((err) =>
          this.logger.warn(`Daily states of ${entry.home.name} failed: ${err.message}`),
        );
      const intervals = halfHours(nodes);
      if (intervals.length === 0 || !this.energySupported) {
        continue;
      }
      try {
        // The only path of a consumption into Gladys: dated 30-minute
        // intervals, never publishStates (see src/devices.js).
        await this.gladys.publishEnergyConsumption(
          ids.feature(device, FEATURE.CONSUMPTION),
          intervals,
        );
        entry.consumptionWarned = false;
      } catch (err) {
        if (err?.status === 404) {
          // The device is not created yet: published again at the next hour.
          this.logger.debug?.(
            `Consumption of ${entry.home.name} not published yet: ${err.message}`,
          );
        } else if (!entry.consumptionWarned) {
          entry.consumptionWarned = true;
          this.logger.warn(`Consumption of ${entry.home.name} refused by Gladys: ${err.message}`);
        }
      }
    }
  }

  // --- Live (Pulse / Watty) ---------------------------------------------------------

  startLive() {
    for (const entry of this.homes.values()) {
      if (!entry.home.live) {
        continue;
      }
      entry.live = this.liveFactory({
        homeId: entry.home.id,
        token: this.config.accessToken,
        logger: this.logger,
        timers: this.timers,
        onMeasurement: (m) => this.onMeasurement(entry, m),
        onStatus: (connected) => {
          entry.liveConnected = connected;
          this.reportOk().catch(() => {});
        },
      });
      entry.live.start();
    }
  }

  /** A measurement arrived (every 2 s on a Pulse): throttled publication. */
  async onMeasurement(entry, measurement) {
    const live = liveOf(measurement);
    entry.lastLive = live;
    const now = this.now();
    if (now - entry.lastLiveAt < LIVE_THROTTLE) {
      return;
    }
    entry.lastLiveAt = now;
    const device = this.deviceId(entry.home.id);
    await this.gladys
      .publishChangedStates(liveStates(device, live), { heartbeat: 5 * 60_000 })
      .catch((err) => this.logger.warn(`Live states of ${entry.home.name} failed: ${err.message}`));
    for (const event of powerEvents(device, entry.lastPower, live.power)) {
      await this.publishEvent(event);
    }
    entry.lastPower = live.power;
    this.gladys.requestWidgetRefresh(WIDGETS.LIVE);
  }

  // --- Scene actions ------------------------------------------------------------------

  entryOf(externalId) {
    const parsed = parseExternalId(externalId);
    const entry = parsed && this.homes.get(parsed.homeId);
    if (!entry) {
      throw new Error(`Unknown Tibber home device ${externalId}`);
    }
    return entry;
  }

  async getPrice(fields = {}) {
    const entry = this.entryOf(fields.device);
    return priceOutputs(entry.price, {
      timeZone: entry.home.timeZone,
      cheapHours: this.config.cheapHours,
    });
  }

  async getCheapestWindow(fields = {}) {
    const entry = this.entryOf(fields.device);
    const period = PERIODS.includes(fields.period) ? fields.period : PERIODS[0];
    const hours = Math.min(12, Math.max(1, Number(fields.hours) || this.config.cheapHours));
    return cheapestWindowOutputs(entry.slots, {
      period,
      hours,
      now: this.now(),
      timeZone: entry.home.timeZone,
    });
  }

  // --- Widgets --------------------------------------------------------------------------

  async getWidget(key, { settings = {}, language } = {}) {
    let entry;
    try {
      entry = this.entryOf(settings.device);
    } catch {
      return {
        ttl_seconds: 300,
        components: [{ type: 'text', text: T.widget.noHome, variant: 'body' }],
      };
    }
    if (key === WIDGETS.LIVE) {
      return liveWidget({
        gladys: this.gladys,
        home: entry.home,
        live: entry.lastLive,
        liveEnabled: entry.home.live,
        language,
      });
    }
    return pricesWidget({
      home: entry.home,
      slots: entry.slots,
      price: entry.price,
      cheapHours: this.config.cheapHours,
      now: this.now(),
      language,
    });
  }

  // --- Energy contract (delegated pricing) -----------------------------------------------

  /** The home a contract refers to: its `home_id` input, else the first home. */
  contractHome(contract) {
    const wanted = String(contract?.inputs?.home_id ?? '').trim();
    const entry = wanted ? this.homes.get(wanted) : [...this.homes.values()][0];
    if (!entry) {
      throw new Error(wanted ? `Unknown Tibber home ${wanted}` : 'No Tibber home');
    }
    return entry;
  }

  async energyPrice({ contract, intervals = [] }) {
    if (intervals.length === 0) {
      return [];
    }
    const entry = this.contractHome(contract);
    const prices = await this.client.priceRange(
      entry.home.id,
      rangeStart(intervals),
      hoursToFetch(intervals),
    );
    const fallback = Number(contract?.inputs?.fallback_price);
    return intervalCosts(intervals, prices, {
      fallbackPrice: Number.isFinite(fallback) ? fallback : null,
    });
  }

  async energyCurrent({ contract }) {
    const entry = this.contractHome(contract);
    const price = entry.price;
    if (!price) {
      return { price: null };
    }
    return {
      price: price.slot.price,
      valid_until: price.slot.endsAt,
      next_price: price.next?.price ?? null,
      label: 'Tibber',
    };
  }

  // --- Configuration screen button --------------------------------------------------------

  async testConnection() {
    try {
      const viewer = await this.client.viewer();
      const homes = (viewer.homes ?? []).map((h) => {
        const price = h.currentSubscription?.priceInfo?.current;
        const name = h.appNickname || h.address?.address1 || h.id;
        return price
          ? `${name}: ${price.total} ${price.currency}/kWh (${price.level})`
          : `${name}: no price`;
      });
      return {
        en: `Signed in as ${viewer.name ?? viewer.login}. ${homes.length > 0 ? homes.join('; ') : 'No home.'}`,
        fr: `Connecté en tant que ${viewer.name ?? viewer.login}. ${homes.length > 0 ? homes.join(' ; ') : 'Aucune maison.'}`,
      };
    } catch (err) {
      if (err instanceof TibberError && err.code === 'bad_token') {
        return T.badToken;
      }
      if (err instanceof TibberError && err.code === 'no_token') {
        return T.noToken;
      }
      if (err instanceof TibberError && err.code === 'rate_limited') {
        return T.paused(this.pausedUntil);
      }
      return T.unreachable(err.message);
    }
  }
}
