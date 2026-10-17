# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Fixed

- A refused access token is no longer sent again at every reconnection or
  restart: its keyed hash (HMAC, never the token) is kept in `/data` until
  the configuration is saved, and a token refused while running stops every
  call and the live socket.
- An HTTP 429 now pauses every call, the test button and a scan included
  (Retry-After, else 10 minutes, between 1 minute and 6 hours), kept across a
  reconnection and a restart; the integration resumes by itself afterwards.
  A pause end read back from `/data` is never more than 6 hours away (cut
  down and written back), and during a pause the prices already known keep
  following the slots (sensors, cheap-period and price-level triggers, the
  current price of the energy contract).
- When Tibber cannot be read at a reconnection (429, refused token, network),
  Discovery gets the last homes known instead of staying empty.
- The image creates `/data` owned by the `node` user, so the state above can
  be written.

## [0.1.3] - 2026-10-17

### Fixed

- Status and Discovery republished after Gladys restarts.

## [0.1.2] - 2026-10-17

### Fixed

- Docs: the outputs of the scene actions come from the variable list
  (`{{<step>.<action>.<key>}}`), not `{{<key>}}`.
- Energy: yesterday's and today's consumption were `energy-sensor` /
  `daily-consumption` features fed by `publishStates`. The costs and charts
  of the energy monitoring never used them (they read the 30-minute
  consumption), but these daily kWh could be added to the 30-minute ones in
  the weekly digest and in the Gladys MCP answers. They are now plain
  sensors (`unknown` / `decimal`, kWh in the name) under new keys
  `yesterday_kwh` and `today_kwh`. The 30-minute `consumption`, fed only by
  `publishEnergyConsumption`, is the device's single energy source; no
  `energy` or `index` feature is published.
- Gladys 5.2.0 or newer is required (as the manifest says). Should a
  pre-release report an older version, the consumption is not sent and the
  status line says the energy monitoring needs Gladys 5.2.0. A consumption
  refused by Gladys (other than "device not created yet") is now logged as a
  warning, once per home.
- Live widget: today's kWh is shown as a value, so it works on devices
  created before and after this change.
- Docs and manifest: the token is kept in the Gladys database, not
  "encrypted".

### Existing devices (created with 0.1.1)

- Gladys does not touch a created device until you click Update: until then
  the old `yesterday_consumption` and `today_consumption` features stay, with
  their history, and receive no new state. Open Discovery, the Tibber device
  (badge "Already added"), and click Update: Gladys adds `yesterday_kwh` and
  `today_kwh`, removes the two old features, and keeps the device, the
  history of every other feature (30-minute consumption and its cost,
  prices, costs) and the energy contract link. A scene or a dashboard chart
  set on one of the two old features must be pointed at the new ones.

## [0.1.1] - 2026-10-13

### Added

- One device per Tibber home: current, next, average, minimum and maximum
  price of the day, Tibber's price level, a "cheap period" sensor, the
  30-minute consumption fed to the Gladys energy monitoring, yesterday's
  consumption and cost; with a Tibber Pulse or Watty, the live power,
  production, today's consumption and cost, voltages and currents.
- Scene triggers "cheap period started / ended", "price level changed",
  "tomorrow's prices published" and "live power crossed a mark".
- Scene actions "price now" and "cheapest hours".
- Dashboard widgets "Tibber prices" (curve of today and tomorrow) and
  "Tibber live power".
- Delegated energy contract templates for Norway, Sweden, Germany and the
  Netherlands (Gladys 5.2+): every half hour priced from the Tibber hourly
  price history, plus the monthly subscription.
- "Test the connection" button.

[Unreleased]: https://github.com/LM1LC3N7/gladys-tibber/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/LM1LC3N7/gladys-tibber/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/LM1LC3N7/gladys-tibber/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-tibber/releases/tag/v0.1.1
