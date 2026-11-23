// Routes (visual novel mode) and their flowcharts. Part of core/define.ts (import from there).
// A route is the order the story's events play in: src/content/routes/<name>/index.ts. The
// flowchart is worked out from `run` (core/routes/graph.ts); flow.ts adds titles and jump helpers.

import type { ContentIds, RouteKeys } from '@/generated/registry.gen'
import type { Game } from '../game'
import type { ChapterId } from '../managers/chapters'
import type { BooleanFlagId } from '../managers/flags'
import type { CharacterId, EndingId, EventId, MovieId } from '../registry'

/** Every route folder (src/content/routes/<name>). */
export type RouteId = ContentIds['routes']
/** The node keys of a route: the second argument of each `event('id', 'key')` in its file. */
export type RouteKeyOf<R extends RouteId> = R extends keyof RouteKeys ? RouteKeys[R] : never

declare const routeEnd: unique symbol
/** What `startRoute()` and `ending()` return: `return startRoute('anna')` ends the route there. */
export interface RouteEnd {
  readonly [routeEnd]: true
  readonly route: RouteId
}

/** What a route's `run` gets. There is no `game` here on purpose: see `check`. */
export interface RouteContext {
  /**
   * Plays an event as one box of the flowchart and waits for it to end. `key` names that box
   * (lowercase letters, digits and _), unique in this route: the same event may appear twice
   * with two keys. Events the event runs inside itself belong to the same box. Left out, the box
   * is named after the last part of the event id: event('common/day1_morning') = 'day1_morning'.
   */
  event: (id: EventId, key?: string) => Promise<void>
  /**
   * A yes/no story flag (src/content/flags.ts), for `if`. Every branch of a route must use
   * flag() or check(): that is how the flowchart sees both ways, and how saves and flowchart
   * jumps take the same way again.
   */
  flag: (id: BooleanFlagId) => boolean
  /**
   * Any other condition, for `if`: `check('rich', (game) => game.money.get() > 100)`. The label names
   * the branch on the flowchart's lines (dev tools).
   */
  check: (label: string, test: (game: Game) => boolean) => boolean
  /**
   * Moves on to another route (its own flowchart page). Always the last thing in its branch:
   * write `return startRoute('anna')` (anything after it is an error). A route that ends without one ends the game (title screen).
   */
  startRoute: (id: RouteId) => RouteEnd
  /**
   * The story ends here, this way: the ending (src/content/endings/<id>) counts as reached for good
   * (Extras → Endings; a hidden choice option can need it: `requiresEnding`), then the title screen.
   * Write `return ending('normal')`. A route may have several endings, one per way. A route may
   * also just end (return / the end of `run`): the title screen, and no ending is reached.
   */
  ending: (id: EndingId) => RouteEnd
  /**
   * Asks the player and resolves with the picked option's key. Each option is its own way on the
   * flowchart: `const pick = await choice({ stay: 'Stay in town', go: 'Take the bus' })`, then
   * `if (pick === 'stay')`. `text` shows a line above the options (`who` says it; without `who` it is
   * narration). The choice is a box of its own on the flowchart (the player can load the game right
   * at it); its box is named after its option keys, or `key` when two choices have the same options.
   * Saves and flowchart jumps replay the picked option.
   */
  choice: <K extends string>(
    options: Record<K, string>,
    ask?: {
      text?: string
      who?: CharacterId
      key?: string
      /**
       * Options shown only when their condition is met: `{ secret: { requiresEnding: ['anna'] } }`.
       * When only one option is left it plays by itself (no question). Keep one option always shown.
       */
      hidden?: Partial<Record<NoInfer<K>, HiddenOption>>
      /**
       * What picking an option does by itself (points, a flag, an item):
       * `{ effects: { wave: (game) => game.relationships.change('anna', 1) } }`. Runs when the
       * player picks it, and again (quietly) when a flowchart jump passes this choice with that
       * pick, so jumps need no `sets` for it. Loading a save never runs it (the save has it).
       */
      effects?: Partial<Record<NoInfer<K>, (game: Game) => void>>
    },
  ) => Promise<K>
  /** Plays a movie (src/content/movies) between two events, e.g. an ending and the credits. */
  movie: (id: MovieId) => Promise<void>
  /**
   * A chapter (src/content/chapters.ts) begins here: game.chapters.reach(id). On the flowchart its
   * number is a line across the chart, and every box played after it is drawn below that line.
   * Several ways may start the same chapter (one line). Loading a save or a flowchart jump sets
   * it again without the toast.
   */
  chapter: (id: ChapterId) => void
}

/** When a hidden choice option shows (every condition given must be met). */
export interface HiddenOption {
  /**
   * Every one of these endings (src/content/endings/<id>) was reached, in any playthrough: by a
   * route's `return ending('anna')` or an event's ending('anna').
   */
  requiresEnding?: EndingId[]
  /** This flag is on. */
  requiredFlag?: BooleanFlagId
}

export interface RouteConfig {
  /** Shown on the flowchart's tab and on the box that leads into this route. */
  title: string
  /** Shown in the flowchart's side panel when that box is picked. */
  description?: string
  /** Picture for the box that leads into this route, and its tab (an imported image). */
  image?: string
  /** CSS colour for this route's tab and the boxes leading into it. */
  color?: string
  /**
   * Makes this route an after story (VN mode only): not part of the main story, started from the
   * title screen's "After Stories" once its endings are reached. It starts from a fresh game and
   * gets its own group of tabs on the flowchart (with the routes it moves on to).
   */
  afterStory?: AfterStoryConfig
  /**
   * The story in order: `await event(...)`, `if (flag(...))`, `return startRoute(...)`.
   * Typed as returning `unknown` (the engine awaits it).
   */
  run: (ctx: RouteContext) => unknown
}

export function defineRoute(config: RouteConfig): RouteConfig {
  return config
}

/** An after story's rules (RouteConfig.afterStory). */
export interface AfterStoryConfig {
  /**
   * Every one of these endings (src/content/endings/<id>) was reached, in any playthrough. Until
   * then it is locked. Leave empty for one that is open from the start.
   */
  requiresEnding: EndingId[]
  /** Lower comes first in the list. Default: folder order. */
  order?: number
}

/** One after story, as the selection screen gets it (title, picture… are the route's own). */
export interface AfterStoryInfo {
  id: RouteId
  title: string
  description?: string
  image?: string
  color?: string
  requiresEnding: EndingId[]
  /** Its first box was reached once (in any playthrough). */
  played: boolean
}

/**
 * What game.routes.afterStories() gives: the screen that lists them (src/content/start.ts passes it
 * to a minigame) shows `available` and `locked`, and calls `launch(id)` for the picked one.
 */
export interface AfterStoryMenu {
  available: AfterStoryInfo[]
  locked: AfterStoryInfo[]
  /**
   * Starts that after story (a fresh game), ending the minigame that called it with the route id
   * as its result. Only an available id starts.
   */
  launch: (id: RouteId) => void
}

/** One box of a route's flowchart, as written in flow.ts. Everything is optional. */
export interface FlowNodeConfig {
  /** Default: the event's title. */
  title?: string
  /** Shown in the side panel when the box is picked (before the player loads it). */
  description?: string
  /** Picture in the box and the side panel (an imported image). */
  image?: string
  /**
   * Flowchart jumps only: what this event LEAVES BEHIND (flags, items, points), run instead of
   * playing it when the player loads a box further down. Flags the route asks with flag() on the
   * way are set by themselves; write the rest here. Never runs in normal play.
   */
  sets?: (game: Game) => void
  /**
   * Flowchart jumps only: what this event EXPECTS to find, run just before it starts when the
   * player loads this very box (things no box before it gives).
   */
  before?: (game: Game) => void
  /** Hide the box (and its lines) from the chart: for a path the code allows but the story can't take. */
  hidden?: boolean
  /** A part name from src/content/look/parts.ts, added on top of the normal box look. */
  look?: string
  // Fixing the chart by hand. Every one is optional: left out, the chart lays itself out as usual.
  // They work on event boxes, choice boxes ('?key') and flag diamonds ('!key', see FlowKey). Turn
  // on `debug` in src/content/config/flowchart.ts to see the keys, rows, columns and px.
  /**
   * Move the box from where the chart puts it, px (x: + right, y: + down). Its lines follow;
   * other boxes stay where they are.
   */
  shift?: { x?: number; y?: number }
  /** Put the box in this column of the debug grid (0 = the chart's first box; may be negative). Others make room. */
  column?: number
  /** Put the box in this row (0 = top) or lower; never above the boxes leading to it. Boxes after it move down too. */
  row?: number
  /** Its place in its row, left to right (0 = first). Boxes without one keep their place. */
  order?: number
  /** Keep the box in the same column as this other box (in another row). */
  align?: string
  /** Event and choice boxes: move every diamond right after this box, px. */
  branchShift?: { x?: number; y?: number }
  /** The side the "yes" way leaves its diamond (this diamond, or the diamonds right after this box). */
  branchSide?: 'left' | 'right'
  /**
   * The lines leaving this box (or its diamonds), by the key of the box (or diamond) they go to.
   * '@end' = the end box, '@route:<id>' = a route box.
   */
  lines?: Partial<Record<string, FlowLineConfig>>
}

/** Fixing one line of the chart by hand (flow.ts `lines`). Every field is optional. */
export interface FlowLineConfig {
  /** Move the part that runs across up (-) or down (+), px. */
  bend?: number
  /** Go through these points (px on the chart, see `debug`) instead of the automatic way. */
  via?: [number, number][]
  /** Where it leaves / enters: px from the middle of the box (- left, + right). */
  start?: number
  end?: number
  /**
   * Which edge of the box it goes into: 'top', or past the top and into the 'left' / 'right' side.
   * Unset = automatic (a box with several lines coming in takes the ones from far off at its sides).
   */
  enter?: 'top' | 'left' | 'right'
  /** Don't draw it. */
  hide?: boolean
  /** Text on the line (shown once the box it leads to is reached); null = none, even for a choice. */
  label?: string | null
  /** Move the text, px. */
  labelShift?: { x?: number; y?: number }
  /** Colour / width / dashes for this line (on top of its normal, locked or path look). */
  look?: { color?: string; width?: number; dash?: [number, number] }
  /**
   * true = the straight line out of its diamond (instead of "no"; the other way then leaves from
   * the side). On a line out of a box: keep the box it goes to right under it. false = not straight.
   */
  straight?: boolean
}

/**
 * Keys flow.ts can set besides the route's event boxes: choice boxes ('?' + option keys, or
 * '?' + the choice's key) and flag diamonds ('!' + the box before it, e.g. '!jack_story';
 * '!box:false' / '!box:true' for one further on after a "no" / "yes").
 */
export type FlowKey = `?${string}` | `!${string}`

export interface FlowDefinition {
  route: RouteId
  nodes: Partial<Record<string, FlowNodeConfig>>
}

/** src/content/routes/<route>/flow.ts: the boxes' titles, descriptions, pictures and jump helpers. */
export function defineFlow<R extends RouteId>(
  route: R,
  nodes: { [K in RouteKeyOf<R>]?: FlowNodeConfig } & { [K in FlowKey]?: FlowNodeConfig },
): FlowDefinition {
  return { route, nodes: nodes as FlowDefinition['nodes'] }
}
