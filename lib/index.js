import { defineTool } from '@deepseek-ai/dsh-tools';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const execFileAsync = promisify(execFile);
async function ps(script, timeoutMs) {
    try {
        const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
        return stdout.trim();
    }
    catch (err) {
        const e = err;
        throw new Error(`PowerShell failed: ${e?.message ?? String(err)}`);
    }
}
function psJson(script, timeoutMs) {
    return ps(script, timeoutMs).then((s) => JSON.parse(s));
}
function b64(s) {
    return Buffer.from(s, 'utf8').toString('base64');
}
function psStr(base64) {
    return `[System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String('${base64}'))`;
}
function meta(result) {
    return result.meta;
}
const HOSTS_PATH = "$env:WINDIR + '\\System32\\drivers\\etc\\hosts'";
export default Object.assign(function winToolkit(ctx, config = {}) {
    const timeoutMs = config.psTimeoutMs ?? 20000;
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
        presentCall: () => ({
            card: 'generic',
            title: 'Reading clipboard',
            kind: 'read',
        }),
        presentResult: (_a, result) => {
            const m = meta(result);
            return {
                card: 'generic',
                title: 'Clipboard',
                content: [{ type: 'text', text: m?.empty ? '(empty)' : (m?.text ?? '?') }],
            };
        },
        async execute() {
            const script = [
                '$ErrorActionPreference = "Continue"',
                'try { $t = Get-Clipboard -Raw -ErrorAction Stop } catch { $t = "" }',
                '$out = [ordered]@{ text = "$t"; empty = ([string]::IsNullOrEmpty("$t")) }',
                '$out | ConvertTo-Json -Compress',
            ].join('; ');
            return psJson(script, timeoutMs);
        },
    }));
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
        presentCall: () => ({
            card: 'generic',
            title: 'Writing to clipboard',
            kind: 'edit',
        }),
        presentResult: (_a, result) => {
            const m = meta(result);
            return {
                card: 'generic',
                title: m?.ok ? `Clipboard: ${m.chars ?? 0} chars` : 'Clipboard write failed',
            };
        },
        async execute(args) {
            const script = [
                `Set-Clipboard -Value (${psStr(b64(args.text))}) -ErrorAction Stop`,
                '$out = [ordered]@{ ok = $true; chars = (Get-Clipboard -Raw).Length }',
                '$out | ConvertTo-Json -Compress',
            ].join('; ');
            return psJson(script, timeoutMs);
        },
    }));
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
        presentCall: () => ({
            card: 'generic',
            title: 'Showing notification',
            kind: 'other',
        }),
        presentResult: (_a, result) => {
            const m = meta(result);
            return {
                card: 'generic',
                title: m?.ok ? 'Notification shown' : 'Notification failed',
            };
        },
        async execute(args) {
            const title = psStr(b64(args.title));
            const message = psStr(b64(args.message));
            const script = [
                `$w = New-Object -ComObject WScript.Shell; $null = $w.Popup(${message}, 6, ${title}, 0x40)`,
                '$out = [ordered]@{ ok = $true }',
                '$out | ConvertTo-Json -Compress',
            ].join('; ');
            return psJson(script, timeoutMs);
        },
    }));
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
        presentCall: () => ({
            card: 'generic',
            title: 'Reading hosts file',
            kind: 'read',
            locations: [{ path: 'C:\\Windows\\System32\\drivers\\etc\\hosts' }],
        }),
        presentResult: (_a, result) => {
            const m = meta(result);
            return {
                card: 'generic',
                title: `Hosts file: ${m?.lines ?? 0} lines`,
            };
        },
        async execute() {
            const script = [
                `$c = Get-Content (${HOSTS_PATH}) -ErrorAction Stop | Out-String`,
                `$n = @(Get-Content (${HOSTS_PATH}) -ErrorAction SilentlyContinue).Count`,
                '$out = [ordered]@{ content = "$c"; lines = $n }',
                '$out | ConvertTo-Json -Compress',
            ].join('; ');
            return psJson(script, timeoutMs);
        },
    }));
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
        presentCall: (args) => ({
            card: 'generic',
            title: `Testing ${args.host ?? 'host'}`,
            kind: 'fetch',
        }),
        presentResult: (_a, result) => {
            const m = meta(result);
            return {
                card: 'generic',
                title: `TCP: ${m?.tcp ?? '?'}`,
                content: [{ type: 'text', text: `DNS: ${m?.dns?.join(', ') ?? '?'}` }],
            };
        },
        async execute(args) {
            const host = args.host;
            const port = (args.port ?? 443);
            const hostExpr = psStr(b64(host));
            const script = [
                '$ErrorActionPreference = "Continue"',
                `try { $dns = [System.Net.Dns]::GetHostAddresses(${hostExpr}) | ForEach-Object { $_.IPAddressToString } } catch { $dns = @("DNS_FAILED") }`,
                `$c = New-Object System.Net.Sockets.TcpClient; try { $t = $c.ConnectAsync(${hostExpr}, ${port}); if ($t.Wait(5000)) { $tcp = "OPEN" } else { $tcp = "TIMEOUT" } } catch { $tcp = "CLOSED" } finally { $c.Dispose() }`,
                '$out = [ordered]@{ dns = @($dns); tcp = $tcp }',
                '$out | ConvertTo-Json -Compress',
            ].join('; ');
            return psJson(script, timeoutMs);
        },
    }));
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
        presentCall: () => ({ card: 'generic', title: 'Listing windows', kind: 'search' }),
        presentResult: (_a, result) => {
            const m = meta(result);
            return { card: 'generic', title: `${m?.count ?? 0} window(s)` };
        },
        async execute() {
            const script = [
                '$ErrorActionPreference = "Continue"',
                '$w = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 60 | ForEach-Object { [ordered]@{ title = $_.MainWindowTitle; process = $_.ProcessName; pid = $_.Id } })',
                '$out = [ordered]@{ windows = @($w); count = $w.Count }',
                '$out | ConvertTo-Json -Compress -Depth 4',
            ].join('; ');
            return psJson(script, timeoutMs);
        },
    }));
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
        presentCall: (args) => ({ card: 'generic', title: `Focusing ${args.title ?? 'window'}`, kind: 'other' }),
        presentResult: (_a, result) => {
            const m = meta(result);
            return { card: 'generic', title: m?.focused ? `Focused: ${m.title}` : 'No matching window' };
        },
        async execute(args) {
            const needle = psStr(b64(args.title));
            const script = [
                '$ErrorActionPreference = "Continue"',
                `$needle = ${needle}`,
                '$w = New-Object -ComObject WScript.Shell',
                '$target = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -and $_.MainWindowTitle.ToLower().Contains($needle.ToLower()) } | Select-Object -First 1',
                'if ($target) { $ok = $w.AppActivate($target.Id); $out = [ordered]@{ focused = [bool]$ok; title = $target.MainWindowTitle; process = $target.ProcessName } }',
                'else { $out = [ordered]@{ focused = $false; title = ""; process = "" } }',
                '$out | ConvertTo-Json -Compress',
            ].join('; ');
            return psJson(script, timeoutMs);
        },
    }));
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
        presentCall: () => ({ card: 'generic', title: 'Capturing the screen', kind: 'read' }),
        presentResult: (_a, result) => {
            const m = meta(result);
            return {
                card: 'generic',
                title: `Screenshot ${m?.width ?? '?'}×${m?.height ?? '?'}`,
                ...(m?.path ? { locations: [{ path: m.path }] } : {}),
            };
        },
        async execute(args) {
            const target = args.path ?? join(tmpdir(), `dsh-screenshot-${Date.now()}.png`);
            const targetExpr = psStr(b64(target));
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
            ].join('; ');
            return psJson(script, Math.max(timeoutMs, 30_000));
        },
    }));
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
        presentCall: () => ({ card: 'generic', title: 'Listing processes', kind: 'search' }),
        presentResult: (_a, result) => {
            const m = meta(result);
            return { card: 'generic', title: `${m?.count ?? 0} process(es)` };
        },
        async execute(args) {
            const filter = psStr(b64(args.name ?? ''));
            const limit = Math.min(Math.max(1, args.limit ?? 20), 100);
            const script = [
                '$ErrorActionPreference = "Continue"',
                `$filter = ${filter}`,
                `$list = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $filter -eq "" -or $_.ProcessName.ToLower().Contains($filter.ToLower()) } | Sort-Object WorkingSet64 -Descending | Select-Object -First ${limit})`,
                '$rows = @($list | ForEach-Object { [ordered]@{ name = $_.ProcessName; pid = $_.Id; memoryMB = [math]::Round($_.WorkingSet64 / 1MB, 1) } })',
                '$out = [ordered]@{ processes = @($rows); count = $rows.Count }',
                '$out | ConvertTo-Json -Compress -Depth 4',
            ].join('; ');
            return psJson(script, timeoutMs);
        },
    }));
}, { inject: ['tools'] });
