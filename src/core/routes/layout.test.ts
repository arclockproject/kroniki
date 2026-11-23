import { describe, expect, it } from 'vitest'
import type { RouteContext, RouteId } from '../defs/routes'
import { buildGraph } from './graph'
import { layoutGraph } from './layout'

type Loose = {
  event: (id: string, key: string) => Promise<void>
  flag: (id: string) => boolean
  startRoute: (id: string) => ReturnType<RouteContext['startRoute']>
}
const build = (run: (r: Loose) => unknown) =>
  buildGraph('common' as RouteId, run as unknown as (ctx: RouteContext) => unknown)
const sizes = { width: 100, height: 40, gapX: 20, gapY: 30 }

const example = () =>
  build(async ({ event, flag, startRoute }) => {
    await event('x/a', 'a')
    await event('x/d', 'd')
    if (flag('agreed')) await event('x/e', 'e')
    else await event('x/f', 'f')
    if (flag('anna')) await event('x/g', 'g')
    await event('x/h', 'h')
    return startRoute('anna')
  })

describe('layoutGraph', () => {
  it('puts each box one row below the furthest box leading to it', async () => {
    const layout = layoutGraph(await example(), sizes)
    const y = Object.fromEntries(layout.boxes.map((b) => [b.key, b.y / 70]))
    expect(y).toMatchObject({ a: 0, d: 1, e: 2, f: 2, g: 3, h: 4, '@route:anna': 5 })
  })

  it('reads yes before no, never overlaps boxes, and keeps a straight line straight', async () => {
    const layout = layoutGraph(await example(), sizes)
    const box = (k: string) => layout.boxes.find((b) => b.key === k) as { x: number; y: number }
    expect(box('e').x).toBeLessThan(box('f').x)
    expect(box('a').x).toBe(box('d').x)
    for (const a of layout.boxes) {
      for (const b of layout.boxes) {
        if (a !== b && a.y === b.y) expect(Math.abs(a.x - b.x)).toBeGreaterThanOrEqual(120)
      }
    }
  })

  it('a line that skips a row goes through a place holder, not through the box on that row', async () => {
    const layout = layoutGraph(await example(), sizes)
    const g = layout.boxes.find((b) => b.key === 'g') as { x: number; y: number }
    for (const line of layout.lines.filter((l) => l.to === 'h' && l.from !== 'g')) {
      expect(line.points).toHaveLength(3)
      const [hx] = line.points[1] as [number, number]
      expect(hx < g.x || hx > g.x + sizes.width).toBe(true)
    }
  })

  it('centres a box over its two branches, and two lines from one box start apart', async () => {
    const layout = layoutGraph(await example(), sizes)
    const box = (k: string) => layout.boxes.find((b) => b.key === k) as { x: number; y: number }
    expect(box('d').x).toBeCloseTo((box('e').x + box('f').x) / 2)
    const starts = layout.lines.filter((l) => l.from === 'd').map((l) => l.points[0]?.[0])
    expect(starts).toHaveLength(2)
    expect(starts[0]).not.toBe(starts[1])
    // Lines into h end at different points too.
    const ends = layout.lines.filter((l) => l.to === 'h').map((l) => l.points.at(-1)?.[0])
    expect(new Set(ends).size).toBe(ends.length)
  })

  it('leaves hidden boxes and their lines out', async () => {
    const layout = layoutGraph(await example(), sizes, new Set(['g']))
    expect(layout.boxes.map((b) => b.key)).not.toContain('g')
    expect(layout.lines.some((l) => l.from === 'g' || l.to === 'g')).toBe(false)
  })

  it('puts a join back under the box where its ways split, so long charts do not drift', async () => {
    for (const side of ['left', 'right'] as const) {
      const graph = await build(async ({ event, flag }) => {
        await event('x/a', 'a')
        for (let i = 0; i < 5; i++) {
          if (flag(`f${i}`)) await event(`x/y${i}`, `y${i}`)
          else await event(`x/n${i}`, `n${i}`)
          await event(`x/m${i}`, `m${i}`)
        }
      })
      const layout = layoutGraph(graph, sizes, new Set(), { branchSide: side })
      const x = (k: string) => layout.boxes.find((b) => b.key === k)?.x
      for (let i = 0; i < 5; i++) {
        expect(x(`m${i}`)).toBe(x('a'))
        expect(x(`n${i}`)).toBe(x('a'))
      }
    }
  })

  it('a join of several straight lines goes under their split, and a line through its row goes around it', async () => {
    const graph = await buildGraph(
      'common' as RouteId,
      (async (r: Loose & { choice: (o: Record<string, string>) => Promise<string> }) => {
        await r.event('x/a', 'a')
        const pick = await r.choice({ l: 'L', m: 'M', r: 'R' })
        await r.event(`x/${pick}`, pick)
        if (r.flag('extra')) await r.event('x/g', 'g')
        await r.event('x/h', 'h')
      }) as unknown as (ctx: RouteContext) => unknown,
    )
    const layout = layoutGraph(graph, sizes, new Set(), { branchSide: 'right' })
    const x = (k: string) => layout.boxes.find((b) => b.key === k)?.x
    expect(x('m')).toBe(x('a'))
    expect(x('g')).toBe(x('a'))
    expect(x('h')).toBe(x('a'))
    expect(x('l')).toBeLessThan(x('a') as number)
    expect(x('r')).toBeGreaterThan(x('a') as number)
  })

  it('lines from far off enter a crowded box from its sides, and corner lines never overlap', async () => {
    const graph = await buildGraph(
      'common' as RouteId,
      (async (r: Loose & { choice: (o: Record<string, string>) => Promise<string> }) => {
        await r.event('x/a', 'a')
        const pick = await r.choice({ l: 'L', m: 'M', r: 'R' })
        await r.event(`x/${pick}`, pick)
        if (r.flag('extra')) await r.event('x/g', 'g')
        await r.event('x/h', 'h')
      }) as unknown as (ctx: RouteContext) => unknown,
    )
    const layout = layoutGraph(graph, sizes, new Set(), { branchSide: 'right' })
    const box = (k: string) => layout.boxes.find((b) => b.key === k) as { x: number; width: number }
    const intoH = layout.lines.filter((l) => l.to === 'h' && l.sideEnd)
    const ends = intoH.map((l) => (l.points.at(-1) as [number, number])[0])
    expect(ends).toContain(box('h').x)
    expect(ends).toContain(box('h').x + box('h').width)
    // Lines leaving diamond corners run across at the diamonds' height: no two overlap.
    const runs = layout.lines
      .filter((l) => l.side)
      .map((l) => {
        const [a, b] = l.points as [[number, number], [number, number]]
        return { y: a[1], lo: Math.min(a[0], b[0]), hi: Math.max(a[0], b[0]) }
      })
    for (const p of runs)
      for (const q of runs)
        if (p !== q && p.y === q.y) expect(p.hi <= q.lo || q.hi <= p.lo).toBe(true)
  })

  it('flow.ts enter picks the edge a line goes into', async () => {
    const graph = await example()
    const auto = layoutGraph(graph, sizes, new Set(), { branchSide: 'right' })
    const line = auto.lines.find((l) => l.to === 'h' && l.from !== 'g') as { from: string }
    const forced = layoutGraph(graph, sizes, new Set(), {
      branchSide: 'right',
      nodes: { [line.from]: { lines: { h: { enter: 'top' } } } },
    })
    expect(auto.lines.find((l) => l.from === line.from && l.to === 'h')?.sideEnd).toBe(true)
    const top = forced.lines.find((l) => l.from === line.from && l.to === 'h')
    expect(top?.sideEnd).toBeUndefined()
    const h = forced.boxes.find((b) => b.key === 'h') as { y: number }
    expect(top?.points.at(-1)?.[1]).toBe(h.y)
  })
})
