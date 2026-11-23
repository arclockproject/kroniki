import { beforeEach, describe, expect, it, vi } from 'vitest'
import { timerText } from '../layers/TimerLayer'
import { useGameStore } from '../stores/game'
import { useSystemStore } from '../stores/system'
import { formatTime } from '../timers'
import { events } from './events'
import { advanceTimers, timerRuns, timers } from './timers'

const onMap = () =>
  useSystemStore.setState((s) => {
    s.map = { id: 'town' } as never
    s.title = null
    s.event = null
    s.minigame = null
    s.windows = []
    s.mapTransition = null
  })

describe('game.timers', () => {
  beforeEach(() => {
    useGameStore.setState((s) => {
      s.timers = {}
    })
    onMap()
  })

  it('formats time', () => {
    expect(formatTime(65_000)).toBe('1:05')
    expect(formatTime(3_723_000)).toBe('1:02:03')
    expect(formatTime(9_450, true)).toBe('0:09.4')
    expect(formatTime(-5)).toBe('0:00')
  })

  it('a countdown runs out, resolves wait() with true and starts its event', async () => {
    const start = vi.spyOn(events, 'start').mockResolvedValue(undefined as never)
    timers.start('bomb', { seconds: 2, event: 'town/sign' as never })
    const waited = timers.wait('bomb')
    advanceTimers(1500)
    expect(timers.left('bomb')).toBeCloseTo(0.5)
    expect(start).not.toHaveBeenCalled()
    advanceTimers(600)
    await expect(waited).resolves.toBe(true)
    expect(timers.has('bomb')).toBe(false)
    expect(start).toHaveBeenCalledWith('town/sign')
  })

  it('stop() gives the time run and resolves wait() with false; no event', async () => {
    const start = vi.spyOn(events, 'start').mockResolvedValue(undefined as never)
    start.mockClear()
    timers.start('race', { event: 'town/sign' as never })
    const waited = timers.wait('race')
    advanceTimers(3200)
    expect(timers.get('race')?.left).toBeUndefined()
    expect(timers.stop('race')).toBeCloseTo(3.2)
    await expect(waited).resolves.toBe(false)
    expect(start).not.toHaveBeenCalled()
    await expect(timers.wait('nothing')).resolves.toBe(false)
  })

  it('pause, resume and add', () => {
    timers.start('a', { seconds: 10 })
    timers.pause('a')
    advanceTimers(5000)
    expect(timers.left('a')).toBe(10)
    timers.resume()
    timers.add('a', 5)
    advanceTimers(5000)
    expect(timers.left('a')).toBe(10)
  })

  it('stands still where it should not run', () => {
    const timer = { paused: false }
    const base = useSystemStore.getState()
    expect(timerRuns(timer, base, false)).toBe(true)
    expect(timerRuns(timer, { ...base, event: {} as never }, false)).toBe(false)
    expect(timerRuns(timer, base, true)).toBe(false)
    expect(timerRuns({ ...timer, during: { event: true } }, base, true)).toBe(true)
    expect(timerRuns(timer, { ...base, minigame: {} as never }, false)).toBe(true)
    expect(timerRuns(timer, { ...base, windows: [{}] as never }, false)).toBe(false)
    expect(timerRuns(timer, { ...base, title: 'menu' as never }, false)).toBe(false)
    expect(timerRuns(timer, { ...base, map: null }, false)).toBe(false)
  })

  it('shows the second a countdown is in, tenths and the warning at the end', () => {
    const at = (ms: number) => timerText({ ms, total: 60_000, paused: false, show: true })
    expect(at(0)).toEqual({ text: '1:00', warning: false })
    expect(at(100)).toEqual({ text: '1:00', warning: false })
    expect(at(1000)).toEqual({ text: '0:59', warning: false })
    expect(at(50_600)).toEqual({ text: '0:09.4', warning: true })
    expect(timerText({ ms: 61_000, paused: false, show: true }).text).toBe('1:01')
  })
})
