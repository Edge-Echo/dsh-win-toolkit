// Actually run the four new Windows tools against this machine.
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const pkg = JSON.parse(readFileSync(path.join(root, '..', 'package.json'), 'utf8'))
const mod = await import(new URL(`file://${path.join(root, '..', pkg.main).replace(/\\/g, '/')}`).href)

const registered = []
mod.default({ tools: { register: (d) => registered.push(d) } }, {})
const byName = Object.fromEntries(registered.map((d) => [d.name, d]))

let failures = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  — ${extra}` : ''}`)
  if (!ok) failures++
}

// 1. windows
try {
  const r = await byName.win_window_list.execute({})
  check('win_window_list returns a count', typeof r.count === 'number', `${r.count} windows`)
  check('win_window_list entries have title/process/pid', (r.windows ?? []).every((w) => w.title && w.process && typeof w.pid === 'number'))
} catch (err) {
  check('win_window_list executes', false, err.message)
}

// 2. focus — use a title substring that exists if possible
try {
  const r = await byName.win_window_focus.execute({ title: 'a' })
  check('win_window_focus returns a verdict', typeof r.focused === 'boolean', r.focused ? `focused ${r.title}` : 'no match')
} catch (err) {
  check('win_window_focus executes', false, err.message)
}

// 3. screenshot — the visible one
try {
  const r = await byName.win_screenshot.execute({})
  check('win_screenshot writes a file', existsSync(r.path), r.path)
  check('win_screenshot reports non-zero bytes', r.bytes > 1000, `${r.bytes} bytes`)
  const png = readFileSync(r.path)
  check('win_screenshot output is a PNG', png[0] === 0x89 && png.toString('ascii', 1, 4) === 'PNG', `header ${png.subarray(0, 4).toString('hex')}`)
  check('win_screenshot dimensions are plausible', r.width >= 800 && r.height >= 600, `${r.width}x${r.height}`)
  console.log(`      saved ${r.path} (${Math.round(statSync(r.path).size / 1024)} KB)`)
} catch (err) {
  check('win_screenshot executes', false, err.message)
}

// 4. processes
try {
  const r = await byName.win_process_list.execute({ limit: 5 })
  check('win_process_list returns rows', Array.isArray(r.processes) && r.processes.length > 0, `${r.count} rows`)
  check('win_process_list rows are sorted by memory', (r.processes ?? []).every((p, i, a) => i === 0 || a[i - 1].memoryMB >= p.memoryMB))
  const filtered = await byName.win_process_list.execute({ name: 'node', limit: 3 })
  check('win_process_list filters by name', filtered.processes.every((p) => p.name.toLowerCase().includes('node')), `${filtered.count} node process(es)`)
} catch (err) {
  check('win_process_list executes', false, err.message)
}

// 5. renderers must not throw on real values
try {
  const r = await byName.win_window_list.execute({})
  const rendered = byName.win_window_list.output.render({}, r)
  check('win_window_list renders text', rendered[0]?.text?.length > 10)
} catch (err) {
  check('renderers work', false, err.message)
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`}`)
process.exit(failures ? 1 : 0)
