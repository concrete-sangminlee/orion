/**
 * Every renderer module must be reachable from the app's entry point.
 *
 * 153 modules (72% of the renderer's lines) once sat in src/ without being
 * imported by the app: simulated panels, duplicate implementations, and
 * features calling IPC methods that never existed. They were never shipped,
 * yet read as features and were "fixed" by audits. A module that the app does
 * not load belongs either wired in or deleted.
 */
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(__dirname, '../..')

describe('renderer reachability', () => {
  it('every non-test module under src/ is reachable from src/main.tsx', () => {
    const report = JSON.parse(
      execFileSync(process.execPath, [path.join(ROOT, 'scripts/audit-reachability.mjs'), '--json'], { cwd: ROOT, encoding: 'utf8' }),
    ) as { unreachable: Array<{ file: string }> }
    expect(report.unreachable.map((entry) => entry.file)).toEqual([])
  }, 60_000)
})
