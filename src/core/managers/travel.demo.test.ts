import { beforeEach, describe, expect, it, vi } from 'vitest'
import config from '@/content/travel'
import { useGameStore } from '../stores/game'
import { useSystemStore } from '../stores/system'
import { maps } from './maps'
import { type PlaceId, travel } from './travel'

const ids = Object.keys(config.places) as PlaceId[]
const [first, second] = ids as [PlaceId, PlaceId]
const mapOf = (id: PlaceId) => config.places[id].map
const standOn = (map: string | null) =>
  useSystemStore.setState((s) => {
    s.map = map ? ({ id: map } as never) : null
    s.event = null
    s.minigame = null
    s.mapTransition = null
    s.windows = []
    s.title = null
  })

describe('game.travel (the places in src/content/travel.ts)', () => {
  beforeEach(() => {
    useGameStore.setState((s) => {
      s.places = {}
    })
    standOn(mapOf(first))
    vi.restoreAllMocks()
  })

  it('places marked known: false appear once discovered', () => {
    const hidden = ids.filter((id) => config.places[id].known === false)
    for (const id of hidden) expect(travel.knows(id)).toBe(false)
    for (const id of ids) travel.discover(id)
    expect(travel.list().map((p) => p.id)).toEqual(ids)
    expect(travel.discover(first)).toBe(false)
    expect(travel.list().find((p) => p.id === first)?.here).toBe(true)
  })

  it('says why not: unknown, here, busy, blocked', () => {
    if (config.places[second].known === false) expect(travel.problem(second)).toBe('unknown')
    for (const id of ids) travel.discover(id)
    expect(travel.problem(first)).toBe('here')
    expect(travel.problem(second)).toBeNull()
    useSystemStore.setState((s) => {
      s.event = {} as never
    })
    expect(travel.problem(second)).toBe('busy')
    const [blocked] = config.blockedMaps
    if (blocked) {
      standOn(blocked)
      expect(travel.problem(second)).toBe('blocked')
    }
  })

  it('go() changes the map to the place and closes the windows', async () => {
    for (const id of ids) travel.discover(id)
    const go = vi.spyOn(maps, 'go').mockResolvedValue(undefined as never)
    useSystemStore.setState((s) => {
      s.windows = [{ id: 'travel' }] as never
    })
    await expect(travel.go(second)).resolves.toBeNull()
    const spawn = config.places[second].spawn
    expect(go).toHaveBeenCalledWith(mapOf(second), spawn ? { spawn } : {})
    expect(useSystemStore.getState().windows).toEqual([])
    await expect(travel.go(first)).resolves.toBe('here')
  })
})
