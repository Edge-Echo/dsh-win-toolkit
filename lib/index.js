import { defineTool } from '@deepseek-ai/dsh-tools';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
}, { inject: ['tools'] });
