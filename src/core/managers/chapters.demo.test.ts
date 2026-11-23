// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import config from '@/content/chapters'
import '../game'
import { useGameStore } from '../stores/game'
import { type ChapterId, chapterManager as chapters } from './chapters'

const [first, second] = Object.keys(config.chapters) as [ChapterId, ChapterId]

describe('game.chapters (the chapters in src/content/chapters.ts)', () => {
  beforeEach(() => {
    useGameStore.setState((s) => {
      s.chapter = ''
    })
    vi.restoreAllMocks()
  })

  it('reaching a chapter sets it; again does nothing; unknown ids are refused', () => {
    expect(chapters.current()).toBeUndefined()
    expect(chapters.reach(first)).toBe(true)
    expect(chapters.reach(first)).toBe(false)
    expect(chapters.current()).toBe(first)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(chapters.reach('nope' as never)).toBe(false)
    expect(chapters.current()).toBe(first)
  })

  it('info() gives the title and description', () => {
    expect(chapters.info(second)?.title).toBe(config.chapters[second].title)
    expect(chapters.info('nope')).toBeUndefined()
    expect(chapters.info(null)).toBeUndefined()
  })

  it('labels: the flowchart heading never has the sub; saves get the full "1.2: title"', () => {
    expect(chapters.numberLabel(1, 2)).toContain('1.2')
    expect(chapters.numberLabel(1)).not.toContain('.')
    for (const [n, name] of Object.entries(config.vn_chapters))
      if (name) expect(chapters.numberLabel(Number(n))).toBe(name)
    const id = (Object.keys(config.chapters) as ChapterId[]).find(
      (k) => (config.chapters[k] as { sub?: number }).sub !== undefined,
    )
    if (id) {
      const c = config.chapters[id] as { number: number; sub: number }
      expect(chapters.fullTitle(id)).toContain(`${c.number}.${c.sub}`)
    }
  })
})
