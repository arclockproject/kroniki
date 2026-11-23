import { beforeEach, describe, expect, it } from 'vitest'
import type { CharacterId } from '../registry'
import { useGameStore } from '../stores/game'
import { characterNames } from './characters'

const god = 'god' as CharacterId
const hero = 'hero' as CharacterId

beforeEach(() => {
  useGameStore.setState((s) => {
    s.names = {}
  })
})

describe('character names', () => {
  it('hides the name until it is revealed; renames stick', () => {
    expect(characterNames.name(god)).toBe('???')
    expect(characterNames.known(god)).toBe(false)
    characterNames.rename(god, 'Evil God')
    expect(characterNames.name(god)).toBe('Evil God')
    characterNames.reveal(god)
    expect(characterNames.name(god)).toBe('God')
    expect(characterNames.known(god)).toBe(true)
  })

  it('shows the real name for characters without unknownName', () => {
    expect(characterNames.name(hero)).toBe('Me')
    expect(characterNames.known(hero)).toBe(true)
  })

  it('forget() hides the name again', () => {
    characterNames.reveal(god)
    characterNames.forget(god)
    expect(characterNames.name(god)).toBe('???')
  })
})
