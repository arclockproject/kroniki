// The demo game's own map checks (removed with the demo by pnpm setup:project).
import { describe, expect, it } from 'vitest'
import { layoutFromTiled, placementProblem, stampSolid } from '@/core/world/layout'
import { mapLoaders, structureLoaders } from '@/generated/registry.gen'
import { HOUSE_SPOT } from './events/jack/hello'

describe("Jack's house spot", () => {
  it('fits in town, on open ground', async () => {
    const town = layoutFromTiled((await mapLoaders['countryside/town']()).default)
    const house = layoutFromTiled((await structureLoaders.house()).default)
    expect(placementProblem(town, { layout: house, at: HOUSE_SPOT })).toBeNull()
    // Nothing solid in the town under the house (it shouldn't cover trees, water or walls).
    for (let y = 0; y < house.height; y++) {
      for (let x = 0; x < house.width; x++) {
        expect(
          town.solid[(HOUSE_SPOT.y + y) * town.width + HOUSE_SPOT.x + x],
          `town tile ${HOUSE_SPOT.x + x},${HOUSE_SPOT.y + y}`,
        ).toBe(false)
      }
    }
    // And after building it, the spawns are still walkable.
    const solid = stampSolid(town.solid, town.width, town.height, [
      { layout: house, at: HOUSE_SPOT },
    ])
    for (const spawn of Object.values(town.spawns))
      expect(solid[spawn.y * town.width + spawn.x]).toBe(false)
  })
})
