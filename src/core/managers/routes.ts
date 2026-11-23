// game.routes: the visual novel's story order (VN mode, src/content/config/mode.ts). A route's `run` plays
// its events one by one; flag() / check() answers are kept in the save (EngineState.route), so a
// loaded save or a flowchart jump replays the same way up to the box it starts from.
import modeConfig from '@/content/config/mode'
import type {
  AfterStoryInfo,
  AfterStoryMenu,
  HiddenOption,
  RouteConfig,
  RouteContext,
  RouteId,
} from '../defs/routes'
import type { EventConfig } from '../defs/scenes'
import { reportError } from '../errors'
import { getGame } from '../gameRef'
import { type EndingId, loadEvent, loadedEntry, loadFlow, loadRoute, registry } from '../registry'

type EventLeaves = NonNullable<EventConfig['leaves']>

import { compareSets, type StateMark, stateMark } from '../routes/check'
import {
  type Answer,
  boxKeyOf,
  buildGraph,
  choiceKey,
  END,
  type RouteGraph,
  routeBox,
  routeEndMarker,
  START,
} from '../routes/graph'
import { devWayPlan, jumpPlan, type Marks, type Way } from '../routes/jump'
import {
  markPicked,
  markSeen,
  optionKey,
  pickedAt,
  rememberStage,
  seenAt,
  stageAfter,
} from '../routes/progress'
import { playback } from '../scene/playback'
import { type EventRecord, quietly } from '../scene/replay'
import { applyStage, captureStage, type Stage } from '../scene/stage'
import { type RouteRun, useGameStore } from '../stores/game'
import { events, startEvent } from './events'
import { flags } from './flags'
import { minigames } from './minigames'

/** Bumped by stop(): an older run's commands never finish (like an aborted event script). */
let generation = 0
const never = () => new Promise<never>(() => {})

/** How a run starts: from the top, or replaying the way to a box. */
export interface RouteStart {
  /** Routes passed before this one (oldest first). */
  from?: RouteId[]
  /** Answers to give flag() / check() first, in order; after them the real ones are asked. */
  answers?: readonly Answer[]
  /** Skip events (they don't play) until this key; it plays (or continues) from there. */
  target?: string
  /** The target box already ended: carry on after it. */
  targetDone?: boolean
  /** The target's event was saved mid-scene: continue it from the saved line. */
  record?: EventRecord | null
  /** The stage to start on (a save's, or the one a jump starts after). Default: an empty stage. */
  stage?: Stage | null
  /** Flowchart jumps: called for each skipped box, and for the target just before it plays. */
  onSkip?: (key: string) => void
  onArrive?: (key: string) => void
  /**
   * Flowchart jump: while skipping, forced flag() answers are written into the flags and skipped
   * events count as played (a loaded save already has both).
   */
  jump?: boolean
  /** Flowchart jumps through an earlier route: skip all of it, up to its route box. */
  skipAll?: boolean
  /** How the next route (after startRoute) starts. Default: from its top. */
  after?: RouteStart
  /** Resolves once the run is at its target (or at its first event without one). */
  onReady?: () => void
}

function setRun(update: (run: RouteRun) => void) {
  useGameStore.setState((s) => {
    if (s.route) update(s.route)
  })
}

/** Boxes already warned about (once per box per session). */
const warned = new Set<string>()

/** DEV: checks each played box against its flow.ts `sets` (core/routes/check.ts). */
async function devChecker(id: RouteId) {
  const [flow, graph] = await Promise.all([
    loadFlow(id).catch(() => null),
    routes.graph(id).catch(() => null),
  ])
  const branchFlags = new Set<string>()
  for (const edge of graph?.edges ?? []) {
    for (const way of edge.when) for (const b of way) if (b.kind === 'flag') branchFlags.add(b.name)
  }
  return {
    check(key: string, before: StateMark, event: string) {
      const name = `${id}/${key}`
      if (warned.has(name)) return
      // flow.ts sets, else what the event works out by itself (.vn: `leaves`).
      const own = flow?.nodes[key]?.sets
      const left = (loadedEntry('events', event) as EventConfig | undefined)?.leaves
      const sets = own ?? left?.run
      const diff = compareSets(before, sets && (() => sets(getGame())), branchFlags)
      if (diff.length === 0) return
      warned.add(name)
      console.warn(
        own || !left
          ? `[routes] "${name}": its flow.ts \`sets\` does not leave what the event left: ${diff.join(', ')}. ` +
              'Flowchart jumps run sets instead of playing the event (src/content/routes/' +
              `${id}/flow.ts).`
          : `[routes] "${name}": what the engine works out from the event's lines does not match what it left: ${diff.join(', ')}. ` +
              `Write a \`sets\` for it in src/content/routes/${id}/flow.ts (flowchart jumps use it).`,
      )
    },
  }
}

/** A box skipped by a jump counts as played in this playthrough (events.seen / finished). */
function countPlayed(event: string) {
  useGameStore.setState((s) => {
    const record = s.events[event] ?? { started: 0, finished: 0 }
    s.events[event] = { started: record.started + 1, finished: record.finished + 1 }
  })
}

/**
 * A route's choice() plays through the choice event (src/content/events/extras/choice) and resolves
 * with the picked key. While it waits, the route is marked `choosing`: a save made then stores no
 * scene (loading replays the route to this point and asks again).
 */
async function askChoice(
  options: Record<string, string>,
  ask: { text?: string; who?: string } | undefined,
): Promise<string | null> {
  let picked: string | null = null
  setRun((r) => {
    r.choosing = true
  })
  // Shown over the stage the last event left (it carries over while a route plays).
  try {
    const start = events.start as (id: string, params: unknown) => Promise<void>
    await start('extras/choice', {
      options,
      ...(ask ? { ask } : {}),
      onPick: (key: string) => {
        picked = key
      },
    })
  } finally {
    setRun((r) => {
      delete r.choosing
    })
  }
  return picked
}

/** A hidden choice option shows now: every condition it has is met (none = always). */
export function optionShown(cond: HiddenOption | undefined): boolean {
  if (!cond) return true
  const reached = (id: EndingId) => getGame().extras.endingReached(id)
  if (cond.requiresEnding && !cond.requiresEnding.every(reached)) return false
  if (cond.requiredFlag && flags.get(cond.requiredFlag) !== true) return false
  return true
}

/** Movies between boxes play through the Extras movie event (src/content/events/extras/movie). */
function playMovie(movie: string): Promise<void> {
  const start = events.start as (id: string, params: unknown) => Promise<void>
  return start('extras/movie', { movie, unlock: true })
}

async function play(id: RouteId, opts: RouteStart): Promise<void> {
  const gen = generation
  const alive = () => gen === generation
  const forced = opts.answers ?? []
  let skipping = opts.target !== undefined || opts.skipAll === true
  let ready = false
  const markReady = () => {
    if (ready) return
    ready = true
    opts.onReady?.()
  }
  let next: RouteId | null = null
  /** The route ended with ending(): that ending is reached. */
  let reached: EndingId | null = null
  const from = opts.from ?? []
  useGameStore.setState((s) => {
    s.route = { id, from: [...from], answers: [], visited: [], done: false }
  })
  markSeen(id, '@start')
  const dev = import.meta.env.DEV ? await devChecker(id) : null
  if (!alive()) return

  /** The saved / chosen answer for the next branch, if the replay has one. */
  const nextForced = (): Answer | undefined => {
    const index = useGameStore.getState().route?.answers.length ?? 0
    return index < forced.length ? forced[index] : undefined
  }
  const record = (result: Answer) =>
    setRun((r) => {
      r.answers.push(result)
    })
  const answer = (value: () => boolean, flag?: string): boolean => {
    const given = nextForced()
    const result = typeof given === 'boolean' ? given : value()
    if (typeof given === 'boolean' && skipping && opts.jump && flag) {
      ;(flags.set as (id: string, v: boolean) => void)(flag, given)
    }
    record(result)
    return result
  }

  const enter = (key: string) => {
    setRun((r) => {
      r.visited.push(key)
      r.done = false
    })
    markSeen(id, key)
  }

  const ctx: RouteContext = {
    event: async (event, named) => {
      const key = boxKeyOf(event, named)
      if (!alive()) return never()
      if (skipping) {
        if (key !== opts.target) {
          opts.onSkip?.(key)
          if (opts.jump) countPlayed(event)
          setRun((r) => {
            r.visited.push(key)
            r.done = true
          })
          return
        }
        skipping = false
        if (opts.targetDone) {
          setRun((r) => {
            r.visited.push(key)
            r.done = true
          })
          markReady()
          return
        }
        opts.onArrive?.(key)
        enter(key)
        if (opts.record) {
          const { caughtUp, finished } = events.resumeRun(opts.record)
          void caughtUp.then(markReady)
          await finished
        } else {
          const mark = dev ? stateMark() : null
          const run = startEvent(event)
          markReady()
          await run
          if (mark && dev && alive()) dev.check(key, mark, event)
        }
      } else {
        enter(key)
        const mark = dev ? stateMark() : null
        const run = startEvent(event)
        markReady()
        await run
        if (mark && dev && alive()) dev.check(key, mark, event)
      }
      if (!alive()) return never()
      setRun((r) => {
        r.done = true
      })
      // The stage it ended on: a flowchart jump to the box after it starts from there.
      rememberStage(id, key, captureStage())
    },
    flag: (flag) => answer(() => flags.get(flag) === true, flag),
    check: (_label, test) => answer(() => test(getGame())),
    choice: async (options, ask) => {
      if (!alive()) return never()
      // A choice is a box of its own (the flowchart can load the game right at it).
      const box = choiceKey(options as Record<string, string>, ask?.key)
      const keys = Object.keys(options) as string[]
      const effects = (ask?.effects ?? {}) as Record<
        string,
        ((game: ReturnType<typeof getGame>) => void) | undefined
      >
      const given = nextForced()
      const replayed = typeof given === 'string' && keys.includes(given) ? given : undefined
      if (skipping && box !== opts.target) {
        // Passed on the way to the target: the saved pick, without asking.
        setRun((r) => {
          r.visited.push(box)
          r.done = true
        })
        const pick = replayed ?? (keys[0] as string)
        // A flowchart jump starts from a new game: the pick's own effects happen again, quietly.
        // (A save being loaded already holds them.)
        if (opts.jump) helper(effects[pick], `effects of "${id}/${box}" (${pick})`)
        record(pick)
        return pick as never
      }
      if (skipping) {
        // The target itself (a save made at this choice, or a flowchart jump to it): ask it.
        skipping = false
        opts.onArrive?.(box)
      }
      enter(box)
      if (replayed !== undefined) {
        record(replayed)
        setRun((r) => {
          r.done = true
        })
        return replayed as never
      }
      // Hidden options (ask.hidden) only when their condition is met; one left = no question.
      const hidden = (ask?.hidden ?? {}) as Record<string, HiddenOption | undefined>
      const shown = keys.filter((k) => optionShown(hidden[k]))
      if (shown.length === 0 && import.meta.env.DEV) {
        console.warn(
          `[routes] choice "${box}" in "${id}": every option is hidden; taking the first`,
        )
      }
      let picked: string | null
      if (shown.length <= 1) picked = shown[0] ?? (keys[0] as string)
      else {
        markReady()
        const list = Object.fromEntries(
          shown.map((k) => [k, (options as Record<string, string>)[k] as string]),
        )
        const { hidden: _, ...plain } = ask ?? {}
        picked = await askChoice(list, ask ? plain : undefined)
      }
      if (!alive()) return never()
      const key =
        picked !== null && shown.includes(picked) ? picked : (shown[0] ?? (keys[0] as string))
      // Picked by the player (not replayed): its line on the flowchart is solid from now on.
      markSeen(id, optionKey(box, key))
      try {
        effects[key]?.(getGame())
      } catch (error) {
        reportError(`effects of "${id}/${box}" (${key})`, error)
      }
      record(key)
      setRun((r) => {
        r.done = true
      })
      return key as never
    },
    startRoute: (route) => {
      next = route
      return routeEndMarker(route)
    },
    ending: (ending) => {
      reached = ending
      return routeEndMarker(id)
    },
    chapter: (chapter) => {
      if (!alive()) return
      // Replayed on the way to a save's box or a jump target: set it without the toast.
      if (skipping) quietly(() => getGame().chapters.reach(chapter))
      else getGame().chapters.reach(chapter)
    },
    movie: async (movie) => {
      if (!alive()) return never()
      if (skipping) return
      markReady()
      await playMovie(movie)
    },
  }

  const def = await loadRoute(id)
  if (!alive()) return
  await def.run(ctx)
  if (!alive()) return
  if (skipping && !opts.skipAll) {
    // The route changed since the save (the box is gone): say so, and start the route again.
    reportError(
      `route "${id}"`,
      new Error(`Box "${opts.target}" was not reached. The route was changed since this save.`),
    )
    generation++
    markReady()
    return routes.start(id, { from })
  }
  if (next) {
    markSeen(id, routeBox(next))
    const after = opts.after ?? {}
    return play(next, { ...after, from: [...from, id], onReady: opts.onReady })
  }
  markReady()
  // The end of the story: back to the title. ending() also marks its ending as reached (Extras).
  markSeen(id, END)
  if (reached) getGame().extras.reachEnding(reached)
  playback.stopSkip()
  applyStage(null)
  useGameStore.setState((s) => {
    s.route = null
  })
  await getGame().session.toTitle()
}

const graphs = new Map<RouteId, Promise<RouteGraph>>()
const marks: Marks = { seenAt, pickedAt }

/** Every route's chart (a route whose file has a mistake is left out; its error is reported). */
async function allGraphs(): Promise<Map<RouteId, RouteGraph>> {
  const result = new Map<RouteId, RouteGraph>()
  for (const id of registry.routes) {
    try {
      result.set(id, await routes.graph(id))
    } catch (error) {
      reportError(`route "${id}"`, error)
    }
  }
  return result
}

/** Every route's definition (a route whose file fails to load is left out; its error is reported). */
async function allRoutes(): Promise<{ id: RouteId; def: RouteConfig }[]> {
  const list = await Promise.all(
    registry.routes.map((id) =>
      loadRoute(id).then(
        (def) => ({ id, def }),
        (error: unknown) => {
          reportError(`route "${id}"`, error)
          return null
        },
      ),
    ),
  )
  return list.filter((r) => r !== null)
}

/** The routes a story starts from: common and every after story. */
async function rootRoutes(): Promise<Set<RouteId>> {
  const roots = new Set<RouteId>(['common' as RouteId])
  for (const { id, def } of await allRoutes()) if (def.afterStory) roots.add(id)
  return roots
}

/** Every ending this after story needs was reached. */
const afterStoryOpen = (def: RouteConfig) =>
  (def.afterStory?.requiresEnding ?? []).every((id) => getGame().extras.endingReached(id))

/** Runs a flow.ts helper; a mistake in it is reported, the jump goes on. */
function helper(fn: ((game: ReturnType<typeof getGame>) => void) | undefined, what: string) {
  if (!fn) return
  try {
    quietly(() => fn(getGame()))
  } catch (error) {
    reportError(what, error)
  }
}

export const routes = {
  /** Every route id. */
  ids: (): RouteId[] => registry.routes,

  /**
   * Starts a route from its top (a new game starts 'common' in VN mode). Resolves once its first
   * event has started; the story then plays on by itself.
   */
  start(id: RouteId, opts: RouteStart = {}): Promise<void> {
    generation++
    // A new game, a loaded save or a jump: never keep skipping into it.
    playback.stopSkip()
    // The stage it starts on: a save's, the one a jump starts after, or none (a new game).
    applyStage(opts.stage ?? null)
    return new Promise((resolve) => {
      play(id, { ...opts, onReady: resolve }).catch((error: unknown) => {
        reportError(`route "${id}"`, error)
        resolve()
      })
    })
  },

  /**
   * Loads a save's route position: replays the way to the box it was at, and continues that
   * box's event from the saved line (`record`, a mid-scene save) or after the box.
   */
  resume(run: RouteRun, record: EventRecord | null, stage: Stage | null = null): Promise<void> {
    const target = run.visited.at(-1)
    return routes.start(run.id as RouteId, {
      from: run.from as RouteId[],
      answers: run.answers,
      stage,
      ...(target === undefined ? {} : { target, targetDone: run.done && !record, record }),
    })
  },

  /** Stops the running route (loading a save, a new game, back to the title). */
  stop(): void {
    generation++
  },

  /** Whether a route is playing (VN mode). */
  isRunning(): boolean {
    return useGameStore.getState().route != null
  },

  /** The route and box the story is at, or null. */
  current(): { route: RouteId; key: string | null } | null {
    const run = useGameStore.getState().route
    return run ? { route: run.id as RouteId, key: run.visited.at(-1) ?? null } : null
  },

  /** The player picked this box in the flowchart (ways through it are preferred from now on). */
  pick(route: RouteId, key: string): void {
    markPicked(route, key)
  },

  /** Has the player reached this box, in any playthrough? */
  seen(route: RouteId, key: string): boolean {
    return seenAt(route, key) > 0
  },

  /**
   * The way the flowchart would load `key` of `route`: the ways through earlier routes first, then
   * the one to the box. Null when no way of seen boxes reaches it.
   */
  async way(route: RouteId, key: string): Promise<Way[] | null> {
    return jumpPlan(route, key, await allGraphs(), marks, await rootRoutes())
  },

  /**
   * The after stories (routes with `afterStory`, VN mode only), in order: `available` (every
   * ending it needs was reached) and `locked`, plus `launch` to start one. Outside VN mode both
   * lists are empty. src/content/start.ts shows "After Stories" while `available` has any.
   */
  async afterStories(): Promise<AfterStoryMenu> {
    const all = modeConfig.vnOnly ? (await allRoutes()).filter(({ def }) => def.afterStory) : []
    const at = (id: RouteId) => registry.routes.indexOf(id)
    all.sort(
      (a, b) =>
        (a.def.afterStory?.order ?? at(a.id)) - (b.def.afterStory?.order ?? at(b.id)) ||
        at(a.id) - at(b.id),
    )
    const info = ({ id, def }: { id: RouteId; def: RouteConfig }): AfterStoryInfo => ({
      id,
      title: def.title,
      ...(def.description ? { description: def.description } : {}),
      ...(def.image ? { image: def.image } : {}),
      ...(def.color ? { color: def.color } : {}),
      requiresEnding: [...(def.afterStory?.requiresEnding ?? [])],
      played: seenAt(id, START) > 0,
    })
    const open = new Set(all.filter(({ def }) => afterStoryOpen(def)).map(({ id }) => id))
    return {
      available: all.filter(({ id }) => open.has(id)).map(info),
      locked: all.filter(({ id }) => !open.has(id)).map(info),
      launch: (id) => {
        if (!open.has(id)) {
          if (import.meta.env.DEV) console.warn(`[routes] after story "${id}" is not available`)
          return
        }
        // Called from the selection minigame: it fades out over the story's start.
        if (minigames.isRunning()) minigames.finish(id)
        void routes.startAfterStory(id)
      },
    }
  },

  /**
   * Starts an after story (VN mode): a fresh game (the difficulty kept, nothing else carried
   * over), then the route from its top. Its endings must be reached; false when it can't start.
   */
  async startAfterStory(id: RouteId): Promise<boolean> {
    if (!modeConfig.vnOnly) {
      if (import.meta.env.DEV) console.warn('[routes] after stories are for VN mode only')
      return false
    }
    const def = await loadRoute(id)
    if (!def.afterStory || !afterStoryOpen(def)) {
      if (import.meta.env.DEV) console.warn(`[routes] "${id}" is not an available after story`)
      return false
    }
    await getGame().save.newGameWith(() => routes.start(id))
    return true
  },

  /**
   * Which routes belong to an after story (for the flowchart's tab groups): every after story and
   * the routes they move on to with startRoute(). The rest is the main story.
   */
  async afterStoryRoutes(): Promise<Set<RouteId>> {
    const roots = await rootRoutes()
    roots.delete('common' as RouteId)
    const group = new Set<RouteId>()
    const todo = [...roots]
    while (todo.length) {
      const id = todo.pop() as RouteId
      if (group.has(id)) continue
      group.add(id)
      try {
        for (const next of (await routes.graph(id)).links)
          if (!roots.has(next) && next !== 'common') todo.push(next)
      } catch {
        // its error is reported where the chart is drawn
      }
    }
    return group
  },

  /**
   * Flowchart jump: a fresh game, then each box on the way runs its `sets` (flow.ts) instead of
   * playing, flags asked with flag() are set to the way's answers, the picked box runs `before`
   * and plays, and the story carries on from there. Resolves false if the box can't be loaded.
   */
  async jump(route: RouteId, key: string): Promise<boolean> {
    const plan = await routes.way(route, key)
    if (!plan || plan.length === 0) return false
    await playPlan(plan, key)
    return true
  },

  /**
   * Dev start (@start / devStart()): the way to `key` of `route` that `answers` name, every box
   * counted as seen, or a message saying which answers are needed.
   */
  async devWay(route: RouteId, key: string, answers: readonly Answer[]): Promise<Way[] | string> {
    return devWayPlan(route, key, await allGraphs(), answers, await rootRoutes())
  },

  /** Plays a worked-out way like a flowchart jump (dev start). */
  playWay(plan: Way[], key: string): Promise<void> {
    return playPlan(plan, key)
  },

  /** A route's flowchart (worked out once from its `run`). */
  graph(id: RouteId): Promise<RouteGraph> {
    let graph = graphs.get(id)
    if (!graph) {
      graph = loadRoute(id).then((def) => buildGraph(id, def.run))
      graph.catch(() => graphs.delete(id))
      graphs.set(id, graph)
    }
    return graph
  },
}

/** A flowchart jump along a worked-out way (routes.jump, dev start). */
async function playPlan(plan: Way[], key: string): Promise<void> {
  const flows = await Promise.all(plan.map((way) => loadFlow(way.route)))
  // Events on the way that leave something behind by themselves (.vn scripts: `leaves`).
  const leaves = new Map<string, EventLeaves>()
  await Promise.all(
    plan.map(async (way) => {
      const graph = await routes.graph(way.route)
      await Promise.all(
        way.nodes.map(async (box) => {
          const node = graph.nodes[box]
          if (node?.kind !== 'event') return
          const def = await loadEvent(node.event).catch(() => null)
          if (def?.leaves) leaves.set(`${way.route}/${box}`, def.leaves)
        }),
      )
    }),
  )
  let start: RouteStart | undefined
  for (let i = plan.length - 1; i >= 0; i--) {
    const way = plan[i] as Way
    const nodes = flows[i]?.nodes ?? {}
    const sets = (k: string) => {
      const own = nodes[k]?.sets
      if (own) return helper(own, `sets of "${way.route}/${k}"`)
      const left = leaves.get(`${way.route}/${k}`)
      if (!left) return
      if (left.partial && import.meta.env.DEV)
        console.warn(
          `[routes] jump: "${way.route}/${k}" has lines the engine can't work out without playing it (a choice or an if on a scene value); add a \`sets\` for it in flow.ts`,
        )
      helper(left.run, `what "${way.route}/${k}" leaves`)
    }
    start =
      i === plan.length - 1
        ? {
            answers: way.answers,
            jump: true,
            onSkip: sets,
            target: key,
            onArrive: (k) => helper(nodes[k]?.before, `before of "${way.route}/${k}"`),
          }
        : { answers: way.answers, jump: true, onSkip: sets, skipAll: true, after: start }
  }
  // The box starts on the stage the last box before it (that played on this device) ended on.
  const before = plan.flatMap((way) => way.nodes.map((box) => ({ route: way.route, box })))
  before.pop() // the target itself
  let stage: Stage | undefined
  for (let i = before.length - 1; i >= 0 && !stage; i--) {
    const { route: r, box } = before[i] as { route: RouteId; box: string }
    stage = stageAfter(r, box)
  }
  const first = (plan[0] as Way).route
  await getGame().save.newGameWith(() =>
    routes.start(first, { ...(start as RouteStart), stage: stage ?? null }),
  )
}

/** Tests: forget the worked-out charts and the boxes already warned about. */
export function forgetGraphs(): void {
  graphs.clear()
  warned.clear()
}
