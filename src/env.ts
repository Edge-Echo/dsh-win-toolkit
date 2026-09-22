// dsh-win-toolkit — environment checks.
//
// The plugin's tools call Windows PowerShell; whether they will work depends on
// the machine, not on the plugin. `runEnvDoctor` answers that question up front
// so a user finds out before their agent does.
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const DEFAULT_TIMEOUT_MS = 15000

/** Run one PowerShell script; returns trimmed stdout. */
export async function ps(script: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  )
  return stdout.trim()
}

async function tryPs(script: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string | null> {
  try {
    return await ps(script, timeoutMs)
  } catch {
    return null
  }
}

export type FindingLevel = 'ok' | 'warn' | 'error'

export interface Finding {
  level: FindingLevel
  title: string
  detail?: string
}

export interface EnvReport {
  ok: boolean
  findings: Finding[]
  suggestions: string[]
  /** Raw values the findings were derived from. */
  raw: {
    platform: string
    powershell?: string
    executionPolicy?: string
    clipboard?: string
    comObject?: string
    hostsReadable?: boolean
  }
}

/**
 * Check everything the toolkit's tools depend on: the platform, PowerShell,
 * the execution policy, clipboard access, WScript.Shell COM (notifications)
 * and hosts-file readability.
 */
export async function runEnvDoctor(timeoutMs = DEFAULT_TIMEOUT_MS): Promise<EnvReport> {
  const findings: Finding[] = []
  const suggestions: string[] = []
  const raw: EnvReport['raw'] = { platform: process.platform }

  // ── platform ────────────────────────────────────────────────────────────
  if (process.platform !== 'win32') {
    findings.push({
      level: 'error',
      title: `Running on ${process.platform} — the toolkit is Windows-only`,
      detail: 'The tools call powershell.exe; on this platform they will fail.',
    })
    suggestions.push('Install the toolkit on a Windows machine, or use dsh-netassist for cross-platform network checks.')
    return { ok: false, findings, suggestions, raw }
  }
  findings.push({ level: 'ok', title: `Platform: Windows (${process.arch})` })

  // ── PowerShell ──────────────────────────────────────────────────────────
  const psVersion = await tryPs('$PSVersionTable.PSVersion.ToString()', timeoutMs)
  raw.powershell = psVersion ?? undefined
  if (psVersion) {
    const major = Number(psVersion.split('.')[0])
    if (Number.isFinite(major) && major >= 5) {
      findings.push({ level: 'ok', title: `PowerShell ${psVersion} available` })
    } else {
      findings.push({
        level: 'error',
        title: `PowerShell ${psVersion} is too old`,
        detail: 'The tools use Get-Clipboard and New-Object -ComObject, which need PowerShell 5.1+.',
      })
      suggestions.push('Install Windows Management Framework 5.1 or PowerShell 7.')
    }
  } else {
    findings.push({
      level: 'error',
      title: 'powershell.exe could not be started',
      detail: 'Either it is missing from PATH or a policy blocks it.',
    })
    suggestions.push('Verify with `powershell -Command "$PSVersionTable.PSVersion"` in a terminal; check antivirus or AppLocker policy.')
  }

  // ── execution policy ────────────────────────────────────────────────────
  const policy = await tryPs('Get-ExecutionPolicy', timeoutMs)
  raw.executionPolicy = policy ?? undefined
  if (policy) {
    if (/Restricted|AllSigned/i.test(policy)) {
      findings.push({
        level: 'warn',
        title: `Execution policy: ${policy}`,
        detail: 'Inline commands (which the toolkit uses) still run, but scripts do not.',
      })
    } else {
      findings.push({ level: 'ok', title: `Execution policy: ${policy}` })
    }
  } else {
    findings.push({ level: 'warn', title: 'Could not read the execution policy' })
  }

  // ── clipboard ───────────────────────────────────────────────────────────
  const clip = await tryPs('try { $c = Get-Clipboard -Raw -ErrorAction Stop; "readable" } catch { "unreadable" }', timeoutMs)
  raw.clipboard = clip ?? undefined
  if (clip === 'readable') {
    findings.push({ level: 'ok', title: 'Clipboard is accessible (win_clipboard_read/write will work)' })
  } else {
    findings.push({
      level: 'warn',
      title: 'Clipboard could not be read',
      detail: 'Usually a session-type issue: services and non-interactive sessions have no clipboard.',
    })
    suggestions.push('Run dsh from an interactive desktop session if you need the clipboard tools.')
  }

  // ── notifications (WScript.Shell COM) ───────────────────────────────────
  const com = await tryPs('try { $null = New-Object -ComObject WScript.Shell; "available" } catch { "unavailable" }', timeoutMs)
  raw.comObject = com ?? undefined
  if (com === 'available') {
    findings.push({ level: 'ok', title: 'WScript.Shell COM available (win_notify will work)' })
  } else {
    findings.push({
      level: 'warn',
      title: 'WScript.Shell COM object is unavailable',
      detail: 'win_notify needs it to show a popup.',
    })
  }

  // ── hosts file ──────────────────────────────────────────────────────────
  const hosts = await tryPs('try { $null = Get-Content "$env:WINDIR\\System32\\drivers\\etc\\hosts" -ErrorAction Stop; "readable" } catch { "unreadable" }', timeoutMs)
  raw.hostsReadable = hosts === 'readable'
  if (hosts === 'readable') {
    findings.push({ level: 'ok', title: 'Hosts file is readable (win_hosts_list will work)' })
  } else {
    findings.push({ level: 'warn', title: 'Hosts file could not be read', detail: 'win_hosts_list will fail.' })
  }

  const ok = !findings.some((f) => f.level === 'error')
  return { ok, findings, suggestions, raw }
}

const ICON: Record<FindingLevel, string> = { ok: '✔', warn: '⚠', error: '✖' }

/** Render the environment report for a terminal. */
export function renderEnvReport(report: EnvReport): string {
  const lines: string[] = []
  for (const f of report.findings) {
    lines.push(`${ICON[f.level]} ${f.title}`)
    if (f.detail) lines.push(`   ${f.detail}`)
  }
  lines.push('')
  if (report.suggestions.length) {
    lines.push('Suggested fix:')
    for (const s of report.suggestions) lines.push(`- ${s}`)
  } else {
    lines.push('Environment looks good — every toolkit tool should work.')
  }
  return lines.join('\n')
}
