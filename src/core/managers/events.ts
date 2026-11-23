import scenes from '@/content/scenes'
import type { EventContext, ParamArgs } from '../define'
import { reportError } from '../errors'
import { getGame } from '../gameRef'
import { type EventId, type EventParams, loadEvent } from '../registry'
import { chapterCardCovered, endChapterCard } from '../scene/chapterCard'
import { resetScene, sceneApi } from '../scene/director'
import { isSkippingEffects, usePlaybackStore } from '../scene/playback'
import { endEventPreload, startEventPreload } from '../scene/preload'
import {
  beginRecording,
  type EventRecord,
  endRecording,
  isFastForward,
  recordStep,
  startReplay,
  takeStep,
} from '../scene/replay'
import { useGameStore } from '../stores/game'
import { unlock } from '../stores/persistent'
import { useSystemStore } from '../stores/system'
import { unlockKey } from '../unlocks'
import { peekWorld } from '../world/getWorld'

/** How deep events may run inside each other (A → B → C …). A safety net against runaway chains. */
export const MAX_EVENT_DEPTH = 8

/** Waits are skipped while fast-forwarding (loading a mid-scene save, rollback). */
// While skipping effects, a wait also ends early the moment skipping starts.
const sceneWait = (ms: number) =>
  new Promise<void>((resolve) => {
    if (isFastForward()) return resolve()
    const timer = setTimeout(done, ms)
    const unsubscribe = usePlaybackStore.subscribe(() => {
      if (isSkippingEffects()) done()
    })
    function done() {
      clearTimeout(timer)
      unsubscribe()
      resolve()
    }
  })

/** Random number 0..1 that replays the same way after loading a mid-scene save. */
function random(): number {
  const replayed = takeStep('r')
  const value = replayed ? replayed.v : Math.random()
  recordStep({ k: 'r', v: value })
  return value
}

type AnyEvent = { replay?: string; run: (ctx: EventContext<unknown>) => unknown }

export class EventLoopError extends Error {
  constructor(readonly chain: EventId[]) {
    super(
      `Event loop: ${chain.join(' → ')}. An event cannot run itself, directly or through other ` +
        'events. To repeat something (e.g. a menu), use a while loop inside one event.',
    )
    this.name = 'EventLoopError'
  }
}

export class EventDepthError extends Error {
  constructor(readonly chain: EventId[]) {
    super(`Events nested more than ${MAX_EVENT_DEPTH} deep: ${chain.join(' → ')}.`)
    this.name = 'EventDepthError'
  }
}

/**
 * Bumped by events.abort(): scripts of an older generation get commands that never finish,
 * so a stopped event quietly stays where it is instead of acting on the new game.
 */
let generation = 0
const never = () => new Promise<never>(() => {})

/** The scene commands for one run: they stop working once that run is aborted. */
function guardedApi(gen: number): typeof sceneApi {
  const api = {} as Record<string, unknown>
  for (const [name, fn] of Object.entries(sceneApi)) {
    api[name] = (...args: unknown[]) =>
      gen === generation ? (fn as (...a: unknown[]) => unknown)(...args) : never()
  }
  return api as unknown as typeof sceneApi
}

/** Runs one event script. `stack` = the events it is running inside of (outermost first). */
async function runScript(id: EventId, params: unknown, stack: EventId[]): Promise<void> {
  const gen = generation
  const chain = [...stack, id]
  if (stack.includes(id)) throw new EventLoopError(chain)
  if (chain.length > MAX_EVENT_DEPTH) throw new EventDepthError(chain)

  const def = (await loadEvent(id)) as AnyEvent
  void startEventPreload(id)
  // A 'screen' chapter card still fading in (a route's chapter() before this event): start once it
  // covers the stage, so the stage this event sets up is hidden under it (scene/chapterCard.ts).
  const covering = chapterCardCovered()
  if (covering) await covering
  const setRunning = (running: EventId[]) =>
    useSystemStore.setState((s) => {
      s.event = { id: running.at(-1) as EventId, stack: running }
    })
  setRunning(chain)
  bumpEvent(id, 'started')
  try {
    await def.run({
      ...guardedApi(gen),
      params,
      game: getGame(),
      wait: (ms) => (gen === generation ? sceneWait(ms) : never()),
      random,
      event: ((childId: EventId, childParams?: unknown) =>
        runScript(childId, childParams, chain)) as EventContext<unknown>['event'],
    })
    if (gen === generation) {
      bumpEvent(id, 'finished')
      // Replayable events unlock in Extras when they finish, also when run from another event.
      if (def.replay) unlock(unlockKey.scene(id))
    }
  } finally {
    endEventPreload()
    // Back in the parent event (or nothing, for the outermost one).
    if (stack.length > 0 && gen === generation) setRunning(stack)
  }
}

// Top-level events run one at a time. Starting one while another runs queues it.
let queue: Promise<unknown> = Promise.resolve()

/** Counts a start or a finish (saved with the game, see events.seen). */
function bumpEvent(id: string, what: 'started' | 'finished') {
  useGameStore.setState((s) => {
    const record = s.events[id] ?? { started: 0, finished: 0 }
    s.events[id] = { ...record, [what]: record[what] + 1 }
  })
}

// Events started by startOnce() that have not finished yet (no double queuing).
const onceQueued = new Set<string>()

/** React: whether the event has started in this playthrough. */
export const events = {
  /**
   * Runs an event. Resolves when it has finished.
   * Inside an event, use `event('other')` from the script instead: that runs it right away
   * in the same scene. (game.events.start would queue it until the current event ends.)
   */
  start<K extends EventId>(id: K, ...[params]: ParamArgs<EventParams<K>>): Promise<void> {
    const running = useSystemStore.getState().event
    if (running && import.meta.env.DEV) {
      console.warn(
        `[events] "${id}" was started while "${running.id}" is running, so it will run after ` +
          `"${running.stack[0]}" ends. Inside an event script use event('${id}') to run it now. ` +
          'Do not await this call inside an event: it would wait forever.',
      )
    }
    const run = queue.then(async () => {
      const gen = generation
      try {
        beginRecording(id, params)
        await runScript(id, params, [])
      } catch (error) {
        reportError(`event "${id}"`, error)
        throw error
      } finally {
        if (gen === generation) {
          // In a route the scene is remembered: Back from the next one can come into it again.
          endRecording(useGameStore.getState().route ? scenes.log.backScenes : 0)
          resetScene()
          useSystemStore.setState((s) => {
            s.event = null
          })
        }
      }
    })
    queue = run.catch(() => {})
    return run
  },

  /**
   * Loads a mid-scene save: starts the event and replays its record instantly, up to the line
   * where it was saved. Resolves once the player is there (the event itself keeps running).
   */
  resume(record: EventRecord): Promise<void> {
    const { caughtUp, finished } = events.resumeRun(record)
    void finished.catch(() => {})
    return caughtUp
  },

  /** Like resume(), and also gives the promise of the event's end (routes wait for it). */
  resumeRun(record: EventRecord): { caughtUp: Promise<void>; finished: Promise<void> } {
    const caughtUp = startReplay(record.steps)
    const finished = (events.start as (id: string, params?: unknown) => Promise<void>)(
      record.id,
      record.params,
    )
    return { caughtUp, finished }
  },

  /**
   * Stops the running event (and forgets queued ones), e.g. before loading a save. Its script
   * stays paused forever; the scene is cleared right away.
   */
  abort(): void {
    if (!useSystemStore.getState().event) return
    generation++
    queue = Promise.resolve()
    // The map object that started the event waits for it forever: let the player move again.
    peekWorld()?.dropInteraction()
    // A chapter card still up belongs to the scene that is going (a load, back to the title).
    endChapterCard()
    endRecording()
    resetScene()
    useSystemStore.setState((s) => {
      s.event = null
    })
  },

  /** Has the event started in this playthrough? (Saved with the game.) */
  seen(id: EventId): boolean {
    return (useGameStore.getState().events[id]?.started ?? 0) > 0
  },

  /** Has the event run to its end in this playthrough? */
  finished(id: EventId): boolean {
    return (useGameStore.getState().events[id]?.finished ?? 0) > 0
  },

  /** How many times the event has started in this playthrough. */
  count(id: EventId): number {
    return useGameStore.getState().events[id]?.started ?? 0
  },

  /**
   * Starts the event only if it has never started in this playthrough. Resolves true if it ran
   * (when it ends), false if it was skipped. Use for scenes that happen once.
   */
  startOnce<K extends EventId>(id: K, ...[params]: ParamArgs<EventParams<K>>): Promise<boolean> {
    if (events.seen(id) || onceQueued.has(id)) return Promise.resolve(false)
    onceQueued.add(id)
    const run = (events.start as (id: string, params?: unknown) => Promise<void>)(id, params)
    return run.then(
      () => {
        onceQueued.delete(id)
        return true
      },
      (error: unknown) => {
        onceQueued.delete(id)
        throw error
      },
    )
  },

  isRunning(): boolean {
    return useSystemStore.getState().event !== null
  },
}

/**
 * Starts an event whose id comes from data (a map's intro, a timer, a route's box), so its params
 * can't be known here. Typed loosely on purpose: with game.events.start the call would stop
 * compiling once every event of a game takes params.
 */
export function startEvent(id: string, params?: unknown): Promise<void> {
  const start = events.start as (id: string, params?: unknown) => Promise<void>
  return params === undefined ? start(id) : start(id, params)
}
