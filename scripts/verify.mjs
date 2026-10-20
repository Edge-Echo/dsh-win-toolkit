// Verify the plugin: what it registers, and that the read-only tools actually run.
//
// The previous check only asserted that the module exported a function — it would pass with every
// tool unregistered. This drives the plugin with a fake context, inspects all nine registrations,
// and executes the two that are safe on any machine (listing windows and processes).
//
// Screenshot capture is exercised only outside CI: GitHub's Windows runners are not guaranteed to
// have an interactive desktop session, and a capture failure there would be a false alarm.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const mod = await import(`file://${path.join(root, pkg.main).replace(/\\/g, '/')}`)

let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`)
  if (!ok) failures++
}

const plugin = mod.default
check('default export is a function', typeof plugin === 'function', typeof plugin)
check('declares inject: ["tools"]', Array.isArray(plugin.inject) && plugin.inject.includes('tools'))

const registered = []
plugin({ tools: { register: (d) => registered.push(d) } }, {})
const byName = Object.fromEntries(registered.map((d) => [d.name, d]))

const EXPECTED = [
  'win_clipboard_read',
  'win_clipboard_write',
  'win_notify',
  'win_hosts_list',
  'win_netdiag',
  'win_window_list',
  'win_window_focus',
  'win_screenshot',
  'win_process_list',
]
const names = registered.map((d) => d.name).sort()
check('registers every tool', names.length === EXPECTED.length, names.join(', '))
check('registers the expected names', EXPECTED.every((n) => names.includes(n)))
check(
  'every tool has a description and an output schema',
  registered.every((d) => typeof d.description === 'string' && d.description.length > 20 && d.output?.schema),
)
check('every tool has call and result presentations', registered.every((d) => d.presentCall && d.presentResult))
check('every tool is executable', registered.every((d) => typeof d.execute === 'function'))

// Read-only tools that work without a desktop session.
try {
  const windows = await byName.win_window_list.execute({})
  check('win_window_list returns a count', typeof windows.count === 'number', `${windows.count} windows`)
  check(
    'win_window_list entries carry title, process and pid',
    (windows.windows ?? []).every((w) => typeof w.title === 'string' && typeof w.process === 'string' && typeof w.pid === 'number'),
  )
  const rendered = byName.win_window_list.output.render({}, windows)
  check('win_window_list renders text', rendered[0]?.text?.length > 5)
} catch (err) {
  check('win_window_list executes', false, err.message)
}

try {
  const procs = await byName.win_process_list.execute({ limit: 5 })
  check('win_process_list returns rows', Array.isArray(procs.processes) && procs.processes.length > 0, `${procs.count} rows`)
  check(
    'win_process_list rows are sorted by memory',
    (procs.processes ?? []).every((p, i, a) => i === 0 || a[i - 1].memoryMB >= p.memoryMB),
  )
} catch (err) {
  check('win_process_list executes', false, err.message)
}

// Screenshot: local only, for the reason above.
if (!process.env.CI) {
  try {
    const shot = await byName.win_screenshot.execute({})
    const png = (await readFile(shot.path)).subarray(0, 4)
    check('win_screenshot writes a PNG', png[0] === 0x89 && png.toString('ascii', 1, 4) === 'PNG', shot.path)
    check('win_screenshot reports dimensions', shot.width > 0 && shot.height > 0, `${shot.width}x${shot.height}`)
  } catch (err) {
    check('win_screenshot executes', false, err.message)
  }
} else {
  console.log('SKIP  win_screenshot (CI runner has no guaranteed desktop session)')
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`)
process.exit(failures ? 1 : 0)
