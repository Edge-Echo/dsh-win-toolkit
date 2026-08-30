// dsh-win-toolkit — Windows-native capability pack for DeepSeek Harness.
// Every tool executes a sandboxed PowerShell snippet via powershell.exe;
// all user input crosses the script boundary as Base64 (no string
// interpolation → no injection).
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Plugin config: per-call PowerShell timeout. */
export interface WinToolkitConfig {
  psTimeoutMs?: number
}

/** Run one PowerShell script; returns trimmed stdout, throws on failure. */
async function ps(script: string, timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    )
    return stdout.trim()
  } catch (err) {
    const e = err as { message?: string }
    throw new Error(`PowerShell failed: ${e?.message ?? String(err)}`)
  }
}

/** Base64-encode a string so it can travel safely through PowerShell. */
function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64')
}

/** PowerShell expression that decodes a Base64 literal to a string. */
function psStr(base64: string): string {
  return `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64}'))`
}

const HOSTS_PATH = "$env:WINDIR + '\\System32\\drivers\\etc\\hosts'"

export default Object.assign(
  function winToolkit(ctx: Context, config: WinToolkitConfig = {}) {
    const timeoutMs = config.psTimeoutMs ?? 20000

    ctx.tools.register(defineTool({
      name: 'win_clipboard_read',
      description: 'Read the current Windows clipboard text. Returns an empty string when the clipboard has no text.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_a, value) => [{ type: 'text', text: value }],
      },
      async execute() {
        return ps('try { Get-Clipboard -Raw -ErrorAction Stop } catch { "" }', timeoutMs)
      },
    }))

    ctx.tools.register(defineTool({
      name: 'win_clipboard_write',
      description: 'Write text to the Windows clipboard, replacing its current content.',
      parameters: {
        text: { type: 'string', description: 'Text to place on the clipboard', required: true },
      },
      output: {
        schema: { type: 'string' },
        render: (_a, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        await ps(`Set-Clipboard -Value (${psStr(b64(args.text))}) -ErrorAction Stop; "ok"`, timeoutMs)
        return 'clipboard updated'
      },
    }))

    ctx.tools.register(defineTool({
      name: 'win_notify',
      description: 'Show a Windows notification popup. Auto-closes after about 6 seconds. Useful to alert the user when a long task finishes.',
      parameters: {
        title: { type: 'string', description: 'Notification title', required: true },
        message: { type: 'string', description: 'Notification body text', required: true },
      },
      output: {
        schema: { type: 'string' },
        render: (_a, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        const title = psStr(b64(args.title))
        const message = psStr(b64(args.message))
        await ps(
          `$w = New-Object -ComObject WScript.Shell; $null = $w.Popup(${message}, 6, ${title}, 0x40); "shown"`,
          timeoutMs,
        )
        return 'notification shown'
      },
    }))

    ctx.tools.register(defineTool({
      name: 'win_hosts_list',
      description: 'Read the Windows hosts file (C:\\Windows\\System32\\drivers\\etc\\hosts). Read-only; use win_hosts_edit for changes.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_a, value) => [{ type: 'text', text: value }],
      },
      async execute() {
        return ps(`Get-Content (${HOSTS_PATH}) -ErrorAction Stop | Out-String`, timeoutMs)
      },
    }))

    ctx.tools.register(defineTool({
      name: 'win_netdiag',
      description: 'Diagnose network reachability for a host: DNS resolution plus a TCP connect test on a port (default 443). Returns one line per check.',
      parameters: {
        host: { type: 'string', description: 'Hostname or IP address to test', required: true },
        port: { type: 'integer', description: 'TCP port to test (default 443)' },
      },
      output: {
        schema: { type: 'string' },
        render: (_a, value) => [{ type: 'text', text: value }],
      },
      async execute(args) {
        const host = psStr(b64(args.host as string))
        const port = (args.port ?? 443) as number
        const script = [
          '$ErrorActionPreference = "Continue"',
          `try { $dns = [System.Net.Dns]::GetHostAddresses(${host}) | ForEach-Object { $_.IPAddressToString } } catch { $dns = @("DNS_FAILED") }`,
          '$c = New-Object System.Net.Sockets.TcpClient',
          `try { $t = $c.ConnectAsync(${host}, ${port}); if ($t.Wait(5000)) { $tcp = "OPEN" } else { $tcp = "TIMEOUT" } } catch { $tcp = "CLOSED" } finally { $c.Dispose() }`,
          `"DNS: $($dns -join ', ')"`,
          `"TCP ${port}: $tcp"`,
        ].join('; ')
        return ps(script, timeoutMs)
      },
    }))
  },
  { inject: ['tools'] },
)
