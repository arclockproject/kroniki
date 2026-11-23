// Flags, items, quests and props/doors resolution, against the real content.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const go = vi.fn(async () => {})
// A small game: the real managers under test, plus fakes for maps and audio.
const fake: Record<string, unknown> = {}
vi.mock('../gameRef', () => ({ getGame: () => fake }))

const { useGameStore, emptyEngineState } = await import('../stores/game')
const { initialData } = await import('@/content/save/data')
const { flags } = await import('./flags')
const { items } = await import('./items')
const { quests } = await import('./quests')
const { resolveObject, propMemory } = await import('../sprite/resolve')
const { useToastStore } = await import('../ui/toast')
const { state } = await import('../state')
Object.assign(fake, { maps: { go }, state, items, flags, quests, audio: { sfx: () => {} } })

beforeEach(() => {
  useGameStore.setState({ data: initialData(), ...emptyEngineState() })
  useToastStore.setState({ toasts: [] })
})

describe('flags', () => {
  it('start at their default, are set, toggled, counted and reset', () => {
    expect(flags.get('met_anna')).toBe(false)
    flags.set('met_anna', true)
    expect(flags.get('met_anna')).toBe(true)
    expect(flags.toggle('met_anna')).toBe(false)
    expect(flags.add('times_talked_to_anna', 2)).toBe(2)
    flags.reset('times_talked_to_anna')
    expect(flags.get('times_talked_to_anna')).toBe(0)
  })
  it('ignore saved values of the wrong type', () => {
    useGameStore.setState((s) => {
      s.data.flags.met_anna = 'yes'
    })
    expect(flags.get('met_anna')).toBe(false)
  })
})

describe('items', () => {
  it('add up to max, remove only when there are enough, list by name', () => {
    expect(items.add('lantern', 5)).toBe(1) // max 1
    expect(items.add('apple', 2)).toBe(2)
    expect(items.remove('apple', 3)).toBe(false)
    expect(items.remove('apple', 2)).toBe(true)
    expect(items.has('apple')).toBe(false)
    expect(items.list().map((e) => [e.id, e.count, e.item.name])).toEqual([
      ['lantern', 1, 'Lantern'],
    ])
  })
  it('use runs the item and uses one up (unless keepOnUse)', async () => {
    useGameStore.setState((s) => {
      s.data.stats.health = 50
    })
    items.add('apple', 2)
    expect(await items.use('apple')).toBe(true)
    expect(useGameStore.getState().data.stats.health).toBe(60)
    expect(items.count('apple')).toBe(1)
    expect(await items.use('lantern')).toBe(false) // no use()
  })
  it('the lantern: lit when obtained, toggled by use, put out when lost (hooks in the item)', async () => {
    expect(items.lights()).toEqual([])
    items.add('lantern')
    await Promise.resolve() // onObtain runs right after
    await Promise.resolve()
    expect(items.isOn('lantern')).toBe(true)
    expect(items.lights()).toHaveLength(1)
    expect(await items.use('lantern')).toBe(true) // keepOnUse: still carried, now off
    expect([items.count('lantern'), items.isOn('lantern')]).toEqual([1, false])
    expect(items.lights()).toEqual([])
    items.toggle('lantern')
    items.remove('lantern')
    await Promise.resolve()
    await Promise.resolve()
    expect(items.isOn('lantern')).toBe(false)
  })
  it('notify shows a toast', () => {
    items.add('bread', 2, { notify: true })
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual(['Bread ×2'])
  })
  it('the toast says its kind and params (for content/ui/Toast.tsx)', () => {
    items.add('bread', 2, { notify: true })
    const [shown] = useToastStore.getState().toasts
    expect(shown).toMatchObject({ kind: 'item', params: { item: 'bread', count: 2 } })
  })
})

describe('quests', () => {
  it('start, step, advance and complete (rewards run on complete)', async () => {
    expect(quests.status('jacks_letter')).toBe('inactive')
    quests.start('jacks_letter')
    expect(quests.step('jacks_letter')).toBe('mailbox')
    quests.setStep('jacks_letter', 'read')
    expect(quests.isStepDone('jacks_letter', 'mailbox')).toBe(true)
    // A step with `when` is listed from the start, masked until its condition is true.
    const lines = () => quests.list()[0]?.steps.map((s) => [s.id, s.text, s.masked])
    expect(lines()).toEqual([
      ['mailbox', 'Check the mailbox of the new house', false],
      ['read', 'Read the letter (inventory)', false],
      ['talk_with_jack', '???', true],
    ])
    flags.set('took_jacks_letter', true)
    expect(lines()?.[2]).toEqual(['talk_with_jack', 'Talk with Jack', false])
    quests.advance('jacks_letter')
    expect(quests.step('jacks_letter')).toBe('talk_with_jack')
    quests.advance('jacks_letter') // past the last step: done
    expect(quests.isDone('jacks_letter')).toBe(true)
    await Promise.resolve()
    expect(items.count('apple')).toBe(3) // onComplete reward
    expect(quests.list().map((q) => [q.id, q.status])).toEqual([['jacks_letter', 'done']])
    expect(useToastStore.getState().toasts.map((t) => t.text)).toEqual([
      "New quest: Jack's letter",
      "Quest complete: Jack's letter",
      'Apple ×3', // the reward, from onComplete
    ])
  })
})

describe('resolveObject', () => {
  it('gives props their definition; object fields win', () => {
    const chest = resolveObject({ at: { x: 2, y: 3 }, prop: 'chest' }, 'town')
    expect(chest).toMatchObject({
      id: 'chest_2_3',
      solid: true,
      animation: 'closed',
      turnToPlayer: false,
    })
    expect(chest.sprite).toBeDefined()
    expect(typeof chest.onInteract).toBe('function')
    const plate = resolveObject({ at: { x: 0, y: 0 }, prop: 'pressure_plate', solid: true }, 'town')
    expect(plate.solid).toBe(true)
  })
  it('doors get a hook that changes map', async () => {
    const door = resolveObject(
      { at: { x: 0, y: 0 }, door: { map: 'countryside/forest', spawn: 'from_town' } },
      'town',
    )
    expect(door.onEnter).toBeTypeOf('function')
    door.onEnter?.({ game: { maps: { go } } as never, world: {} as never, object: door })
    expect(go).toHaveBeenCalledWith('countryside/forest', {
      spawn: 'from_town',
      transition: undefined,
    })
    const real = resolveObject({ at: { x: 0, y: 0 }, door: { map: 'x', interact: true } }, 'town')
    expect(real.onInteract).toBeTypeOf('function')
    expect(real.onEnter).toBeUndefined()
  })
  it('prop memory is saved per map and prop', () => {
    const memory = propMemory('town', 'chest_1')
    memory.set('open', true)
    expect(propMemory('town', 'chest_1').get('open')).toBe(true)
    expect(propMemory('forest', 'chest_1').get('open')).toBeUndefined()
    memory.set('open', null)
    expect(useGameStore.getState().propMemory).toEqual({})
  })
})
