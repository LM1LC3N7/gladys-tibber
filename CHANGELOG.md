# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Fixed

- Docs: the outputs of the scene actions come from the variable list
  (`{{<step>.<action>.<key>}}`), not `{{<key>}}`.
- Energy: yesterday's and today's consumption were `energy-sensor` /
  `daily-consumption` features fed by `publishStates`. Gladys attaches every
  consumption feature to the main electric meter and prices it, so these kWh
  were counted on top of the 30-minute consumption. They are now plain
  sensors (`unknown` / `decimal`, kWh in the name) under new keys
  `yesterday_kwh` and `today_kwh`. The 30-minute `consumption`, fed only by
  `publishEnergyConsumption`, is the device's single energy source; no
  `energy` or `index` feature is published.
- Gladys older than 5.2.0: the consumption is no longer sent to an endpoint
  that does not exist; the status line says the energy monitoring needs
  Gladys 5.2.0, everything else keeps working. A consumption refused by
  Gladys (other than "device not created yet") is now logged as a warning,
  once.
- Live widget: today's kWh is shown as a value, so it works on devices
  created before and after this change.
- Docs and manifest: the token is kept in the Gladys database, not
  "encrypted".

### Existing devices (created with 0.1.1)

- Gladys never changes the type of a created feature: the old
  `yesterday_consumption` and `today_consumption` features stay on the
  device, read only, with their history, and receive no new state. Their
  past values may show twice in the energy monitoring. To get the new
  sensors and remove the double count, delete the Tibber device and add it
  again from Discovery (its history is then lost), or delete only the two
  old features. Prices, the 30-minute consumption, costs, live power and
  scenes need no action.

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

[Unreleased]: https://github.com/LM1LC3N7/gladys-tibber/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-tibber/releases/tag/v0.1.1
