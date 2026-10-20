// dsh-win-toolkit — Windows-native capability pack for DeepSeek Harness.
// Every tool executes a sandboxed PowerShell snippet via powershell.exe;
// all user input crosses the script boundary as Base64 (no string
// interpolation → no injection). Every tool returns STRUCTURED output with
// presentationMeta projection and presentCall/presentResult UI cards.
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execFileAsync = promisify(execFile)

/** Plugin config: per-call PowerShell timeout. */
export interface WinToolkitConfig {
  psTimeoutMs?: number
}

async function ps(script: string, timeoutMs: number): Promise<string> {
  try {
    // PowerShell 5.1 writes its output in the OEM code page, while Node decodes as UTF-8, so any
    // non-ASCII text (a Chinese window title, clipboard content, a hosts comment) arrives mangled.
    // Forcing the child's stdout to UTF-8 is the one place that can fix it for every tool.
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ${script}`],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
    )
    return stdout.trim()
  } catch (err) {
    // The child's stderr carries the actual cause; error.message is the full invocation, which says
    // nothing useful and is longer than the message it replaces. PowerShell then decorates the
    // cause with `+ ~~~~` caret lines and `At line:` / `CategoryInfo` noise, so take the first line
    // that is actually the message.
    const e = err as { stderr?: string; message?: string }
    const detail = (e.stderr ?? '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('+') && !/^(At line:|In .*:\d+ char:|CategoryInfo|FullyQualifiedErrorId)/i.test(l))
      .slice(0, 2)
      .join(' | ')
    throw new Error(`PowerShell failed: ${detail || e.message || String(err)}`)
  }
}

function psJson<T>(script: string, timeoutMs: number): Promise<T> {
  return ps(script, timeoutMs).then((s) => JSON.parse(s) as T)
}

function b64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64')
}

function psStr(base64: string): string {
  return `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64}'))`
}

function meta<T>(result: { meta?: unknown }): T | undefined {
  return result.meta as T | undefined
}

const HOSTS_PATH = "$env:WINDIR + '\\System32\\drivers\\etc\\hosts'"

export default Object.assign(
  function winToolkit(ctx: Context, config: WinToolkitConfig = {}) {
    const timeoutMs = config.psTimeoutMs ?? 20000

    // ── 1. win_clipboard_read ─────────────────────────────────────────────
    ctx.tools.register(defineTool({
      name: 'win_clipboard_read',
      description: 'Read the current Windows clipboard text. Returns empty:true when the clipboard has no text.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            text: { type: 'string', required: true },
            empty: { type: 'boolean', required: true },
          },
        },
        render: (_a, value) => [{
          type: 'text',
          text: value.empty ? '(clipboard is empty)' : value.text,
        }],
        presentationMeta: (_a, value) => value,
      },
      presentCall: (): ToolCallView => ({
        card: 'generic',
        title: 'Reading clipboard',
        kind: 'read',
      }),
      presentResult: (_a, result): ToolResultView => {
        const m = meta<{ text?: string; empty?: boolean }>(result)
        return {
          card: 'generic',
          title: 'Clipboard',
          content: [{ type: 'text', text: m?.empty ? '(empty)' : (m?.text ?? '?') }],
        }
      },
      async execute() {
        const script = [
          '$ErrorActionPreference = "Continue"',
          'try { $t = Get-Clipboard -Raw -ErrorAction Stop } catch { $t = "" }',
          '$out = [ordered]@{ text = "$t"; empty = ([string]::IsNullOrEmpty("$t")) }',
          '$out | ConvertTo-Json -Compress',
        ].join('; ')
        return psJson(script, timeoutMs)
      },
    }))

    // ── 2. win_clipboard_write ────────────────────────────────────────────
    ctx.tools.register(defineTool({
      name: 'win_clipboard_write',
      description: 'Write text to the Windows clipboard, replacing its current content.',
      parameters: {
        text: { type: 'string', description: 'Text to place on the clipboard', required: true },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
            chars: { type: 'integer', required: true },
          },
        },
        render: (_a, value) => [{
          type: 'text',
          text: value.ok ? `Clipboard updated (${value.chars} chars)` : 'Clipboard write failed',
        }],
        presentationMeta: (_a, value) => value,
      },
      presentCall: (): ToolCallView => ({
        card: 'generic',
        title: 'Writing to clipboard',
        kind: 'edit',
      }),
      presentResult: (_a, result): ToolResultView => {
        const m = meta<{ ok?: boolean; chars?: number }>(result)
        return {
          card: 'generic',
          title: m?.ok ? `Clipboard: ${m.chars ?? 0} chars` : 'Clipboard write failed',
        }
      },
      async execute(args) {
        const script = [
          `Set-Clipboard -Value (${psStr(b64(args.text))}) -ErrorAction Stop`,
          '$out = [ordered]@{ ok = $true; chars = (Get-Clipboard -Raw).Length }',
          '$out | ConvertTo-Json -Compress',
        ].join('; ')
        return psJson(script, timeoutMs)
      },
    }))

    // ── 3. win_notify ─────────────────────────────────────────────────────
    ctx.tools.register(defineTool({
      name: 'win_notify',
      description: 'Show a Windows notification popup. Auto-closes after about 6 seconds. Useful to alert the user when a long task finishes.',
      parameters: {
        title: { type: 'string', description: 'Notification title', required: true },
        message: { type: 'string', description: 'Notification body text', required: true },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            ok: { type: 'boolean', required: true },
          },
        },
        render: (_a, value) => [{ type: 'text', text: value.ok ? 'Notification shown' : 'Notification failed' }],
        presentationMeta: (_a, value) => value,
      },
      presentCall: (): ToolCallView => ({
        card: 'generic',
        title: 'Showing notification',
        kind: 'other',
      }),
      presentResult: (_a, result): ToolResultView => {
        const m = meta<{ ok?: boolean }>(result)
        return {
          card: 'generic',
          title: m?.ok ? 'Notification shown' : 'Notification failed',
        }
      },
      async execute(args) {
        const title = psStr(b64(args.title))
        const message = psStr(b64(args.message))
        const script = [
          `$w = New-Object -ComObject WScript.Shell; $null = $w.Popup(${message}, 6, ${title}, 0x40)`,
          '$out = [ordered]@{ ok = $true }',
          '$out | ConvertTo-Json -Compress',
        ].join('; ')
        return psJson(script, timeoutMs)
      },
    }))

    // ── 4. win_hosts_list ─────────────────────────────────────────────────
    ctx.tools.register(defineTool({
      name: 'win_hosts_list',
      description: 'Read the Windows hosts file (C:\\Windows\\System32\\drivers\\etc\\hosts). Read-only.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            content: { type: 'string', required: true },
            lines: { type: 'integer', required: true },
          },
        },
        render: (_a, value) => [{ type: 'text', text: value.content }],
        presentationMeta: (_a, value) => value,
      },
      presentCall: (): ToolCallView => ({
        card: 'generic',
        title: 'Reading hosts file',
        kind: 'read',
        locations: [{ path: 'C:\\Windows\\System32\\drivers\\etc\\hosts' }],
      }),
      presentResult: (_a, result): ToolResultView => {
        const m = meta<{ lines?: number }>(result)
        return {
          card: 'generic',
          title: `Hosts file: ${m?.lines ?? 0} lines`,
        }
      },
      async execute() {
        const script = [
          `$c = Get-Content (${HOSTS_PATH}) -ErrorAction Stop | Out-String`,
          `$n = @(Get-Content (${HOSTS_PATH}) -ErrorAction SilentlyContinue).Count`,
          '$out = [ordered]@{ content = "$c"; lines = $n }',
          '$out | ConvertTo-Json -Compress',
        ].join('; ')
        return psJson(script, timeoutMs)
      },
    }))

    // ── 5. win_netdiag ────────────────────────────────────────────────────
    ctx.tools.register(defineTool({
      name: 'win_netdiag',
      description: 'Diagnose network reachability for a host: DNS resolution plus a TCP connect test on a port (default 443).',
      parameters: {
        host: { type: 'string', description: 'Hostname or IP address to test', required: true },
        port: { type: 'integer', description: 'TCP port to test (default 443)' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            dns: { type: 'array', items: { type: 'string' }, required: true },
            tcp: { type: 'string', required: true },
          },
        },
        render: (_a, value) => [{
          type: 'text',
          text: `DNS: ${value.dns.join(', ')} | TCP: ${value.tcp}`,
        }],
        presentationMeta: (_a, value) => value,
      },
      presentCall: (args): ToolCallView => ({
        card: 'generic',
        title: `Testing ${(args as { host?: string }).host ?? 'host'}`,
        kind: 'fetch',
      }),
      presentResult: (_a, result): ToolResultView => {
        const m = meta<{ dns?: string[]; tcp?: string }>(result)
        return {
          card: 'generic',
          title: `TCP: ${m?.tcp ?? '?'}`,
          content: [{ type: 'text', text: `DNS: ${m?.dns?.join(', ') ?? '?'}` }],
        }
      },
      async execute(args) {
        const host = args.host as string
        const port = (args.port ?? 443) as number
        const hostExpr = psStr(b64(host))
        const script = [
          '$ErrorActionPreference = "Continue"',
          `try { $dns = [System.Net.Dns]::GetHostAddresses(${hostExpr}) | ForEach-Object { $_.IPAddressToString } } catch { $dns = @("DNS_FAILED") }`,
          `$c = New-Object System.Net.Sockets.TcpClient; try { $t = $c.ConnectAsync(${hostExpr}, ${port}); if ($t.Wait(5000)) { $tcp = "OPEN" } else { $tcp = "TIMEOUT" } } catch { $tcp = "CLOSED" } finally { $c.Dispose() }`,
          '$out = [ordered]@{ dns = @($dns); tcp = $tcp }',
          '$out | ConvertTo-Json -Compress',
        ].join('; ')
        return psJson(script, timeoutMs)
      },
    }))
  // ── 6. win_window_list ─────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'win_window_list',
    description: 'List visible top-level windows: title, process name and PID. Use this before win_window_focus to find the exact title.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          windows: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                title: { type: 'string', required: true },
                process: { type: 'string', required: true },
                pid: { type: 'integer', required: true },
              },
            },
          },
        },
      },
      render: (_a, value) => [{
        type: 'text',
        text: [
          `${value.count} window(s) with a title:`,
          ...value.windows.map((w) => `  ${w.process} (pid ${w.pid})  ${w.title}`),
        ].join('\n'),
      }],
      presentationMeta: (_a, value) => value,
    },
    presentCall: (): ToolCallView => ({ card: 'generic', title: 'Listing windows', kind: 'search' }),
    presentResult: (_a, result): ToolResultView => {
      const m = meta<{ count?: number }>(result)
      return { card: 'generic', title: `${m?.count ?? 0} window(s)` }
    },
    async execute() {
      const script = [
        '$ErrorActionPreference = "Continue"',
        '$w = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 60 | ForEach-Object { [ordered]@{ title = $_.MainWindowTitle; process = $_.ProcessName; pid = $_.Id } })',
        '$out = [ordered]@{ windows = @($w); count = $w.Count }',
        '$out | ConvertTo-Json -Compress -Depth 4',
      ].join('; ')
      return psJson(script, timeoutMs)
    },
  }))

  // ── 7. win_window_focus ────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'win_window_focus',
    description: 'Bring a window to the foreground by a case-insensitive title substring. Returns the matched title and process, or focused=false when nothing matched.',
    parameters: {
      title: { type: 'string', description: 'Substring of the window title, e.g. "Untitled - Notepad"', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          focused: { type: 'boolean', required: true },
          title: { type: 'string', required: true },
          process: { type: 'string', required: true },
        },
      },
      render: (_a, value) => [{
        type: 'text',
        text: value.focused ? `Focused: ${value.title} (${value.process})` : 'No window matched that title.',
      }],
      presentationMeta: (_a, value) => value,
    },
    presentCall: (args): ToolCallView => ({ card: 'generic', title: `Focusing ${(args as { title?: string }).title ?? 'window'}`, kind: 'other' }),
    presentResult: (_a, result): ToolResultView => {
      const m = meta<{ focused?: boolean; title?: string }>(result)
      return { card: 'generic', title: m?.focused ? `Focused: ${m.title}` : 'No matching window' }
    },
    async execute(args) {
      const needle = psStr(b64(args.title))
      const script = [
        '$ErrorActionPreference = "Continue"',
        `$needle = ${needle}`,
        '$w = New-Object -ComObject WScript.Shell',
        '$target = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.ToLower().Contains($needle.ToLower()) } | Select-Object -First 1',
        'if ($target) { $ok = $w.AppActivate($target.Id); $out = [ordered]@{ focused = [bool]$ok; title = $target.MainWindowTitle; process = $target.ProcessName } }',
        'else { $out = [ordered]@{ focused = $false; title = ""; process = "" } }',
        '$out | ConvertTo-Json -Compress',
      ].join('; ')
      return psJson(script, timeoutMs)
    },
  }))

  // ── 8. win_screenshot ──────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'win_screenshot',
    description: 'Capture the whole virtual screen to a PNG file and return its path, size and dimensions. Use it when "what is on screen" is the question; the file can then be opened or attached.',
    parameters: {
      path: { type: 'string', description: 'Destination .png path (defaults to a temp file)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          bytes: { type: 'integer', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
        },
      },
      render: (_a, value) => [{
        type: 'text',
        text: `Screenshot saved: ${value.path} (${value.width}×${value.height}, ${Math.round(value.bytes / 1024)} KB)`,
      }],
      presentationMeta: (_a, value) => value,
    },
    presentCall: (): ToolCallView => ({ card: 'generic', title: 'Capturing the screen', kind: 'read' }),
    presentResult: (_a, result): ToolResultView => {
      const m = meta<{ path?: string; width?: number; height?: number }>(result)
      return {
        card: 'generic',
        title: `Screenshot ${m?.width ?? '?'}×${m?.height ?? '?'}`,
        ...(m?.path ? { locations: [{ path: m.path }] } : {}),
      }
    },
    async execute(args) {
      const target = args.path ?? join(tmpdir(), `dsh-screenshot-${Date.now()}.png`)
      const targetExpr = psStr(b64(target))
      const script = [
        '$ErrorActionPreference = "Stop"',
        `$path = ${targetExpr}`,
        'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
        '$b = [System.Windows.Forms.SystemInformation]::VirtualScreen',
        '$bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
        '$g = [System.Drawing.Graphics]::FromImage($bmp)',
        '$g.CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)',
        '$bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)',
        '$g.Dispose(); $bmp.Dispose()',
        '$f = Get-Item -LiteralPath $path',
        '$out = [ordered]@{ path = $f.FullName; bytes = $f.Length; width = [int]$b.Width; height = [int]$b.Height }',
        '$out | ConvertTo-Json -Compress',
      ].join('; ')
      return psJson(script, Math.max(timeoutMs, 30_000))
    },
  }))

  // ── 9. win_process_list ────────────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'win_process_list',
    description: 'List the top processes by memory use, optionally filtered by name. Read-only; answers "what is eating this machine".',
    parameters: {
      name: { type: 'string', description: 'Case-insensitive name filter, e.g. "node"' },
      limit: { type: 'integer', description: 'How many to return (default 20, max 100)' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          count: { type: 'integer', required: true },
          processes: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                pid: { type: 'integer', required: true },
                memoryMB: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render: (_a, value) => [{
        type: 'text',
        text: [
          `${value.count} process(es):`,
          ...value.processes.map((p) => `  ${p.name.padEnd(24)} pid ${String(p.pid).padEnd(7)} ${p.memoryMB} MB`),
        ].join('\n'),
      }],
      presentationMeta: (_a, value) => value,
    },
    presentCall: (): ToolCallView => ({ card: 'generic', title: 'Listing processes', kind: 'search' }),
    presentResult: (_a, result): ToolResultView => {
      const m = meta<{ count?: number }>(result)
      return { card: 'generic', title: `${m?.count ?? 0} process(es)` }
    },
    async execute(args) {
      const filter = psStr(b64(args.name ?? ''))
      const limit = Math.min(Math.max(1, args.limit ?? 20), 100)
      const script = [
        '$ErrorActionPreference = "Continue"',
        `$filter = ${filter}`,
        `$list = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $filter -eq "" -or $_.ProcessName.ToLower().Contains($filter.ToLower()) } | Sort-Object WorkingSet64 -Descending | Select-Object -First ${limit})`,
        '$rows = @($list | ForEach-Object { [ordered]@{ name = $_.ProcessName; pid = $_.Id; memoryMB = [math]::Round($_.WorkingSet64 / 1MB, 1) } })',
        '$out = [ordered]@{ processes = @($rows); count = $rows.Count }',
        '$out | ConvertTo-Json -Compress -Depth 4',
      ].join('; ')
      return psJson(script, timeoutMs)
    },
  }))

  // ── 10. win_open ──────────────────────────────────────────────
  ctx.tools.register(defineTool({
    name: 'win_open',
    description: 'Open a file, folder or http(s) URL with its default application (Start-Process). Returns the resolved target.',
    parameters: {
      target: { type: 'string', description: 'File path, folder, or http(s) URL to open', required: true },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          opened: { type: 'boolean', required: true },
          target: { type: 'string', required: true },
        },
      },
      render: (_a, value) => [{ type: 'text', text: `Opened ${value.target}` }],
      presentationMeta: (_a, value) => value,
    },
    presentCall: (args): ToolCallView => ({
      card: 'generic',
      title: `Opening ${(args as { target?: string }).target ?? 'target'}`,
      kind: 'other',
    }),
    presentResult: (_a, result): ToolResultView => {
      const m = meta<{ opened?: boolean; target?: string }>(result)
      return { card: 'generic', title: m?.opened ? `Opened ${m.target}` : 'Could not open the target' }
    },
    async execute(args) {
      const targetExpr = psStr(b64(args.target))
      const script = [
        '$ErrorActionPreference = "Stop"',
        `$t = ${targetExpr}`,
        'Start-Process -FilePath $t',
        '$out = [ordered]@{ opened = $true; target = $t }',
        '$out | ConvertTo-Json -Compress',
      ].join('; ')
      return psJson(script, timeoutMs)
    },
  }))

  },
  { inject: ['tools'] },
)
