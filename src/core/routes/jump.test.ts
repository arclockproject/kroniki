import { describe, expect, it } from 'vitest'
import type { RouteContext, RouteId } from '../defs/routes'
import { buildGraph, type RouteGraph, routeBox, START } from './graph'
import { devWayPlan, jumpPlan, type Marks, routeChain, wayTo } from './jump'

type Loose = {
  event: (id: string, key: string) => Promise<void>
  flag: (id: string) => boolean
  startRoute: (id: string) => ReturnType<RouteContext['startRoute']>
}
const build = (id: string, run: (r: Loose) => unknown) =>
  buildGraph(id as RouteId, run as unknown as (ctx: RouteContext) => unknown)

// The reference example, cut down: d splits into e / f, g may be skipped, both reach h.
const common = () =>
  build('common', async ({ event, flag, startRoute }) => {
    await event('x/a', 'a')
    await event('x/d', 'd')
    if (flag('agreed')) await event('x/e', 'e')
    else await event('x/f', 'f')
    if (flag('anna')) await event('x/g', 'g')
    await event('x/h', 'h')
    if (flag('agreed')) return startRoute('anna')
    return startRoute('bad_end')
  })
const anna = () => build('anna', async ({ event }) => event('x/walk', 'walk'))

/** Seen / picked marks: a list in time order (later = more recent). */
function marks(seen: string[], picked: string[] = []): Marks {
  const at = (list: string[], route: string, key: string) => {
    const i = list.lastIndexOf(`${route}/${key}`)
    return i < 0 ? 0 : i + 1
  }
  return {
    seenAt: (route, key) => at(seen, route, key),
    pickedAt: (route, key) => at(picked, route, key),
  }
}

describe('wayTo', () => {
  it('takes the way the player played when nothing was picked', async () => {
    const g = await common()
    const m = marks(['common/a', 'common/d', 'common/f', 'common/h'])
    expect(wayTo(g, 'h', m)).toEqual({
      route: 'common',
      nodes: [START, 'a', 'd', 'f', 'h'],
      answers: [false, false],
    })
  })

  it('Yuzusoft style: after playing e once, h loads through e even though e > h was never played', async () => {
    const g = await common()
    // First run: f, then h. Later run: e only (stopped there).
    const m = marks(['common/a', 'common/d', 'common/f', 'common/h', 'common/e'])
    expect(wayTo(g, 'h', m)?.nodes).toEqual([START, 'a', 'd', 'e', 'h'])
    expect(wayTo(g, 'h', m)?.answers).toEqual([true, false])
  })

  it('a box picked in the chart wins over the one played last', async () => {
    const g = await common()
    const seen = ['common/a', 'common/d', 'common/e', 'common/f', 'common/g', 'common/h']
    // Clicked e, then f, then e again: e is the most recent pick, and e leads straight to h.
    const pickedE = marks(seen, ['common/e', 'common/f', 'common/e'])
    expect(wayTo(g, 'h', pickedE)?.nodes).toEqual([START, 'a', 'd', 'e', 'h'])
    // To go through g, the player picks g (then e above it, or whatever was picked before).
    const pickedG = marks(seen, ['common/e', 'common/g'])
    expect(wayTo(g, 'h', pickedG)?.nodes).toEqual([START, 'a', 'd', 'e', 'g', 'h'])
    // Nothing picked: the box played last before h (g) wins, then the one played last above it (f).
    expect(wayTo(g, 'h', marks(seen))?.nodes).toEqual([START, 'a', 'd', 'f', 'g', 'h'])
  })

  it('refuses a box no way of seen boxes reaches', async () => {
    const g = await common()
    expect(wayTo(g, 'h', marks(['common/a', 'common/d']))).toBeNull()
    expect(wayTo(g, 'g', marks(['common/a', 'common/d', 'common/e', 'common/h']))).toBeNull()
  })
})

describe('jumpPlan across routes', () => {
  it('goes through the seen route box of the earlier route', async () => {
    const graphs = new Map<RouteId, RouteGraph>([
      ['common' as RouteId, await common()],
      ['anna' as RouteId, await anna()],
    ])
    const m = marks([
      'common/a',
      'common/d',
      'common/e',
      'common/h',
      `common/${routeBox('anna' as RouteId)}`,
      'anna/walk',
    ])
    expect(routeChain('anna' as RouteId, graphs, m)).toEqual(['common', 'anna'])
    // anna as a root (an after story starts there): the chain stops at it.
    const roots = new Set(['common', 'anna'] as RouteId[])
    expect(routeChain('anna' as RouteId, graphs, m, roots)).toEqual(['anna'])
    const plan = jumpPlan('anna' as RouteId, 'walk', graphs, m)
    expect(plan?.map((w) => [w.route, w.nodes.at(-1), w.answers])).toEqual([
      ['common', '@route:anna', [true, false, true]],
      ['anna', 'walk', []],
    ])
    // The route box into anna was never reached: no plan.
    expect(jumpPlan('anna' as RouteId, 'walk', graphs, marks(['anna/walk']))).toBeNull()
  })
})

describe('no way through a dotted line', () => {
  // A choice whose two options join again at h.
  const chooser = () =>
    buildGraph(
      'common' as RouteId,
      (async ({
        event,
        choice,
      }: Loose & { choice: (o: Record<string, string>) => Promise<string> }) => {
        await event('x/a', 'a')
        if ((await choice({ go: 'Go', stay: 'Stay' })) === 'go') await event('x/b', 'b')
        else await event('x/c', 'c')
        await event('x/h', 'h')
      }) as unknown as (ctx: RouteContext) => unknown,
    )
  const boxes = ['common/a', 'common/?go_stay', 'common/b', 'common/c', 'common/h']

  it('a choice option never picked live is never on the way, even to boxes that were seen', async () => {
    const g = await chooser()
    // Every box seen, but only "stay" was picked by the player (b came from a replay, say).
    const m = marks([...boxes, 'common/?go_stay=stay'])
    expect(wayTo(g, 'b', m)).toBeNull()
    expect(wayTo(g, 'h', m)?.nodes).toEqual([START, 'a', '?go_stay', 'c', 'h'])
    // The choice box itself is still fine (its options are asked there).
    expect(wayTo(g, '?go_stay', m)?.nodes).toEqual([START, 'a', '?go_stay'])
  })

  it('no option picked live: nothing past the choice can be loaded', async () => {
    const g = await chooser()
    const m = marks(boxes)
    for (const k of ['b', 'c', 'h']) expect(wayTo(g, k, m)).toBeNull()
    const both = marks([...boxes, 'common/?go_stay=go'])
    expect(wayTo(g, 'b', both)?.answers).toEqual(['go'])
  })
})

describe('devWayPlan (dev start marker)', () => {
  const graphs = async () =>
    new Map<RouteId, RouteGraph>([
      ['common' as RouteId, await common()],
      ['anna' as RouteId, await anna()],
    ])

  it('needs no answers where only one way leads there', async () => {
    const plan = await graphs().then((g) => devWayPlan('common' as RouteId, 'd', g, []))
    expect(plan).toEqual([{ route: 'common', nodes: [START, 'a', 'd'], answers: [] }])
  })

  it('refuses to guess between ways, and lists the answers that name each', async () => {
    const plan = await graphs().then((g) => devWayPlan('common' as RouteId, 'h', g, []))
    expect(typeof plan).toBe('string')
    expect(plan).toMatch(/4 ways/)
    expect(plan).toMatch(/@start yes no/)
  })

  it('takes the way the answers name (never seen boxes count)', async () => {
    const plan = await graphs().then((g) => devWayPlan('common' as RouteId, 'h', g, [true, false]))
    expect(plan).toEqual([
      { route: 'common', nodes: [START, 'a', 'd', 'e', 'h'], answers: [true, false] },
    ])
  })

  // common asks flag('agreed') again before it starts anna: three answers on that way.
  it('answers run on through the routes before (common, then anna)', async () => {
    const plan = await graphs().then((g) =>
      devWayPlan('anna' as RouteId, 'walk', g, [true, true, true]),
    )
    expect(Array.isArray(plan)).toBe(true)
    const ways = plan as Exclude<typeof plan, string>
    expect(ways.map((w) => w.route)).toEqual(['common', 'anna'])
    expect(ways[0]?.nodes).toEqual([START, 'a', 'd', 'e', 'g', 'h', routeBox('anna' as RouteId)])
  })

  it('too many answers is a mistake, not ignored', async () => {
    const plan = await graphs().then((g) => devWayPlan('common' as RouteId, 'd', g, ['Go left']))
    expect(plan).toMatch(/more answers/)
  })
})
