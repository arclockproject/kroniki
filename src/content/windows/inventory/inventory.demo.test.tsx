// @vitest-environment happy-dom
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { state } from '@/core/state'
import inventory from './index'

describe('inventory window', () => {
  afterEach(() => {
    state.update((d) => {
      d.inventory = {}
    })
  })

  it('shows items without re-rendering forever (regression: Object.entries selector)', async () => {
    state.update((d) => {
      d.inventory = { letter: 1, apple: 3 }
    })
    const Inventory = inventory.component
    await act(async () => {
      render(<Inventory params={undefined} close={() => {}} />)
    })
    expect(screen.getByText('Letter × 1')).toBeTruthy()
    expect(screen.getByText('Apple × 3')).toBeTruthy()

    // Still updates when the bag changes.
    await act(async () => {
      state.update((d) => {
        d.inventory.apple = 2
      })
    })
    expect(screen.getByText('Apple × 2')).toBeTruthy()
  })
})
