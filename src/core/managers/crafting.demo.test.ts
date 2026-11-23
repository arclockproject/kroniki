import { beforeEach, describe, expect, it } from 'vitest'
import { useGameStore } from '../stores/game'
import { crafting } from './crafting'
import { items } from './items'
import { money } from './money'

const reset = () =>
  useGameStore.setState((s) => {
    s.data.inventory = {}
    s.recipes = {}
    s.money = 0
  })

describe('game.crafting (the recipes in src/content/recipes.ts)', () => {
  beforeEach(reset)

  it('makes an item: takes what it needs, gives the result', () => {
    expect(crafting.problem('apple_bread')).toBe('items')
    expect(crafting.make('apple_bread')).toBe('items')
    items.add('apple', 5)
    items.add('bread', 1)
    expect(crafting.view('apple_bread').needs.map((n) => [n.id, n.have, n.need])).toEqual([
      ['apple', 5, 2],
      ['bread', 1, 1],
    ])
    expect(crafting.make('apple_bread', { notify: false })).toBeNull()
    expect(items.count('apple')).toBe(3)
    expect(items.count('bread')).toBe(2) // 1 used, 2 made
    // Twice at once needs twice the items.
    expect(crafting.problem('apple_bread', undefined, 2)).toBe('items')
  })

  it('hidden recipes must be learned, and stations must match', () => {
    items.add('apple', 9)
    money.add(100)
    expect(crafting.knows('lucky_charm')).toBe(false)
    expect(crafting.problem('lucky_charm', 'campfire')).toBe('unknown')
    expect(crafting.list('campfire')).toEqual([])
    expect(crafting.learn('lucky_charm')).toBe(true)
    expect(crafting.learn('lucky_charm')).toBe(false)
    expect(crafting.problem('lucky_charm')).toBe('station')
    expect(crafting.list().map((r) => r.id)).toEqual(['apple_bread'])
    expect(crafting.list('campfire').map((r) => r.id)).toEqual(['lucky_charm'])
    const before = money.get()
    expect(crafting.make('lucky_charm', { station: 'campfire', notify: false })).toBeNull()
    expect(money.get()).toBe(before - 25)
    expect(items.count('lucky_charm')).toBe(1)
    crafting.forget('lucky_charm')
    expect(crafting.knows('lucky_charm')).toBe(false)
  })

  it('says when there is no money', () => {
    crafting.learn('lucky_charm')
    items.add('apple', 9)
    expect(crafting.problem('lucky_charm', 'campfire')).toBe('money')
  })
})
