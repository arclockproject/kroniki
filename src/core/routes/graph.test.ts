import { describe, expect, it } from 'vitest'
import type { RouteContext, RouteId } from '../defs/routes'
import { buildGraph, END, RouteError, routeBox, routeCycles, START } from './graph'

// Content ids are typed; these tests use made-up ones.
type Loose = {
  event: (id: string, key?: string) => Promise<void>
  flag: (id: string) => boolean
  check: (label: string, test: () => boolean) => boolean
  startRoute: (id: string) => ReturnType<RouteContext['startRoute']>
  movie: (id: string) => Promise<void>
  choice: (options: Record<string, string>) => Promise<string>
}
const build = (run: (r: Loose) => unknown) =>
  buildGraph('common' as RouteId, run as unknown as (ctx: RouteContext) => unknown)

/** The reference example (docs): A..J with joins, a skip past G, two exits. */
async function ownerExample({ event, flag, startRoute }: Loose) {
  await event('meeting/special', 'a')
  await event('meeting/cat', 'b')
  await event('meeting/evil', 'c')
  await event('town/thechoice', 'd')
  if (flag('jack/agreed_with')) await event('jack/tells_his_story', 'e')
  else await event('jack/lies_about_himself', 'f')
  if (flag('meet_anna')) await event('anna/greeting', 'g')
  await event('town/leaving', 'h')
  if (flag('jack/agreed_with')) {
    await event('jack/tells_his_story_again', 'i')
    if (flag('jack/agreed_with')) {
      await event('jack/tells_his_story', 'l')
      return startRoute('anna')
    }
    await event('jack/lies_about_himself', 'm')
  } else {
    await event('jack/lies_about_himself_again', 'j')
  }
  return startRoute('bad_end')
}

const lines = (g: Awaited<ReturnType<typeof build>>) =>
  g.edges.map((e) => `${e.from}>${e.to}`).sort()

describe('buildGraph', () => {
  it('draws the reference example exactly like the mermaid chart', async () => {
    const g = await build(ownerExample)
    expect(lines(g)).toEqual(
      [
        `${START}>a`,
        'a>b',
        'b>c',
        'c>d',
        'd>e',
        'd>f',
        'e>g',
        'f>g',
        'e>h',
        'f>h',
        'g>h',
        'h>i',
        'h>j',
        'i>l',
        'i>m',
        `l>${routeBox('anna' as RouteId)}`,
        `m>${routeBox('bad_end' as RouteId)}`,
        `j>${routeBox('bad_end' as RouteId)}`,
      ].sort(),
    )
    expect(g.links).toEqual(['anna', 'bad_end'])
    expect(g.nodes.e).toEqual({ kind: 'event', key: 'e', event: 'jack/tells_his_story' })
    expect(g.nodes.l).toEqual({ kind: 'event', key: 'l', event: 'jack/tells_his_story' })
    expect(g.truncated).toBe(false)
    // 2 (d) x 2 (g) x 3 (h: i>l, i>m, j) = 12 ways.
    expect(g.paths).toHaveLength(12)
  })

  it('records which branch each line was taken on', async () => {
    const g = await build(ownerExample)
    const edge = (from: string, to: string) => g.edges.find((e) => e.from === from && e.to === to)
    expect(edge('d', 'e')?.when).toEqual([
      [{ kind: 'flag', name: 'jack/agreed_with', value: true, order: 1 }],
    ])
    // The skip past g: meet_anna was false.
    expect(edge('e', 'h')?.when).toEqual([
      [{ kind: 'flag', name: 'meet_anna', value: false, order: 0 }],
    ])
    expect(edge('a', 'b')?.when).toEqual([[]])
  })

  it('a box without a name is called after the last part of its event id', async () => {
    const g = await build(async ({ event }) => {
      await event('common/day1_morning')
      await event('common/day1_lunch', 'lunch')
    })
    expect(
      Object.values(g.nodes)
        .filter((n) => n.kind === 'event')
        .map((n) => n.key),
    ).toEqual(['day1_morning', 'lunch'])
  })

  it('ends at END when no route is started, with movies on the last line', async () => {
    const g = await build(async ({ event, movie }) => {
      await event('x/one', 'one')
      await movie('ending')
      await movie('credits')
    })
    expect(lines(g)).toEqual([`${START}>one`, `one>${END}`])
    expect(g.edges.find((e) => e.to === END)?.movies).toEqual(['ending', 'credits'])
  })

  it('accepts startRoute(); return as well as return startRoute()', async () => {
    const g = await build(async ({ event, startRoute }) => {
      await event('x/one', 'one')
      startRoute('anna')
    })
    expect(g.links).toEqual(['anna'])
  })

  it('refuses anything after startRoute', async () => {
    await expect(
      build(async ({ event, startRoute }) => {
        startRoute('anna')
        await event('x/one', 'one')
      }),
    ).rejects.toThrow(/after startRoute\('anna'\)/)
  })

  it('refuses one key for two events, bad key names, and a key twice on one way', async () => {
    await expect(
      build(async ({ event, flag }) => {
        if (flag('x')) await event('x/one', 'k')
        else await event('x/two', 'k')
      }),
    ).rejects.toThrow(/used for both 'x\/(one|two)'/)
    await expect(build(async ({ event }) => event('x/one', 'Bad Key'))).rejects.toThrow(RouteError)
    await expect(
      build(async ({ event }) => {
        await event('x/one', 'k')
        await event('x/one', 'k')
      }),
    ).rejects.toThrow(/twice/)
  })

  it('stops a loop that never ends', async () => {
    await expect(
      build(async ({ event, flag }) => {
        while (!flag('done')) await new Promise((r) => r(null))
        await event('x/one', 'one')
      }),
    ).rejects.toThrow(/branches in one way/)
  })

  it('refuses a route that starts itself', async () => {
    await expect(build(async ({ startRoute }) => startRoute('common'))).rejects.toThrow(
      /starts itself/,
    )
  })

  it('records answers and where they were asked, for replays', async () => {
    const g = await build(ownerExample)
    const path = g.paths.find((p) => p.nodes.includes('l') && !p.nodes.includes('g'))
    expect(path?.nodes).toEqual([START, 'a', 'b', 'c', 'd', 'e', 'h', 'i', 'l', '@route:anna'])
    // d asked agreed_with (after 5 boxes: start a b c d), g's question after e, then two after h, i.
    expect(path?.answerAt).toEqual([5, 6, 7, 8])
    expect(path?.answers).toEqual([true, false, true, true])
  })
})

describe('routeCycles', () => {
  it('finds routes that lead back into themselves', () => {
    expect(routeCycles({ common: ['anna'], anna: ['common'] })).toEqual([
      ['common', 'anna', 'common'],
    ])
    expect(routeCycles({ common: ['anna', 'bad'], anna: ['resurrection'], bad: [] })).toEqual([])
  })
})

describe('choices in a route', () => {
  it('is a box of its own; its options are the lines leaving it, in the written order', async () => {
    const g = await build(async ({ event, choice, flag }) => {
      await event('x/ask', 'ask')
      const pick = await choice({ yes: 'Yes', no: 'No', maybe: 'Maybe' })
      if (pick === 'yes') await event('x/yes', 'yes')
      else if (pick === 'no') await event('x/no', 'no')
      if (flag('rain')) await event('x/rain', 'rain')
      await event('x/end', 'end')
    })
    expect(g.nodes['?yes_no_maybe']).toEqual({
      kind: 'choice',
      key: '?yes_no_maybe',
      options: ['Yes', 'No', 'Maybe'],
      keys: ['yes', 'no', 'maybe'],
    })
    expect(g.edges.filter((e) => e.from === 'ask').map((e) => e.to)).toEqual(['?yes_no_maybe'])
    const from = (key: string) =>
      g.edges
        .filter((e) => e.from === key)
        .map((e) => [e.to, e.when[0]?.at(-1)?.name, e.when[0]?.at(-1)?.order])
    expect(from('?yes_no_maybe')).toEqual(
      expect.arrayContaining([
        ['yes', 'Yes', 0],
        ['no', 'No', 1],
      ]),
    )
    // "Maybe" goes straight on to rain or end.
    expect(from('?yes_no_maybe').map((e) => e[0])).toEqual(expect.arrayContaining(['rain', 'end']))
    expect(g.paths).toHaveLength(6)
  })

  it('needs a key when two choices on one way have the same options', async () => {
    const twice = (key?: string) =>
      build(async ({ choice }) => {
        await choice({ y: 'Yes', n: 'No' })
        await (choice as (o: object, a: object) => Promise<string>)({ y: 'Yes', n: 'No' }, { key })
      })
    await expect(twice()).rejects.toThrow(/give one a key/)
    const g = await twice('second')
    expect(Object.keys(g.nodes)).toEqual(expect.arrayContaining(['?y_n', '?second']))
  })
})
