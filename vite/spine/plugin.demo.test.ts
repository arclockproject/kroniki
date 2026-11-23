// The Spine export generator, on a copy of the demo driver's export (src/content/characters/driver).
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateFromSpine } from './plugin.ts'

const SOURCE = path.resolve(import.meta.dirname, '../../src/content/characters/driver/portraits')
let dir = ''

function copyExport() {
  dir = mkdtempSync(path.join(tmpdir(), 'spine-'))
  for (const file of ['driver.json', 'driver.atlas', 'driver.png'])
    copyFileSync(path.join(SOURCE, file), path.join(dir, file))
  return path.join(dir, 'driver.atlas')
}

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = ''
})

describe('Spine export -> .gen.ts', () => {
  it('lists the files, animations, skins and a box every animation fits in', () => {
    const atlas = copyExport()
    const warnings: string[] = []
    expect(generateFromSpine(atlas, (m) => warnings.push(m))).toBe(true)
    const module = readFileSync(path.join(dir, 'driver.gen.ts'), 'utf8')
    expect(module).toContain("import skeleton from './driver.json?url'")
    expect(module).toContain("import atlas from './driver.atlas?url'")
    expect(module).toContain('pages: { "driver.png": page0 }')
    expect(module).toContain('binary: false')
    expect(module).toContain('"idle", "happy", "wave_in", "wave", "surprised", "talk", "blink"')
    expect(module).toContain('"hat/cap", "hat/party"')
    // The waving arm reaches past the body: the box is wider than the setup pose (430).
    const box = /box: \{ x: (-?\d+), y: (-?\d+), width: (\d+), height: (\d+) \}/.exec(module)
    expect(Number(box?.[3])).toBeGreaterThan(600)
    expect(warnings).toEqual([])
    // Nothing changed: nothing written.
    expect(generateFromSpine(atlas, () => {})).toBe(false)
  })

  it('warns when the export comes from another Spine version than the runtime', () => {
    const atlas = copyExport()
    const json = path.join(dir, 'driver.json')
    writeFileSync(json, readFileSync(json, 'utf8').replace('"spine":"4.3.13"', '"spine":"4.2.40"'))
    const warnings: string[] = []
    generateFromSpine(atlas, (m) => warnings.push(m))
    expect(warnings.join('\n')).toMatch(
      /exported with Spine 4\.2\.40.*Export it again with Spine 4\.3/,
    )
  })

  it('refuses a folder with both a Spine export and an Aseprite file', () => {
    const atlas = copyExport()
    writeFileSync(path.join(dir, 'driver.aseprite'), '')
    expect(() => generateFromSpine(atlas, () => {})).toThrow(/one or the other/)
  })

  it('says so when the skeleton is missing', () => {
    const atlas = copyExport()
    rmSync(path.join(dir, 'driver.json'))
    const warnings: string[] = []
    expect(generateFromSpine(atlas, (m) => warnings.push(m))).toBe(false)
    expect(warnings.join('\n')).toMatch(/no skeleton next to it/)
  })
})
