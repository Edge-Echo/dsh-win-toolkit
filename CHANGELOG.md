# Changelog

## [0.1.0] - 2026-08-30

### Added

- Windows-native capability pack for DeepSeek Harness:
  - `win_clipboard_read` / `win_clipboard_write` — clipboard text read/write
  - `win_notify` — system popup notification
  - `win_hosts_list` — read the Windows hosts file
  - `win_netdiag` — DNS resolution + TCP port test
- All input crosses the PowerShell boundary as Base64 (injection-proof by construction).
- Bilingual docs, MIT license, verify script.
- End-to-end verified on Windows via headless profile: netdiag → clipboard write → clipboard read all passed.
