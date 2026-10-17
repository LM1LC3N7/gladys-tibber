# TODO

## Before announcing

- [ ] Test on a real Gladys 5.2+ with a real Tibber account: discovery,
      prices and the tick over a day, tomorrow's announcement at 13:00, the
      consumption feature filled, a Tibber contract priced, the two widgets.
- [ ] With a Pulse: the websocket stays connected for days, the throttled
      states, the power marks.
- [ ] Reserve "Tibber" in the forum thread t/10385, then add the
      `gladys-assistant-integration` topic to publish in the store.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).

## To confirm on a real instance (built without a Tibber subscription)

- [ ] `priceInfo.today` carries 15-minute slots on some markets (NO/SE moved
      to 15-minute day-ahead in 2025): the slot model handles any length,
      the cheap-hours count follows the slot length.
- [ ] `priceInfoRange` cursors (`after` = base64 of an ISO instant) and the
      maximum `first` the API accepts for a 31-day period (744 hours).
- [ ] Node's global `WebSocket` accepts the `headers` option on this Node
      version (checked on 22.22) and Tibber accepts the User-Agent.
- [ ] `publishEnergyConsumption` accepts the two halves of the latest
      complete hour (the core refuses intervals that are too recent).

## Decisions

- **Energy (fix after 0.1.1)**: the only energy source of a home device is
  `consumption` (`energy-sensor` / `thirty-minutes-consumption`), fed with
  `publishEnergyConsumption` (Gladys >= 5.2.0), never with `publishStates`.
  Every consumption feature is attached to the main meter and summed where
  the core adds consumptions up (weekly digest, MCP), so yesterday's and today's kWh are plain sensors (`unknown` /
  `decimal`, no unit: the core lists none for `unknown`) under new keys
  `yesterday_kwh` / `today_kwh`. No `energy` / `index` feature (the Pulse
  `lastMeterConsumption` is a cumulative index, but the core would derive a
  second consumption from it). Production stays `energy-production-sensor` /
  `power` only (live); no injection total. Costs (`today_cost`,
  `yesterday_cost`) are `currency` sensors, not energy cost types.
- **Migration**: the 0.1.1 keys `yesterday_consumption` / `today_consumption`
  (`daily-consumption`) are frozen in `LEGACY_FEATURE`, never offered nor
  published again (a test forbids reusing them). Gladys keeps them on a
  created device until the user clicks Discovery → Update, which adds the new
  keys, removes the old ones and keeps the device id, the other features'
  history and the contract's meter link. Documented in docs fr/en and
  CHANGELOG.
- **Gladys 5.2.0 required** (manifest; older cores refuse `energy_contracts`).
  Fallback kept for pre-releases: `getStatus().gladys_version` read at
  start; below 5.2.0 no `publishEnergyConsumption` call and a status line
  that says so; an unreadable version is tried anyway (404 = device not
  created, debug; anything else warned once per home).

## Ideas

- A price calendar (`rules` mode) per price area as an alternative to the
  delegated contract, like gladys-nord-pool.
- Production (solar) consumption nodes and `accumulatedReward`.
- The `testMeasurement` subscription behind a "demo" switch for users
  without a Pulse.
