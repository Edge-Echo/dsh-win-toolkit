#!/usr/bin/env node
// dsh-win-toolkit CLI — check the environment the tools depend on.
//
//   dsh-win-toolkit doctor [--json]   verify PowerShell, clipboard, COM, hosts
//   dsh-win-toolkit list   [--json]   list the tools this plugin provides
//
// Exit codes: 0 = environment ok, 1 = a blocking problem, 2 = usage error.
import { readFileSync } from 'node:fs'
import { renderEnvReport, runEnvDoctor } from './env.js'

interface Args {
  command: string
  json: boolean
}

function parseArgs(argv: string[]): Args {
  const out: Args = { command: '', json: false }
  const rest = [...argv]
  out.command = rest.shift() ?? ''
  while (rest.length) {
    const t = rest.shift()!
    switch (t) {
      case '--json': out.json = true; break
      case '--help': case '-h': out.command = '--help'; break
      case '--version': case '-v': out.command = '--version'; break
      default:
        if (t.startsWith('--')) { console.error(`Unknown option: ${t}`); process.exit(2) }
    }
  }
  return out
}

const TOOLS = [
  { name: 'win_clipboard_read', description: 'Read the current clipboard text' },
  { name: 'win_clipboard_write', description: 'Write text to the clipboard' },
  { name: 'win_notify', description: 'Show a system popup notification' },
  { name: 'win_hosts_list', description: 'Read the Windows hosts file' },
  { name: 'win_netdiag', description: 'DNS resolution + TCP port test for a host' },
]

const HELP = `dsh-win-toolkit — Windows-native tools for DeepSeek Harness

Usage:
  dsh-win-toolkit doctor [--json]
      Check everything the tools depend on: Windows, PowerShell, execution
      policy, clipboard access, WScript.Shell COM and hosts-file readability.

  dsh-win-toolkit list [--json]
      List the tools this plugin registers.

Exit codes: 0 environment ok · 1 blocking problem · 2 usage error.

Examples:
  dsh-win-toolkit doctor
  dsh-win-toolkit doctor --json > env.json
`

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))

  if (args.command === '--version') {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
    console.log(pkg.version)
    return 0
  }
  if (args.command === '' || args.command === '--help' || args.command === 'help') {
    console.log(HELP)
    return args.command === '' ? 2 : 0
  }

  if (args.command === 'doctor') {
    const report = await runEnvDoctor()
    console.log(args.json ? JSON.stringify(report, null, 2) : renderEnvReport(report))
    return report.ok ? 0 : 1
  }

  if (args.command === 'list') {
    if (args.json) { console.log(JSON.stringify(TOOLS, null, 2)); return 0 }
    console.log(`${TOOLS.length} tools:\n`)
    for (const t of TOOLS) console.log(`  ${t.name.padEnd(22)} ${t.description}`)
    return 0
  }

  console.error(`Unknown command: ${args.command}\n`)
  console.log(HELP)
  return 2
}

process.exit(await main())
