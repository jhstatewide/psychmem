# Changelog

All notable changes to this project are documented in this file.

## [1.0.11] - 2026-02-27

### Changed
- Bumped package version to distinguish this maintained fork from upstream releases.

### Fixed
- OpenCode adapter now preserves the active model during memory injection by deferring initial injection until model metadata is available and forwarding that model in `session.prompt`.

## [1.0.10] - 2026-02-27

### Added
- Initial forked release line for OpenCode-focused maintenance.
