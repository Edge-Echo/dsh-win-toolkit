# Changelog

## 0.3.0

**`win_open`** — open a file, folder or http(s) URL with its default application. The target is
embedded as a Base64-decoded PowerShell string, like every other input in the toolkit.

**`doctor` now checks screen capture.** `win_screenshot` depends on System.Windows.Forms and
System.Drawing, which Server Core installs and some policies omit; doctor probes the virtual screen
dimensions and says up front whether screenshots will work, instead of letting the first capture
fail. On a normal desktop it reports the resolution.

**Fixed: non-ASCII output was corrupted on every tool.** PowerShell 5.1 writes stdout in the OEM
code page while Node decodes UTF-8, so a Chinese window title, clipboard text or hosts comment came
back mangled (a round-trip of "中文测试" did not survive). The PowerShell boundary now forces the
child's stdout to UTF-8, which fixes it once for all tools.

**Fixed: failures reported the whole command line instead of the cause.** `execFile`'s message is the
entire invocation; the actual error is in the child's stderr, decorated with `+ ~~~` and
`CategoryInfo` noise. Errors now carry the first real message line and nothing else.

Tests: 14 → 18 assertions, including a clipboard round-trip of non-ASCII text (borrowed and
restored) and two assertions about the shape of failure messages.

## 0.2.0

Four capabilities beyond clipboard and notifications.

- **`win_screenshot`** — captures the whole virtual screen to a PNG and returns the path, size and
  dimensions. The one visible tool: it makes "the agent looked at the screen" into a file you can
  open.
- **`win_window_list` / `win_window_focus`** — list visible windows (title, process, PID) and bring
  one to the front by a case-insensitive title substring.
- **`win_process_list`** — top processes by memory, optionally filtered by name.

All four keep the existing input convention: any user-supplied value (a window title, a destination
path) is embedded as a Base64-decoded PowerShell string expression, so it cannot terminate the
script it appears in.

The test suite grew from 2 assertions to 14. It now drives the plugin with a fake context, checks
all nine registrations and their schemas, and executes the read-only tools for real; screenshot
capture is exercised locally but skipped on CI, where the Windows runner has no guaranteed
interactive desktop session.

## [0.1.3] - 2026-09-22

### Added

- dsh-win-toolkit CLI: doctor (verifies platform, PowerShell version, execution policy, clipboard access, WScript.Shell COM and hosts readability) and list.
- Environment checks live in src/env.ts, mirroring the netassist doctor pattern.


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
