// Types for src/content/config/flowchart.ts (how the VN flowchart is drawn). The box looks are parts in
// src/content/look/parts.ts (flowNode…); this is lines, sizes and wording. Must not import content.

export interface FlowchartLine {
  /** CSS colour. */
  color: string
  /** px. */
  width: number
  /** Dashes: [dash, gap] px; none = solid. */
  dash?: [number, number]
}

/** Where a picture goes beside the title (flowchart boxes and route tabs), or 'none' (not shown). */
export type FlowImageAt = 'left' | 'right' | 'top' | 'bottom' | 'none'

/** The flex direction that puts the picture (first child) at `at`, the title after it. */
export function flowImageDirection(
  at: FlowImageAt,
): 'row' | 'row-reverse' | 'column' | 'column-reverse' {
  if (at === 'right') return 'row-reverse'
  if (at === 'top') return 'column'
  if (at === 'bottom') return 'column-reverse'
  return 'row'
}

export interface FlowchartConfig {
  /** Boxes, px (the chart scrolls when it is bigger than the window). */
  node: {
    width: number
    height: number
    gapX: number
    gapY: number
    /** Where a box's picture (flow.ts `image`) goes beside its title, or 'none'. */
    image: FlowImageAt
  }
  /** How lines bend: right angles with round corners, sharp right angles, curves, or straight. */
  shape: 'rounded' | 'elbow' | 'curve' | 'straight'
  /** Corner radius for 'rounded' lines, px. */
  corner: number
  /**
   * Where a line runs across another, it hops over it with a small arc of this radius, px, so a
   * crossing never looks like a join ('rounded' and 'elbow' lines). null or 0 = no hops. Default 5.
   */
  hops?: number | null
  /**
   * flag() / check() in a route drawn as a diamond (not a choice: the way depends on a flag or an
   * earlier choice). The "no" way runs straight down through it; the "yes" way leaves from its
   * `side` and turns down into its own box. `size` in px. null = no diamonds (lines split at the box).
   */
  branch: { size: number; side: 'left' | 'right' } | null
  /** Least space between lines running side by side, px (also what a line passing a row takes). */
  lineGap: number
  /**
   * Lines running across between the same two rows get their own heights (lanes) so they never lie
   * on top of each other; the space between those rows grows when they need more room.
   */
  autoFix: boolean
  /** Space between two rows whose lines all run straight down, px (null = gapY, like all rows). */
  compact: number | null
  /** Where a line's text sits on its first stretch: by the box it leaves, halfway, or by the box it reaches. */
  labels: 'start' | 'middle' | 'end'
  /** Developers (dev builds only): draws the rows, columns, px and every box and diamond key. */
  debug: boolean
  /**
   * Chapters started in a route (chapter('id')): one line per chapter NUMBER across the chart, with
   * "Chapter 1" above it (sub chapters 1.1, 1.2 never add a line; saves show them). Boxes played
   * after it are always below it. `header` = room it takes between two rows, px. null = no chapter
   * lines (and boxes are placed as if there were none).
   */
  chapters: {
    header: number
    size: number
    color: string
    line: FlowchartLine
  } | null
  /** A small arrow where a line meets the box below. */
  arrows: boolean
  /** Normal lines. */
  line: FlowchartLine
  /** The lines of the way that would load (start -> selected box). */
  pathLine: FlowchartLine
  /** Lines into boxes the player has not reached. */
  lockedLine: FlowchartLine
  /**
   * Boxes not reached yet: 'hidden' = invisible (they keep their place, so the chart doesn't jump
   * around, but nothing of the future shows, not even how many endings there are); 'locked' =
   * shown as "???" with `lockedLine` lines.
   */
  unseen: 'hidden' | 'locked'
  /** The option text on lines picked with a choice (shown once the box it leads to is reached). */
  choiceLabel: { color: string; size: number; outline: string } | null
  /** Text on boxes. `locked` shows on boxes not reached yet; `end` on the box where the story ends. */
  text: {
    locked: string
    end: string
    /** A choice box without a question. */
    choice: string
    load: string
    loadQuestion: string
    cannotLoad: string
    /** A reached box whose every way goes through a dotted line (a choice option never picked live). */
    noWay: string
    /** Heading over the main story's route tabs (null = none). */
    routes: string | null
    /** Heading over the after stories' tabs, under the line (null = only the line). */
    afterStories: string | null
  }
  /** The side panel: share of the window's width (0..1), and which side. */
  panel: { width: number; side: 'left' | 'right' }
  /** The route tabs: which side, and whether they show the route's picture. */
  tabs: { side: 'left' | 'right'; image: FlowImageAt }
  /** Height of the window's inside, as a share of the game screen's height (0..1). */
  height: number
}

export function defineFlowchart(config: FlowchartConfig): FlowchartConfig {
  return config
}
