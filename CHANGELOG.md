# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Changed
- OpenCode `opencode.ruminateHint` now defaults to `false` (env: `PSYCHMEM_RUMINATE_HINT`) so the startup tool announcement is opt-in instead of injected by default.

## [1.0.12] - 2026-02-27

### Changed
- OpenCode one-time `ruminate` hint now includes explicit plugin provenance metadata (`user_authored="false"`) so agents can distinguish it from user-authored input.

### Added
- New OpenCode config toggle `opencode.ruminateHint` (env: `PSYCHMEM_RUMINATE_HINT`, default `true`) to inject a one-time reminder that the agent can use the `ruminate` tool.

### Changed
- Session-start controls are now documented together: memory injection (`injectOnSessionStart`) and ruminate guidance hint (`ruminateHint`).

## [1.0.11] - 2026-02-27

### Changed
- Bumped package version to distinguish this maintained fork from upstream releases.

### Fixed
- OpenCode adapter now preserves the active model during memory injection by deferring initial injection until model metadata is available and forwarding that model in `session.prompt`.

## [1.0.10] - 2026-02-27

### Added
- Initial forked release line for OpenCode-focused maintenance.
