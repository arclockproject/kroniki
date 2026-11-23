// @vitest-environment node
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { audioPlan, convertAudio } from './audio.ts'

const dir = mkdtempSync(path.join(tmpdir(), 'game-audio-'))
const town = path.resolve('src/content/audio/music/town.wav')

describe('audioPlan', () => {
  const rule = { match: '**', format: 'flac', lite: { opusKbps: 96 } } as const
  it('normal build: only uncompressed files become FLAC', () => {
    expect(audioPlan(rule, 'a.wav', false)).toEqual({ codec: 'flac' })
    expect(audioPlan(rule, 'a.AIFF', false)).toEqual({ codec: 'flac' })
    for (const file of ['a.mp3', 'a.m4a', 'a.mp4', 'a.ogg', 'a.flac', 'a.opus'])
      expect(audioPlan(rule, file, false)).toBeNull()
  })
  it('lite: anything becomes Opus; keep / no rule = as it is', () => {
    expect(audioPlan(rule, 'a.m4a', true)).toEqual({ codec: 'opus', kbps: 96 })
    expect(audioPlan({ match: '**', format: 'keep' }, 'a.wav', false)).toBeNull()
    expect(audioPlan({ match: '**', format: 'flac' }, 'a.mp3', true)).toBeNull()
    expect(audioPlan(undefined, 'a.wav', false)).toBeNull()
  })
})

describe('convertAudio', () => {
  it('makes a smaller FLAC and Opus, and caches them', async () => {
    const flac = await convertAudio(town, { codec: 'flac' }, dir)
    expect(flac.endsWith('town.flac')).toBe(true)
    expect(statSync(flac).size).toBeLessThan(statSync(town).size)
    expect(await convertAudio(town, { codec: 'flac' }, dir)).toBe(flac)
    const opus = await convertAudio(town, { codec: 'opus', kbps: 64 }, dir)
    expect(opus.endsWith('town.opus')).toBe(true)
  })
  it('keeps a file ffmpeg cannot read (with a warning)', async () => {
    const warnings: string[] = []
    const broken = path.resolve('package.json')
    expect(await convertAudio(broken, { codec: 'flac' }, dir, (m) => warnings.push(m))).toBe(broken)
    expect(warnings).toHaveLength(1)
  })
})
