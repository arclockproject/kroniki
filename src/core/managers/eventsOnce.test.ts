import { beforeEach, describe, expect, it } from 'vitest'
import type { EventId } from '../registry'
import { useGameStore } from '../stores/game'
import { events } from './events'

const id = 'heaven/before_god/meeting' as EventId

beforeEach(() => {
  useGameStore.setState((s) => {
    s.events = {}
  })
})

describe('event memory', () => {
  it('reports what the playthrough has seen', () => {
    expect(events.seen(id)).toBe(false)
    useGameStore.setState((s) => {
      s.events[id] = { started: 2, finished: 1 }
    })
    expect(events.seen(id)).toBe(true)
    expect(events.finished(id)).toBe(true)
    expect(events.count(id)).toBe(2)
  })

  it('startOnce does nothing for an event that was already seen', async () => {
    useGameStore.setState((s) => {
      s.events[id] = { started: 1, finished: 1 }
    })
    // Loose call: the id is a plain test id, whatever params the game's events take.
    const startOnce = events.startOnce as (id: EventId) => Promise<boolean>
    await expect(startOnce(id)).resolves.toBe(false)
  })
})
