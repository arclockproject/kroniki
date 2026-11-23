// game.timers: countdowns and stopwatches (saved). Settings: src/content/config/timers.ts; drawn by
// layers/TimerLayer.tsx.
import config from '@/content/config/timers'
import { audio } from '../audio/manager'
import { reportError } from '../errors'
import type { EventId } from '../registry'
import { type TimerState, useGameStore } from '../stores/game'
import { type SystemState, useSystemStore } from '../stores/system'
import type { TimerRunsDuring } from '../timers'
import { peekWorld } from '../world/getWorld'
import { startEvent } from './events'

export interface TimerOptions {
  /** How long a countdown runs. Leave out for a stopwatch that counts up until stop(). */
  seconds?: number
  /** Text in front of the time ("Bomb"). Translated when shown. */
  label?: string
  /** Shown on screen. Default true. */
  show?: boolean
  /** An event started when the countdown runs out (it is saved, unlike a function). */
  event?: EventId
  /** Where it keeps running besides the map; missing keys use src/content/config/timers.ts. */
  during?: Partial<TimerRunsDuring>
}

/** A timer as the game sees it. */
export interface TimerView {
  id: string
  /** Seconds left (countdowns), else undefined. */
  left: number | undefined
  /** Seconds it has run. */
  elapsed: number
  paused: boolean
  label: string | undefined
}

type Waiter = (ranOut: boolean) => void
const waiters = new Map<string, Set<Waiter>>()
let started = false

const all = () => useGameStore.getState().timers ?? {}

function settle(id: string, ranOut: boolean) {
  const set = waiters.get(id)
  waiters.delete(id)
  for (const waiter of set ?? []) waiter(ranOut)
}

function view(id: string, timer: TimerState): TimerView {
  return {
    id,
    left: timer.total === undefined ? undefined : Math.max(0, timer.total - timer.ms) / 1000,
    elapsed: timer.ms / 1000,
    paused: timer.paused,
    label: timer.label,
  }
}

/** Does this timer run in the state the game is in? (Exported for tests.) */
export function timerRuns(
  timer: Pick<TimerState, 'paused' | 'during'>,
  s: Pick<SystemState, 'map' | 'event' | 'minigame' | 'windows' | 'title' | 'mapTransition'>,
  interacting: boolean,
): boolean {
  if (timer.paused || s.title !== null || s.mapTransition !== null) return false
  const during = { ...config.runsDuring, ...timer.during }
  if (s.windows.length > 0 && !during.window) return false
  if (s.minigame && !during.minigame) return false
  // A map interaction (reading a sign) counts as an event.
  if ((s.event || interacting) && !during.event) return false
  return s.map !== null || s.minigame !== null || s.event !== null
}

/** Moves every running timer on by `ms`. Called by the ticker; tests call it directly. */
export function advanceTimers(ms: number): void {
  const timers = all()
  const ids = Object.keys(timers)
  if (ids.length === 0 || ms <= 0) return
  const system = useSystemStore.getState()
  const interacting = !!peekWorld()?.interacting
  const done: string[] = []
  let ticked = false
  let changed = false
  const next: Record<string, TimerState> = {}
  for (const id of ids) {
    const timer = timers[id] as TimerState
    if (!timerRuns(timer, system, interacting)) {
      next[id] = timer
      continue
    }
    changed = true
    const now = timer.ms + ms
    if (timer.total !== undefined) {
      const leftBefore = timer.total - timer.ms
      const leftNow = timer.total - now
      const warn = config.warnSeconds * 1000
      // A new second inside the warning time.
      if (
        leftNow > 0 &&
        leftNow <= warn &&
        Math.ceil(leftNow / 1000) < Math.ceil(leftBefore / 1000)
      )
        ticked = true
      if (leftNow <= 0) {
        done.push(id)
        continue
      }
    }
    next[id] = { ...timer, ms: now }
  }
  if (!changed) return
  useGameStore.setState((s) => {
    s.timers = next
  })
  const { tick, end } = config.sounds
  if (done.length > 0) {
    if (end && audio.has(end)) audio.sfx(end)
  } else if (ticked && tick && audio.has(tick)) audio.sfx(tick)
  for (const id of done) {
    settle(id, true)
    const event = (timers[id] as TimerState).event
    if (event) void startEvent(event).catch((error: unknown) => reportError(`timer "${id}"`, error))
  }
}

export const timers = {
  /**
   * Starts a timer (again, if `id` is already running). With `seconds` it counts down and ends by
   * itself; without, it counts up until stop().
   * `game.timers.start('bomb', { seconds: 60, label: 'Bomb', event: 'cave/boom' })`
   */
  start(id: string, options: TimerOptions = {}): void {
    settle(id, false)
    const timer: TimerState = {
      ms: 0,
      paused: false,
      show: options.show ?? true,
      ...(options.seconds !== undefined ? { total: Math.max(0, options.seconds) * 1000 } : {}),
      ...(options.label !== undefined ? { label: options.label } : {}),
      ...(options.event !== undefined ? { event: options.event } : {}),
      ...(options.during ? { during: options.during } : {}),
    }
    useGameStore.setState((s) => {
      s.timers = { ...s.timers, [id]: timer }
    })
  },

  /** Takes a timer away without its `event`. Returns the seconds it had run (0 if there was none). */
  stop(id: string): number {
    const timer = all()[id]
    if (!timer) return 0
    useGameStore.setState((s) => {
      const rest = { ...s.timers }
      delete rest[id]
      s.timers = rest
    })
    settle(id, false)
    return timer.ms / 1000
  },

  /** Holds one timer (or all of them) until resume(). */
  pause(id?: string): void {
    setPaused(id, true)
  },
  resume(id?: string): void {
    setPaused(id, false)
  },

  /** Gives a countdown more time (or takes some away with a negative number). */
  add(id: string, seconds: number): void {
    useGameStore.setState((s) => {
      const timer = s.timers?.[id]
      if (timer?.total !== undefined) timer.total = Math.max(0, timer.total + seconds * 1000)
    })
  },

  has(id: string): boolean {
    return id in all()
  },
  /** Seconds left on a countdown (0 when there is no such timer or it counts up). */
  left(id: string): number {
    const timer = all()[id]
    return timer ? (view(id, timer).left ?? 0) : 0
  },
  /** Seconds a timer has run (0 when there is none). */
  elapsed(id: string): number {
    return (all()[id]?.ms ?? 0) / 1000
  },
  get(id: string): TimerView | undefined {
    const timer = all()[id]
    return timer ? view(id, timer) : undefined
  },
  list(): TimerView[] {
    return Object.entries(all()).map(([id, timer]) => view(id, timer))
  },

  /**
   * Resolves true when the countdown runs out, false when it is stopped or started again first
   * (also when a save is loaded). False right away if there is no such timer.
   */
  wait(id: string): Promise<boolean> {
    if (!timers.has(id)) return Promise.resolve(false)
    return new Promise((resolve) => {
      let set = waiters.get(id)
      if (!set) {
        set = new Set()
        waiters.set(id, set)
      }
      set.add(resolve)
    })
  },

  /** A load or a new game replaced the timers: nobody waits for the old ones any more. */
  forgetWaiters(): void {
    for (const id of [...waiters.keys()]) settle(id, false)
  },

  /** Runs the timers. Called once from boot.tsx. */
  startTicking(): void {
    if (started) return
    started = true
    let last = performance.now()
    setInterval(() => {
      const now = performance.now()
      // A hidden tab or a stalled frame must not eat the countdown in one jump.
      const delta = document.hidden ? 0 : Math.min(now - last, 250)
      last = now
      advanceTimers(delta)
    }, 100)
  },
}

function setPaused(id: string | undefined, paused: boolean) {
  useGameStore.setState((s) => {
    for (const [key, timer] of Object.entries(s.timers ?? {}))
      if (id === undefined || key === id) timer.paused = paused
  })
}

/** React: one timer, re-drawn once per second (the on-screen layer writes the digits itself). */
export function useTimer(id: string): TimerView | undefined {
  useGameStore((s) => {
    const timer = s.timers?.[id]
    return timer ? `${Math.floor(timer.ms / 1000)}|${timer.paused}|${timer.total}` : ''
  })
  return timers.get(id)
}
