import { describe, expect, it } from 'vitest'
import { hopRadius, lineHops } from './hops'

const config = { shape: 'rounded' as const, corner: 10, hops: 5 }
// A line running across at y 50 (down, across, down) and one going straight down through it.
const across = {
  points: [
    [0, 0],
    [200, 100],
  ] as [number, number][],
}
const down = {
  points: [
    [100, 0],
    [100, 100],
  ] as [number, number][],
}

describe('lineHops', () => {
  it('the line running across hops over the one going down', () => {
    expect(lineHops([across, down], config)).toEqual([[{ x: 100, y: 50 }], []])
  })

  it('counts a line going straight on through a place holder as one piece', () => {
    const split = {
      points: [
        [100, 0],
        [100, 50],
        [100, 100],
      ] as [number, number][],
    }
    expect(lineHops([across, split], config)[0]).toEqual([{ x: 100, y: 50 }])
  })

  it('no hops near a corner, with curves, or when switched off', () => {
    const nearCorner = {
      points: [
        [195, 0],
        [195, 100],
      ] as [number, number][],
    }
    expect(lineHops([across, nearCorner], config)[0]).toEqual([])
    expect(lineHops([across, down], { ...config, shape: 'curve' })[0]).toEqual([])
    expect(lineHops([across, down], { ...config, hops: null })[0]).toEqual([])
    expect(hopRadius({})).toBe(5)
    expect(hopRadius({ hops: 0 })).toBe(0)
  })

  it('side lines: across from a diamond corner, and down into a box side', () => {
    const corner = {
      points: [
        [0, 20],
        [150, 100],
      ] as [number, number][],
      side: true,
    }
    const into = {
      points: [
        [150, 0],
        [0, 60],
      ] as [number, number][],
      sideEnd: true,
    }
    const tall = {
      points: [
        [60, 0],
        [60, 100],
      ] as [number, number][],
    }
    expect(lineHops([corner, tall], config)[0]).toEqual([{ x: 60, y: 20 }])
    expect(lineHops([into, tall], config)[0]).toEqual([{ x: 60, y: 60 }])
  })
})
