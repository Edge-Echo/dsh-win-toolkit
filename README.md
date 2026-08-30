# dsh-win-toolkit

**Windows-native capability pack for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh).**

Gives your dsh agent real Windows superpowers — clipboard, system notifications, hosts file inspection, and network diagnostics — backed by safe, parameterized PowerShell. No extra installs, no admin rights required for the current toolset.

> 中文文档见 [README.zh.md](README.zh.md)。

## Tools

| Tool | What it does |
|---|---|
| `win_clipboard_read` | Read the current clipboard text |
| `win_clipboard_write` | Write text to the clipboard |
| `win_notify` | Show a system popup notification (auto-closes) |
| `win_hosts_list` | Read the Windows hosts file |
| `win_netdiag` | DNS resolution + TCP port test for any host |

## Install

```sh
dsh plugin --profile web add dsh-win-toolkit
dsh web   # restart
```

Then just ask your agent, e.g.:
- "check if github.com:443 is reachable" → `win_netdiag`
- "put this text on my clipboard" → `win_clipboard_write`
- "notify me when you're done" → `win_notify`

## How it works

Every tool runs a short PowerShell snippet through `powershell.exe -NoProfile -NonInteractive`. All user input crosses the script boundary as **Base64** — never string-interpolated — so argument injection is structurally impossible.

- Config: `psTimeoutMs` (default 20000) — per-call PowerShell timeout, settable in your profile's `cordis.patch.yml` under the `win-toolkit` entry.
- Windows-only: tools fail loudly with a clear error on non-Windows platforms (the entry itself is a no-op there).

## Roadmap

- `win_hosts_edit` (admin-gated hosts entries), `win_env`, `win_service`, `win_window`, `win_task`, `win_netdiag` deep mode (proxy check, DNS server, traceroute).

## Troubleshooting

- Tools fail with "PowerShell failed": usually an anti-virus or execution-policy quirk — the plugin uses `-NoProfile -NonInteractive` but policy still applies. Check `Get-ExecutionPolicy`; the plugin does not require RemoteSigned.
- Want to see exactly what runs? The PowerShell snippets are short and readable in `src/index.ts`.

## Links

- npm: <https://www.npmjs.com/package/dsh-win-toolkit>
- GitHub: <https://github.com/Edge-Echo/dsh-win-toolkit>
- License: MIT
