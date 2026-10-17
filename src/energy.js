// -----------------------------------------------------------------------------
// The delegated energy contract: the core sends the 30-minute intervals of a
// billing period, the integration answers one cost per interval from the
// Tibber hourly prices (total per kWh, VAT included). Pure except the price
// lookup, injected.
// -----------------------------------------------------------------------------

import { slotAt, slotsOf } from './tibber/model.js';

/**
 * The costs of the intervals. `prices` are Price nodes covering the period
 * (from priceInfoRange); an interval without a price uses `fallbackPrice`.
 */
export function intervalCosts(intervals, prices, { fallbackPrice = null } = {}) {
  const slots = slotsOf(prices);
  return intervals.map(({ starts_at, kwh }) => {
    const slot = slotAt(slots, Date.parse(starts_at));
    const price = slot?.price ?? fallbackPrice;
    if (price === null || price === undefined) {
      throw new Error(`No Tibber price for ${starts_at}`);
    }
    return { starts_at, cost: Math.max(0, kwh * price), label: slot ? 'Tibber' : 'Fallback' };
  });
}

/** The first Gladys version with publishEnergyConsumption. */
export const ENERGY_CONSUMPTION_MIN_GLADYS = [5, 2, 0];

/**
 * Whether a Gladys version (`v5.2.0`, `5.2.1-beta`...) accepts
 * publishEnergyConsumption. An unreadable version is given the benefit of the
 * doubt (`true`): the call itself then says what the core accepts.
 */
export function supportsEnergyConsumption(version) {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(String(version ?? ''));
  if (!match) {
    return true;
  }
  const parts = match.slice(1).map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (parts[i] !== ENERGY_CONSUMPTION_MIN_GLADYS[i]) {
      return parts[i] > ENERGY_CONSUMPTION_MIN_GLADYS[i];
    }
  }
  return true;
}

/** How many hourly prices cover the intervals, with a margin. */
export function hoursToFetch(intervals) {
  if (intervals.length === 0) {
    return 1;
  }
  const first = Math.min(...intervals.map((i) => Date.parse(i.starts_at)));
  const last = Math.max(...intervals.map((i) => Date.parse(i.starts_at)));
  return Math.min(1000, Math.ceil((last - first) / (60 * 60_000)) + 3);
}

/** The instant the price range should start at: one hour before the first interval. */
export function rangeStart(intervals) {
  const first = Math.min(...intervals.map((i) => Date.parse(i.starts_at)));
  return new Date(first - 60 * 60_000).toISOString();
}
