# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-10-03

The first release.

### Added

- `runtimeConfig()`: one definition of an app's settings - where the file is,
  the environment-variable prefix, the settings' names, and an optional `check`.
  `load()`, `get()`, `provide()`, `parse()`, `envVarOf()` and `template()`.
- Every problem at once, as a `ConfigError`: a missing file (a 404, or a web
  page served in its place), no answer in time, not JSON, a missing / empty /
  non-text value, an unfilled placeholder, an unknown key, and the project's
  own check - which still runs alongside an unknown key's problem.
- `showConfigError()`: the problems on the page, in plain DOM, set as text.
- `@taljacob2/runtime-config/vite`: serves a local dev file under `vite` and
  `vite preview`; ships the template and refuses to ship a real config file
  under `vite build`. Vite 5 to 8.
- `@taljacob2/runtime-config/server`: `readEnv()` and `configResponse()` for
  servers - Next.js route handlers and `instrumentation.ts`, Node, Fetch API servers.
- The `runtime-config template` CLI, for any build tool.
- `docker/40-runtime-config.sh`: fills the file from environment variables when
  an nginx container starts, escaping `"` and `\`, and stops the container
  naming each variable that is missing, blank, or holds a line break or tab.
