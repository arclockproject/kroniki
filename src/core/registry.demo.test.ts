import { describe, expect, it } from 'vitest'
import { loadEvent, loadedTitle, loadMap } from './registry'

describe('loadedTitle (titles shown on saves)', () => {
  it('knows a map or event title once it has loaded, also for .vn events', async () => {
    expect(loadedTitle('events', 'town/sign')).toBeUndefined()
    await loadEvent('town/sign')
    expect(loadedTitle('events', 'town/sign')).toBe('The town sign')
    await loadMap('countryside/town')
    expect(loadedTitle('maps', 'countryside/town')).toBe('Town')
    expect(loadedTitle('maps', 'nope')).toBeUndefined()
  })
})
