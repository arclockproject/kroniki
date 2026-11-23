// @vitest-environment happy-dom
// Mid-scene saves and Back keep what the player did in a window while the scene waited.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const go = vi.fn(async (_id: string, _options?: object) => {})
vi.mock('../managers/maps', () => ({
  maps: {
    go: (id: string, options?: object) => go(id, options),
    snapshot: () => ({ id: 'town', params: undefined, x: 1, y: 1, facing: 'down' as const }),
    onChange: () => () => {},
  },
}))
vi.mock('../platform', () => ({ onBeforeClose: () => {}, saveTextFile: async () => true }))
vi.mock('../gameRef', () => ({ getGame: () => ({ maps: { go } }) }))
vi.mock('@/content/save/data', () => ({ initialData: () => ({ flags: {} }) }))
vi.mock('@/content/save', () => ({
  default: {
    initial: () => ({ flags: {} }),
    newGame: () => {},
    slots: 5,
    autosave: { mapChange: false, eventEnd: false, windowsClosed: false },
  },
}))
const scripts: Record<string, { run: (ctx: never) => unknown }> = {
  chapter: {
    run: async (ctx: { say: (who: string, text: string) => Promise<void> }) => {
      await ctx.say('anna', 'before')
      chapters.reach('town' as never)
      await ctx.say('anna', 'after')
    },
  },
  fight: {
    run: async (ctx: { say: (who: string, text: string) => Promise<void> }) => {
      await ctx.say('anna', 'one')
      // Like a battle: an outcome the replay cannot work out again (here: a random amount).
      const mark = gameMark()
      money.add(1 + Math.floor(Math.random() * 1000))
      settleGame(mark)
      await ctx.say('anna', 'two')
    },
  },
  pick: {
    run: async (ctx: {
      say: (who: string, text: string) => Promise<void>
      choice: (options: string[]) => Promise<number>
    }) => {
      await ctx.say('anna', 'first')
      await ctx.choice(['left', 'right'])
      await ctx.say('anna', 'after')
      await ctx.say('anna', 'later')
    },
  },
  stall: {
    run: async (ctx: { say: (who: string, text: string) => Promise<void> }) => {
      money.add(10) // the script's own change: must not be applied twice
      toast('You got 10 coins')
      await ctx.say('anna', 'one')
      money.add(100)
      await ctx.say('anna', 'two')
      await ctx.say('anna', 'three')
    },
  },
}
vi.mock('../registry', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadEvent: async (id: string) => scripts[id],
  characters: { anna: { name: 'Anna' } },
}))

const { save } = await import('./manager')
const { events } = await import('../managers/events')
const { money } = await import('../managers/money')
const { chapterManager: chapters } = await import('../managers/chapters')
const { toast, useToastStore } = await import('../ui/toast')
const { advance } = await import('../scene/director')
const {
  currentRecording,
  gameMark,
  isFastForward,
  isRewinding,
  onReplayChange,
  resetReplay,
  settleGame,
} = await import('../scene/replay')
const { pick } = await import('../scene/director')
const { useGameStore } = await import('../stores/game')
const { useSystemStore } = await import('../stores/system')
const systemInitial = useSystemStore.getState()
const flush = () => new Promise((r) => setTimeout(r, 0))
const line = () => useSystemStore.getState().scene.line?.text
const flags = () =>
  (useGameStore.getState().data as unknown as { flags: Record<string, boolean> }).flags
/** What a shop window does: the player pays and gets something. */
const buy = (item: string, price: number) => {
  money.spend(price)
  useGameStore.setState((s) => {
    ;(s.data as unknown as { flags: Record<string, boolean> }).flags[item] = true
  })
}

beforeEach(() => {
  localStorage.clear()
  events.abort()
  useToastStore.setState({ toasts: [] })
  resetReplay()
  useSystemStore.setState(systemInitial, true)
  useSystemStore.setState((s) => {
    s.map = { id: 'town' as never, params: undefined, spawn: 'start' }
  })
  useGameStore.setState({ data: { flags: {} } as never, playtimeMs: 0, money: 50 })
})

describe('chapters on mid-scene saves', () => {
  it('the slot shows the chapter reached during the scene; loading sets it again', async () => {
    useGameStore.setState({ chapter: 'heaven' })
    void events.start('chapter' as never)
    await flush()
    advance()
    await flush()
    // The chapter card (content/chapters.ts announce) holds the next line; the layer would end it.
    const { endChapterCard } = await import('../scene/chapterCard')
    endChapterCard()
    await flush()
    expect(line()).toBe('after')
    expect(save.save('slot1')).toBe(true)
    const [slot] = save.list(['slot1'])
    expect(slot && 'chapter' in slot && [slot.chapter, slot.eventId]).toEqual(['town', 'chapter'])

    events.abort()
    useGameStore.setState({ chapter: '' })
    await save.load('slot1')
    await flush()
    expect(line()).toBe('after')
    expect(chapters.current()).toBe('town')
  })
})

describe('a window used while a scene waits', () => {
  it('is part of a mid-scene save: the purchase is still there after loading', async () => {
    void events.start('stall' as never)
    await flush()
    expect(line()).toBe('one')
    expect(money.get()).toBe(60)
    buy('potion', 25) // in a shop opened over the first line
    expect(save.save('slot1')).toBe(true)

    // Later: everything is different, then the save is loaded.
    events.abort()
    useGameStore.setState({ data: { flags: {} } as never, money: 0 })
    await save.load('slot1')
    await flush()
    expect(line()).toBe('one')
    expect(money.get()).toBe(35)
    expect(flags()).toEqual({ potion: true })
    // The replayed script stays quiet: its toast is not shown a second time.
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual(['You got 10 coins'])

    // The scene goes on from there, and the script's next change lands on top.
    advance()
    await flush()
    expect(line()).toBe('two')
    expect(money.get()).toBe(135)
    expect(currentRecording()?.record.steps.map((s) => s.k)).toEqual(['p', 'l'])
  })

  it('records nothing when the player changed nothing', async () => {
    void events.start('stall' as never)
    await flush()
    advance()
    await flush()
    expect(currentRecording()?.record.steps.map((s) => s.k)).toEqual(['l'])
  })

  it('Back keeps earlier purchases and undoes the one made on the line it returns to', async () => {
    void events.start('stall' as never)
    await flush()
    buy('potion', 25) // during "one"
    advance()
    await flush()
    expect(line()).toBe('two')
    buy('herb', 5) // during "two"
    advance()
    await flush()
    expect(line()).toBe('three')
    expect(money.get()).toBe(130)

    expect(await save.rollback()).toBe(true)
    await flush()
    // Back at the moment "two" appeared: the potion is bought, the herb is not yet.
    expect(line()).toBe('two')
    expect(flags()).toEqual({ potion: true })
    expect(money.get()).toBe(135)
  })
})

describe('jumping back from the log', () => {
  it('returns to the chosen line of the running scene, and refuses lines it cannot reach', async () => {
    void events.start('stall' as never)
    await flush()
    advance()
    await flush()
    advance()
    await flush()
    expect(line()).toBe('three')
    const log = useSystemStore.getState().scene.log
    expect(log.map((entry) => entry.text)).toEqual(['one', 'two', 'three'])
    const two = log[1]?.at

    // The line on screen is not a jump target, and neither is a line of another scene run.
    expect(await save.rollbackTo(log[2]?.at)).toBe(false)
    expect(await save.rollbackTo(two && { ...two, run: two.run - 1 })).toBe(false)
    expect(await save.rollbackTo(undefined)).toBe(false)

    expect(await save.rollbackTo(two)).toBe(true)
    await flush()
    expect(line()).toBe('two')
    // Its later lines left the log; the game is as it was at that line.
    expect(useSystemStore.getState().scene.log.map((entry) => entry.text)).toEqual(['one', 'two'])
    expect(money.get()).toBe(160)
  })
})

describe('a result the replay cannot repeat (a battle)', () => {
  it('is stored with the scene, so loading gives exactly the same game', async () => {
    void events.start('fight' as never)
    await flush()
    advance()
    await flush()
    expect(line()).toBe('two')
    const after = money.get()
    expect(after).toBeGreaterThan(50)
    expect(currentRecording()?.record.steps.map((s) => s.k)).toEqual(['l', 's'])
    expect(save.save('slot1')).toBe(true)

    events.abort()
    useGameStore.setState({ money: 0 })
    await save.load('slot1')
    await flush()
    expect(line()).toBe('two')
    expect(money.get()).toBe(after)
    expect(currentRecording()?.record.steps.map((s) => s.k)).toEqual(['l', 's'])
  })
})

describe('Back keeps the scene on screen', () => {
  it('is rewinding (all instant, the old scene held) from the start until the line waits again', async () => {
    void events.start('stall' as never)
    await flush()
    advance()
    await flush()
    expect(line()).toBe('two')
    // What the event layer sees: rewinding from the very first change, none after the end.
    const seen: boolean[] = []
    const off = onReplayChange(() => seen.push(isRewinding()))
    const back = save.rollback()
    expect(isRewinding()).toBe(true)
    expect(isFastForward()).toBe(true)
    expect(await back).toBe(true)
    await flush()
    off()
    expect(line()).toBe('one')
    expect(isRewinding()).toBe(false)
    expect(isFastForward()).toBe(false)
    expect(seen[0]).toBe(true)
    expect(seen.at(-1)).toBe(false)
  })

  it('"Last choice" asks the last choice again', async () => {
    void events.start('pick' as never)
    await flush()
    advance()
    await flush()
    expect(useSystemStore.getState().scene.choices?.map((c) => c.label)).toEqual(['left', 'right'])
    pick(1)
    await flush()
    advance()
    await flush()
    expect(line()).toBe('later')

    expect(await save.backToChoice()).toBe(true)
    await flush()
    expect(useSystemStore.getState().scene.choices?.map((c) => c.label)).toEqual(['left', 'right'])
    expect(isRewinding()).toBe(false)
    // At the choice there is no earlier one in this scene.
    expect(await save.backToChoice()).toBe(false)
  })
})
