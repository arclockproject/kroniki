import { describe, expect, it } from 'vitest'
import type { RouteContext, RouteId } from '../defs/routes'
import { chartGraph } from './chart'
import { buildGraph } from './graph'
import { layoutGraph } from './layout'

type Loose = {
  event: (id: string, key: string) => Promise<void>
  flag: (id: string) => boolean
  choice: (o: Record<string, string>) => Promise<string>
}
const build = (run: (r: Loose) => unknown) =>
  buildGraph('common' as RouteId, run as unknown as (ctx: RouteContext) => unknown)
const sizes = { width: 100, height: 40, gapX: 20, gapY: 30 }

// a, then: met? -> g, then h; not met -> straight to h.
const ifBlock = () =>
  build(async ({ event, flag }) => {
    await event('x/a', 'a')
    if (flag('met')) await event('x/g', 'g')
    await event('x/h', 'h')
  })

describe('chartGraph', () => {
  it('puts a diamond between a box and its flag split', async () => {
    const chart = chartGraph(await ifBlock(), { branchSide: 'right' })
    const [d] = Object.values(chart.branches)
    expect(d).toMatchObject({ owner: 'a', kind: 'flag', name: 'met' })
    const key = d?.key as string
    const lines = chart.edges
      .filter((e) => e.to !== '@end')
      .map((e) => `${e.from}>${e.to}`)
      .sort()
    expect(lines).toEqual(['@start>a', `${key}>g`, `${key}>h`, `a>${key}`, 'g>h'].sort())
    const no = chart.edges.find((e) => e.from === key && e.to === 'h')
    const yes = chart.edges.find((e) => e.from === key && e.to === 'g')
    expect(no).toMatchObject({ straight: true, side: false, pairs: ['a>h'] })
    expect(yes).toMatchObject({ straight: false, side: true, pairs: ['a>g'] })
  })

  it('no diamonds without branchSide; a flag that changes nothing gets none either', async () => {
    expect(chartGraph(await ifBlock()).branches).toEqual({})
    const g = await build(async ({ event, flag }) => {
      await event('x/a', 'a')
      flag('unused')
      await event('x/h', 'h')
    })
    expect(chartGraph(g, { branchSide: 'right' }).branches).toEqual({})
  })

  it('a flag right after a choice: the option line goes into a diamond', async () => {
    const g = await build(async ({ event, flag, choice }) => {
      await event('x/a', 'a')
      const p = await choice({ go: 'Go', stay: 'Stay' })
      if (p === 'go' && flag('rain')) await event('x/wet', 'wet')
      await event('x/h', 'h')
    })
    const chart = chartGraph(g, { branchSide: 'right' })
    const [d] = Object.values(chart.branches)
    expect(d?.owner).toBe('?go_stay')
    const toD = chart.edges.find((e) => e.to === d?.key)
    expect(toD).toMatchObject({ from: '?go_stay', values: ['go'], labels: ['Go'] })
    expect(chart.edges.find((e) => e.from === '?go_stay' && e.to === 'h')?.labels).toEqual(['Stay'])
  })

  it('answers given before the box decide: plain lines, no diamond', async () => {
    const g = await build(async ({ event, flag }) => {
      const early = flag('early')
      await event('x/a', 'a')
      if (early) await event('x/b', 'b')
      else await event('x/c', 'c')
    })
    const chart = chartGraph(g, { branchSide: 'right' })
    expect(chart.branches).toEqual({})
    expect(
      chart.edges
        .filter((e) => e.from === 'a')
        .map((e) => e.to)
        .sort(),
    ).toEqual(['b', 'c'])
  })
})

describe('layout with diamonds', () => {
  it('"no" runs straight down through the diamond, "yes" leaves from its side to the right', async () => {
    const layout = layoutGraph(await ifBlock(), sizes, new Set(), {
      branchSide: 'right',
      branchSize: 20,
    })
    const box = (k: string) => layout.boxes.find((b) => b.key === k) as (typeof layout.boxes)[0]
    const d = layout.boxes.find((b) => b.key.startsWith('!')) as (typeof layout.boxes)[0]
    const cx = (b: typeof d) => b.x + b.width / 2
    expect(cx(d)).toBeCloseTo(cx(box('a')))
    expect(cx(box('h'))).toBeCloseTo(cx(d))
    expect(cx(box('g'))).toBeGreaterThan(cx(d))
    expect(box('g').y).toBeGreaterThan(d.y)
    const yes = layout.lines.find((l) => l.from === d.key && l.to === 'g')
    expect(yes?.side).toBe(true)
    expect(yes?.points[0]).toEqual([d.x + d.width, d.y + d.height / 2])
    // A diamond row is shorter than a box row.
    expect(d.height).toBe(20)
    expect(box('g').y - d.y).toBeLessThan(sizes.height + sizes.gapY)
  })

  it('branchSide left puts "yes" on the left', async () => {
    const layout = layoutGraph(await ifBlock(), sizes, new Set(), { branchSide: 'left' })
    const box = (k: string) => layout.boxes.find((b) => b.key === k) as (typeof layout.boxes)[0]
    expect(box('g').x).toBeLessThan(box('h').x)
  })

  it('shift: empty or missing changes nothing; a shift moves only that box and its line ends', async () => {
    const opts = { branchSide: 'right' as const, branchSize: 20 }
    const base = layoutGraph(await ifBlock(), sizes, new Set(), opts)
    expect(layoutGraph(await ifBlock(), sizes, new Set(), { ...opts, nodes: {} })).toEqual(base)
    expect(
      layoutGraph(await ifBlock(), sizes, new Set(), {
        ...opts,
        nodes: { g: {}, h: { title: 'H' } },
      }),
    ).toEqual(base)
    const moved = layoutGraph(await ifBlock(), sizes, new Set(), {
      ...opts,
      nodes: { g: { shift: { x: 30, y: 10 } } },
    })
    const at = (l: typeof base, k: string) =>
      l.boxes.find((b) => b.key === k) as (typeof l.boxes)[0]
    expect(at(moved, 'g').x - at(base, 'g').x).toBe(30)
    expect(at(moved, 'g').y - at(base, 'g').y).toBe(10)
    expect(at(moved, 'h')).toEqual(at(base, 'h'))
    const into = moved.lines.find((l) => l.to === 'g')
    expect(into?.points.at(-1)).toEqual([at(moved, 'g').x + sizes.width / 2, at(moved, 'g').y])
  })

  it('shift up past the top moves the whole chart down, never off it', async () => {
    const layout = layoutGraph(await ifBlock(), sizes, new Set(), {
      branchSide: 'right',
      nodes: { a: { shift: { y: -50 } } },
    })
    expect(Math.min(...layout.boxes.map((b) => b.y))).toBe(0)
    for (const b of layout.boxes) expect(b.y + b.height).toBeLessThanOrEqual(layout.height)
  })
})

// Hand fixes (flow.ts): every option, on event boxes, choice boxes and diamonds.
describe('layout fixes from flow.ts', () => {
  const opts = { branchSide: 'right' as const, branchSize: 20 }
  type L = ReturnType<typeof layoutGraph>
  const at = (l: L, k: string) => l.boxes.find((b) => b.key === k) as L['boxes'][0]
  const mid = (l: L, k: string) => at(l, k).x + at(l, k).width / 2
  const line = (l: L, from: string, to: string) =>
    l.lines.find((x) => x.from === from && x.to === to) as L['lines'][0]
  // Two choice options, the second checks a flag: choice box, diamond, three boxes.
  const mixed = () =>
    build(async ({ event, flag, choice }) => {
      await event('x/a', 'a')
      const p = await choice({ go: 'Go', stay: 'Stay' })
      if (p === 'go') await event('x/b', 'b')
      else if (flag('rain')) await event('x/c', 'c')
      await event('x/h', 'h')
    })

  it('diamond keys are readable: "!box", then "!box:<answer>" further on', async () => {
    const chart = chartGraph(await mixed(), { branchSide: 'right' })
    expect(Object.keys(chart.branches)).toEqual(['!?go_stay:stay'])
    const g = await build(async ({ event, flag }) => {
      await event('x/a', 'a')
      if (flag('one')) await event('x/b', 'b')
      else if (flag('two')) await event('x/c', 'c')
      await event('x/h', 'h')
    })
    expect(Object.keys(chartGraph(g, { branchSide: 'right' }).branches).sort()).toEqual([
      '!a',
      '!a:false',
    ])
  })

  it('column puts a box (or a diamond) in a grid column, others make room', async () => {
    const base = layoutGraph(await mixed(), sizes, new Set(), opts)
    const l = layoutGraph(await mixed(), sizes, new Set(), {
      ...opts,
      nodes: { b: { column: 3 } },
    })
    expect(mid(l, 'b')).toBeCloseTo(l.grid.origin + 3 * l.grid.step)
    expect(mid(base, 'b')).not.toBeCloseTo(mid(l, 'b'))
    const d = layoutGraph(await mixed(), sizes, new Set(), {
      ...opts,
      nodes: { '!?go_stay:stay': { column: 2 } },
    })
    expect(mid(d, '!?go_stay:stay')).toBeCloseTo(d.grid.origin + 2 * d.grid.step)
  })

  it('row moves a box down (never up past its parents), and the boxes after it', async () => {
    const base = layoutGraph(await ifBlock(), sizes, new Set(), opts)
    const l = layoutGraph(await ifBlock(), sizes, new Set(), { ...opts, nodes: { g: { row: 4 } } })
    expect(at(l, 'g').y).toBeGreaterThan(at(base, 'g').y)
    expect(at(l, 'h').y).toBeGreaterThan(at(l, 'g').y)
    const up = layoutGraph(await ifBlock(), sizes, new Set(), { ...opts, nodes: { h: { row: 0 } } })
    expect(at(up, 'h').y).toBe(at(base, 'h').y)
  })

  it('order swaps boxes in a row; branchSide flips one diamond (or its box) only', async () => {
    const base = layoutGraph(await mixed(), sizes, new Set(), opts)
    expect(mid(base, 'b')).toBeLessThan(mid(base, '!?go_stay:stay'))
    const l = layoutGraph(await mixed(), sizes, new Set(), {
      ...opts,
      nodes: { b: { order: 5 } },
    })
    expect(mid(l, 'b')).toBeGreaterThan(mid(l, '!?go_stay:stay'))
    for (const nodes of [
      { '!?go_stay:stay': { branchSide: 'left' as const } },
      { '?go_stay': { branchSide: 'left' as const } },
    ]) {
      const f = layoutGraph(await mixed(), sizes, new Set(), { ...opts, nodes })
      expect(mid(f, 'c')).toBeLessThan(mid(f, '!?go_stay:stay'))
    }
  })

  it('align keeps a box under another; branchShift moves the diamonds after a box', async () => {
    const l = layoutGraph(await mixed(), sizes, new Set(), {
      ...opts,
      nodes: { c: { align: 'b' } },
    })
    expect(mid(l, 'c')).toBeCloseTo(mid(l, 'b'))
    const base = layoutGraph(await mixed(), sizes, new Set(), opts)
    const s = layoutGraph(await mixed(), sizes, new Set(), {
      ...opts,
      nodes: { '?go_stay': { branchShift: { x: 7, y: 3 } } },
    })
    const k = '!?go_stay:stay'
    expect(at(s, k).x - at(base, k).x).toBeCloseTo(7)
    expect(at(s, k).y - at(base, k).y).toBeCloseTo(3)
  })

  it('lines: straight swaps the straight way out of a diamond', async () => {
    const l = layoutGraph(await ifBlock(), sizes, new Set(), {
      ...opts,
      nodes: { a: { lines: { g: { straight: true } } } },
    })
    expect(mid(l, 'g')).toBeCloseTo(mid(l, '!a'))
    expect(line(l, '!a', 'h').side).toBe(true)
    expect(line(l, '!a', 'g').side).toBeUndefined()
  })

  it('lines: hide, via, start / end, bend, on choice and diamond lines', async () => {
    const l = layoutGraph(await mixed(), sizes, new Set(), {
      ...opts,
      nodes: {
        '?go_stay': { lines: { b: { start: -30, end: 20, bend: 6 } } },
        '!?go_stay:stay': { lines: { c: { via: [[400, 150]] } } },
        a: { lines: { '?go_stay': { hide: true } } },
      },
    })
    expect(l.lines.some((x) => x.from === 'a')).toBe(false)
    const b = line(l, '?go_stay', 'b')
    expect(b.points[0]?.[0]).toBeCloseTo(mid(l, '?go_stay') - 30)
    expect(b.points.at(-1)?.[0]).toBeCloseTo(mid(l, 'b') + 20)
    const [p0, p1] = b.points as [[number, number], [number, number]]
    expect(b.bends?.[0]).toBeCloseTo((p0[1] + p1[1]) / 2 + 6)
    expect(line(l, '!?go_stay:stay', 'c').points[1]).toEqual([400, 150])
    // On the diamond's box too ("lines leaving this box or its diamonds").
    const viaBox = layoutGraph(await mixed(), sizes, new Set(), {
      ...opts,
      nodes: { '?go_stay': { lines: { c: { hide: true } } } },
    })
    expect(viaBox.lines.some((x) => x.to === 'c')).toBe(false)
  })

  it('autoFix: lines running across between the same rows get their own heights', async () => {
    const fan = () =>
      build(async ({ event, choice }) => {
        await event('x/a', 'a')
        const p = await choice({ p: 'P', q: 'Q', r: 'R', s: 'S' })
        await event(`x/${p}`, p)
        await event('x/h', 'h')
      })
    const off = layoutGraph(await fan(), sizes, new Set(), opts)
    const on = layoutGraph(await fan(), sizes, new Set(), { ...opts, autoFix: true })
    expect(off.lines.every((x) => !x.bends)).toBe(true)
    // Runs out of the choice that overlap left to right never share a height.
    const runs = on.lines
      .filter((x) => x.from.startsWith('?'))
      .map((x) => {
        const [a, b] = x.points as [[number, number], [number, number]]
        return { lo: Math.min(a[0], b[0]), hi: Math.max(a[0], b[0]), y: x.bends?.[0] }
      })
    expect(runs.every((r) => r.y !== undefined)).toBe(true)
    for (const r of runs)
      for (const q of runs) if (r !== q && r.lo < q.hi && q.lo < r.hi) expect(r.y).not.toBe(q.y)
    expect(new Set(runs.map((r) => r.y)).size).toBeGreaterThan(1)
  })

  it('compact shrinks gaps where every line goes straight down', async () => {
    const g = await build(async ({ event }) => {
      await event('x/a', 'a')
      await event('x/b', 'b')
    })
    const l = layoutGraph(g, sizes, new Set(), { ...opts, compact: 8 })
    expect(at(l, 'b').y - at(l, 'a').y).toBe(sizes.height + 8)
  })
})

describe('chapters', () => {
  type C = Loose & { chapter: (id: string) => void }
  // The reference example: three branches; two start chapter 2 before their 2nd event, the third
  // only after its 2nd event; each then plays one more event, and they join again.
  const three = () =>
    buildGraph(
      'common' as RouteId,
      (async ({ event, choice, chapter }: C) => {
        chapter('one')
        await event('x/a', 'a')
        const p = await choice({ x: 'X', y: 'Y', z: 'Z' })
        await event(`x/${p}1`, `${p}1`)
        if (p !== 'z') chapter('two')
        await event(`x/${p}2`, `${p}2`)
        if (p === 'z') chapter('two')
        await event(`x/${p}3`, `${p}3`)
        await event('x/m', 'm')
      }) as unknown as (ctx: RouteContext) => unknown,
    )
  const rank: Record<string, number> = { one: 1, two: 2 }
  const rankOf = (g: Awaited<ReturnType<typeof three>>) => (k: string) => {
    const r = (g.chapters[k] ?? []).map((c) => rank[c] as number)
    return r.length ? Math.max(...r) : undefined
  }

  it('the graph knows the chapter each box is entered in', async () => {
    const g = await three()
    expect(g.chapters.a).toEqual(['one'])
    expect(g.chapters.x2).toEqual(['two'])
    expect(g.chapters.z2).toEqual(['one'])
    expect(g.chapters.z3).toEqual(['two'])
    expect(g.chapters.m).toEqual(['two'])
  })

  it('a later chapter is always below its line, even a branch that starts it later', async () => {
    const g = await three()
    const l = layoutGraph(g, sizes, new Set(), { branchSide: 'right', chapterRank: rankOf(g) })
    const y = (k: string) => l.boxes.find((b) => b.key === k)?.y as number
    expect(l.chapters.map((c) => c.rank)).toEqual([1, 2])
    const two = l.chapters[1] as { top: number; height: number }
    const line = two.top + two.height
    for (const k of ['a', 'x1', 'y1', 'z1', 'z2']) expect(y(k)).toBeLessThan(line)
    for (const k of ['x2', 'y2', 'x3', 'y3', 'z3', 'm']) expect(y(k)).toBeGreaterThanOrEqual(line)
    // z2 plays in the same step as x2 / y2 but sits higher: it is still in chapter 1.
    expect(y('z2')).toBeLessThan(y('x2'))
    expect(y('x2')).toBe(y('y2'))
    // Chapter 1 starts before the first box: its header is at the very top.
    expect(l.chapters[0]?.top).toBe(0)
    expect(y('a')).toBeGreaterThanOrEqual(l.chapters[0]?.height as number)
  })

  it('a sub chapter (1.1 -> 1.2) is the same number: one line, nothing pushed below it', async () => {
    const g = await three()
    const sameNumber = (k: string) => ((g.chapters[k] ?? []).length ? 1 : undefined)
    const l = layoutGraph(g, sizes, new Set(), { branchSide: 'right', chapterRank: sameNumber })
    expect(l.chapters.map((c) => c.rank)).toEqual([1])
    const y = (k: string) => l.boxes.find((b) => b.key === k)?.y as number
    expect(y('z2')).toBe(y('x2'))
  })

  it('no chapter() = the layout is the same as before', async () => {
    const g = await ifBlock()
    expect(g.chapters).toEqual({})
    const opts = { branchSide: 'right' as const }
    expect(layoutGraph(g, sizes, new Set(), { ...opts, chapterRank: () => undefined })).toEqual(
      layoutGraph(g, sizes, new Set(), opts),
    )
  })
})

describe('ending() and hidden options in the graph', () => {
  type E = Loose & { ending: (id: string) => unknown }
  it('ending() ends at the end box; anything after it is a mistake', async () => {
    const g = await buildGraph(
      'common' as RouteId,
      (async ({ event, ending }: E) => {
        await event('x/a', 'a')
        return ending('good')
      }) as unknown as (ctx: RouteContext) => unknown,
    )
    expect(g.paths[0]?.nodes).toEqual(['@start', 'a', '@end'])
    await expect(
      buildGraph(
        'common' as RouteId,
        (async ({ event, ending }: E) => {
          ending('good')
          await event('x/a', 'a')
        }) as unknown as (ctx: RouteContext) => unknown,
      ),
    ).rejects.toThrow(/after ending\('good'\)/)
  })

  it('a choice box keeps its option keys and which ones are hidden', async () => {
    const g = await buildGraph(
      'common' as RouteId,
      (async ({ choice }: Loose) => {
        await (choice as (o: object, a: object) => Promise<string>)(
          { a: 'A', s: 'S' },
          { hidden: { s: { requiresEnding: ['anna'] } } },
        )
      }) as unknown as (ctx: RouteContext) => unknown,
    )
    expect(g.nodes['?a_s']).toMatchObject({
      kind: 'choice',
      keys: ['a', 's'],
      hidden: { s: { requiresEnding: ['anna'] } },
    })
  })
})
