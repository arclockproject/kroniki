// Places a route's flowchart boxes: one row per step (top to bottom), lines that skip rows get
// place holders so they never run through a box, rows are ordered to cross few lines, and each
// box sits under the boxes that lead to it. flag() / check() diamonds (chart.ts) keep their "no"
// way in a straight column; the "yes" line leaves from the diamond's side. flow.ts can fix it by
// hand (FlowNodeConfig: shift, column, row, order, align, branchShift, branchSide, lines); with
// none of those the automatic layout is used as it is. Pure: no React, no DOM.
import type { FlowLineConfig, FlowNodeConfig } from '../defs/routes'
import { type ChartGraph, type ChartOptions, chartGraph } from './chart'
import { type RouteGraph, START } from './graph'

/** Space between the points where several lines leave or enter one box (px). */
const PORT_GAP = 28

export interface LayoutSizes {
  /** Box size and the space between boxes, px. */
  width: number
  height: number
  gapX: number
  gapY: number
}

export interface LayoutOptions extends ChartOptions {
  /** Diamond size (px, both ways). Default 28. */
  branchSize?: number
  /** flow.ts settings by box / diamond key (only the layout ones are read). */
  nodes?: Readonly<Partial<Record<string, FlowNodeConfig>>>
  /** Least space between side-by-side lines, px. Default 16. */
  lineGap?: number
  /** Give lines running across between two rows their own heights. */
  autoFix?: boolean
  /** Gap between rows whose lines all go straight down (null = gapY). */
  compact?: number | null
  /**
   * Chapters: the story order of the chapter a box is entered in (bigger = later), or undefined
   * before any. Every box of a later chapter goes below the chapter's line; earlier ones above it.
   */
  chapterRank?: (key: string) => number | undefined
  /** Room for a chapter's number and line between two rows, px. Default 28. */
  chapterHeader?: number
}

/** A chapter's line: `rank` from chapterRank; its header fills top .. top + height (the line at the bottom). */
export interface LaidChapter {
  rank: number
  top: number
  height: number
}

export interface LaidBox {
  /** A box key, or a diamond key (chart.branches). */
  key: string
  x: number
  y: number
  width: number
  height: number
}

export interface LaidLine {
  from: string
  to: string
  /** From the bottom middle of `from` to the top middle of `to`, through the place holders. */
  points: [number, number][]
  /** Starts at the side corner of a diamond: the first stretch goes across, then down. */
  side?: boolean
  /** Ends on the side of its box: the last stretch goes down, then across into it. */
  sideEnd?: boolean
  /** For each stretch: the height of the part that runs across (null = halfway). */
  bends?: (number | null)[]
}

export interface Layout {
  width: number
  height: number
  boxes: LaidBox[]
  lines: LaidLine[]
  /** What was laid out: diamonds and what each line stands for. */
  chart: ChartGraph
  /** One per chapter that starts in this chart, top to bottom. */
  chapters: LaidChapter[]
  /** For the debug view and flow.ts `column` / `row`: column 0's middle, column width, rows. */
  grid: { origin: number; step: number; rows: { top: number; height: number }[] }
}

/** Row of each box: the longest way to it from the start, or lower when flow.ts asks. */
function rows(
  keys: string[],
  edges: { from: string; to: string }[],
  pin: (key: string) => number | undefined,
): Map<string, number> {
  const row = new Map<string, number>([[START, -1]])
  const into = new Map<string, string[]>()
  for (const e of edges) into.set(e.to, [...(into.get(e.to) ?? []), e.from])
  const visit = (key: string, depth: number): number => {
    const known = row.get(key)
    if (known !== undefined) return known
    if (depth > keys.length) return 0 // a loop (the graph builder refuses those): give up quietly
    const parents = into.get(key) ?? []
    const r = parents.length ? Math.max(...parents.map((p) => visit(p, depth + 1))) + 1 : 0
    const at = Math.max(r, Math.floor(pin(key) ?? 0))
    row.set(key, at)
    return at
  }
  for (const key of keys) visit(key, 0)
  return row
}

/**
 * Lays out the graph without its hidden boxes. Without `branchSide` there are no diamonds and the
 * line taken on a true answer goes left (if-blocks read left to right as "yes, no").
 */
export function layoutGraph(
  graph: RouteGraph,
  sizes: LayoutSizes,
  hidden: ReadonlySet<string> = new Set(),
  options: Omit<LayoutOptions, 'hidden'> = {},
): Layout {
  const chart = chartGraph(graph, { ...options, hidden })
  const cfg = options.nodes ?? {}
  const diamond = options.branchSize ?? 28
  const lineGap = options.lineGap ?? 16
  const keys = chart.keys.filter((k) => k !== START)
  const shown = new Set(keys)
  const isBranch = (k: string) => k in chart.branches
  const ownerOf = (k: string) => chart.branches[k]?.owner ?? k
  /** A line's flow.ts settings: on the box (or diamond) it leaves, else on the diamond's box. */
  const lineCfg = (from: string, to: string): FlowLineConfig | undefined =>
    cfg[from]?.lines?.[to] ?? (isBranch(from) ? cfg[ownerOf(from)]?.lines?.[to] : undefined)
  const branchSide = (k: string) =>
    cfg[k]?.branchSide ?? cfg[ownerOf(k)]?.branchSide ?? options.branchSide ?? 'right'

  const edges = chart.edges
    .filter((e) => (e.from === START || shown.has(e.from)) && shown.has(e.to))
    .filter((e) => !lineCfg(e.from, e.to)?.hide)
    .map((e) => ({ ...e }))
  for (const e of edges) {
    // The "yes" way of a diamond goes to its side (flow.ts branchSide).
    if (isBranch(e.from) && e.values[0] === true) e.order = branchSide(e.from) === 'left' ? 0 : 2
  }
  for (const e of edges) {
    const straight = lineCfg(e.from, e.to)?.straight
    if (straight === undefined) continue
    if (isBranch(e.from) && straight) {
      // This way is the straight one; the diamond's other way leaves from the side.
      for (const o of edges) {
        if (o.from === e.from && o !== e) {
          o.straight = false
          o.side = true
        }
      }
      e.side = false
    }
    e.straight = straight
  }
  edges.sort((a, b) => a.order - b.order)
  // Chapters: a box of a later chapter is never in a row with (or above) a box of an earlier one,
  // so one straight line can split them. Raising a box's lowest row moves the boxes after it too,
  // so this repeats until nothing moves (a few times at most).
  const rankOf = (k: string) => options.chapterRank?.(ownerOf(k))
  const ranks = [...new Set(keys.map(rankOf).filter((r): r is number => r !== undefined))].sort(
    (a, b) => a - b,
  )
  const lowest = new Map<string, number>()
  const rowsNow = () => rows(keys, edges, (k) => Math.max(cfg[k]?.row ?? 0, lowest.get(k) ?? 0))
  let row = rowsNow()
  const boundary = (rank: number) => {
    const before = keys.filter((k) => (rankOf(k) ?? -1) < rank).map((k) => row.get(k) ?? 0)
    return before.length ? Math.max(...before) + 1 : 0
  }
  for (let round = 0; round <= ranks.length + 1; round++) {
    let moved = false
    for (const rank of ranks) {
      const b = boundary(rank)
      for (const k of keys) {
        if ((rankOf(k) ?? -1) >= rank && (row.get(k) ?? 0) < b && (lowest.get(k) ?? 0) < b) {
          lowest.set(k, b)
          moved = true
        }
      }
    }
    if (!moved) break
    row = rowsNow()
  }
  /** Chapter rank -> the first row below its line. */
  const chapterRow = new Map(ranks.map((rank) => [rank, boundary(rank)]))
  const header = options.chapterHeader ?? 28
  /** Gaps (by the row above them; -1 = above the first row) that hold a chapter header. */
  const headerGaps = new Set([...chapterRow.values()].map((r) => r - 1))
  const headerAfter = (r: number) => (headerGaps.has(r) ? header : 0)

  // Place holders on every row a line skips (not for lines with their own `via` points).
  const holders: { key: string; row: number }[] = []
  type Chain = { from: string; to: string; via: string[]; edge: (typeof edges)[number] }
  const chains: Chain[] = []
  for (const e of edges) {
    if (e.from === START) continue
    const a = row.get(e.from) as number
    const b = row.get(e.to) as number
    const via: string[] = []
    if (!lineCfg(e.from, e.to)?.via) {
      for (let r = a + 1; r < b; r++) {
        const key = `${e.from}>${e.to}#${r}`
        holders.push({ key, row: r })
        row.set(key, r)
        via.push(key)
      }
    }
    chains.push({ from: e.from, to: e.to, via, edge: e })
  }
  // Links between neighbouring rows (through place holders). Straight links (into a diamond, and
  // the "no" way through it) keep both ends in one column.
  const up = new Map<string, string[]>()
  const down = new Map<string, string[]>()
  const straightUp = new Map<string, string>()
  const straightDown = new Map<string, string>()
  /** How many straight lines come into each box (2+ = a join: no single column to stay in). */
  const straightIn = new Map<string, number>()
  const link = (a: string, b: string, straight: boolean) => {
    down.set(a, [...(down.get(a) ?? []), b])
    up.set(b, [...(up.get(b) ?? []), a])
    if (straight) {
      if (!straightDown.has(a)) straightDown.set(a, b)
      if (!straightUp.has(b)) straightUp.set(b, a)
      straightIn.set(b, (straightIn.get(b) ?? 0) + 1)
    }
  }
  for (const c of chains) {
    const path = [c.from, ...c.via, c.to]
    for (let i = 0; i + 1 < path.length; i++)
      link(path[i] as string, path[i + 1] as string, c.edge.straight)
  }

  // Rows in first-seen order (following lines from the top, left lines first), then a few sweeps
  // that sort each row by where its neighbours are (fewer crossings).
  const count = Math.max(0, ...[...row.values()]) + 1
  const byRow: string[][] = Array.from({ length: count }, () => [])
  const placed = new Set<string>()
  const place = (key: string) => {
    if (placed.has(key)) return
    placed.add(key)
    byRow[row.get(key) as number]?.push(key)
    for (const child of down.get(key) ?? []) place(child)
  }
  for (const e of edges) if (e.from === START) place(e.to)
  for (const key of [...keys, ...holders.map((h) => h.key)]) place(key)

  const index = new Map<string, number>()
  const reindex = () => {
    for (const r of byRow) for (const [i, k] of r.entries()) index.set(k, i)
  }
  reindex()
  const centre = (list: string[] | undefined, fallback: number) =>
    list?.length ? list.reduce((s, k) => s + (index.get(k) ?? 0), 0) / list.length : fallback
  for (let sweep = 0; sweep < 4; sweep++) {
    const downward = sweep % 2 === 0
    const order = downward ? byRow : [...byRow].reverse()
    for (const r of order) {
      const weight = new Map(
        r.map((k) => [k, centre(downward ? up.get(k) : down.get(k), index.get(k) ?? 0)]),
      )
      r.sort((a, b) => (weight.get(a) as number) - (weight.get(b) as number))
      for (const [i, k] of r.entries()) index.set(k, i)
    }
  }
  // flow.ts `order`: its place in the row (the others keep theirs).
  for (const r of byRow) {
    if (!r.some((k) => cfg[k]?.order !== undefined)) continue
    const weight = new Map(r.map((k, i) => [k, cfg[k]?.order ?? i]))
    r.sort((a, b) => (weight.get(a) as number) - (weight.get(b) as number))
  }
  reindex()

  // x (centres): alternate "under the boxes leading here" (down) and "over the boxes it leads to"
  // (up), so a box sits in the middle of its branches. Anchored boxes win (flow.ts column, then
  // align, then a straight line): the row moves so the strongest one is exactly in place.
  const holderSet = new Set(holders.map((h) => h.key))
  const widthOf = (k: string) => (holderSet.has(k) ? lineGap : isBranch(k) ? diamond : sizes.width)
  const heightOf = (k: string) => (holderSet.has(k) ? 0 : isBranch(k) ? diamond : sizes.height)
  const half = (k: string) => widthOf(k) / 2
  const gap = (a: string, b: string) => half(a) + half(b) + sizes.gapX
  const step = sizes.width + sizes.gapX
  const origin = byRow[0]?.[0]
  const x = new Map<string, number>()
  for (const r of byRow) {
    let at = 0
    r.forEach((k, i) => {
      if (i > 0) at += gap(r[i - 1] as string, k)
      x.set(k, at)
    })
  }
  const mean = (list: string[] | undefined) =>
    list?.length ? list.reduce((s, k) => s + (x.get(k) as number), 0) / list.length : null
  // A box where ways join again goes back under the box where they split (the lowest box every
  // way into it passes), not halfway between its parents or under the first of several straight
  // lines: else every join is pulled off to one side, and a long chart drifts sideways.
  const ancestors = new Map<string, Set<string>>()
  const ancestorsOf = (k: string): Set<string> => {
    const known = ancestors.get(k)
    if (known) return known
    const set = new Set([k])
    ancestors.set(k, set)
    for (const p of up.get(k) ?? []) for (const a of ancestorsOf(p)) set.add(a)
    return set
  }
  const splitOf = new Map<string, string>()
  for (const k of row.keys()) {
    const parents = up.get(k) ?? []
    if (parents.length < 2) continue
    const [first, ...rest] = parents.map(ancestorsOf)
    let best: string | undefined
    for (const a of first ?? []) {
      if (!rest.every((s) => s.has(a))) continue
      if (best === undefined || (row.get(a) ?? 0) > (row.get(best) ?? 0)) best = a
    }
    if (best !== undefined) splitOf.set(k, best)
  }
  const pinned = (k: string) => k !== origin && cfg[k]?.column !== undefined
  /** Where an anchored box must be, and how strong the anchor is (0 = none). A join (1.5) beats a
   * straight line passing through its row, so that line goes around it. */
  const anchor = (k: string, downward: boolean): [number, number] | null => {
    const column = cfg[k]?.column
    if (pinned(k) && origin && column !== undefined)
      return [(x.get(origin) as number) + column * step, 3]
    const align = cfg[k]?.align
    if (align && x.has(align) && row.get(align) !== row.get(k)) return [x.get(align) as number, 2]
    const split = splitOf.get(k)
    if (downward && split !== undefined && straightIn.get(k) !== 1)
      return [x.get(split) as number, 1.5]
    const s = (downward ? straightUp : straightDown).get(k)
    return s !== undefined ? [x.get(s) as number, 1] : null
  }
  const settle = (r: string[], downward: boolean) => {
    if (r.length === 0) return
    const anchors = r.map((k) => anchor(k, downward))
    const want = r.map(
      (k, i) => anchors[i]?.[0] ?? mean((downward ? up : down).get(k)) ?? (x.get(k) as number),
    )
    // Pushed right from the left, and pushed left from the right; the mean keeps both spacings.
    const fromLeft = [...want]
    for (let i = 1; i < r.length; i++) {
      const min = (fromLeft[i - 1] as number) + gap(r[i - 1] as string, r[i] as string)
      fromLeft[i] = Math.max(fromLeft[i] as number, min)
    }
    const fromRight = [...want]
    for (let i = r.length - 2; i >= 0; i--) {
      const max = (fromRight[i + 1] as number) - gap(r[i] as string, r[i + 1] as string)
      fromRight[i] = Math.min(fromRight[i] as number, max)
    }
    r.forEach((k, i) => {
      x.set(k, ((fromLeft[i] as number) + (fromRight[i] as number)) / 2)
    })
    let best = -1
    anchors.forEach((a, i) => {
      if (a && (best < 0 || a[1] > (anchors[best]?.[1] ?? 0))) best = i
    })
    if (best >= 0) {
      // The strongest anchor is exactly in place; the others go as near to where they want to be
      // as it lets them (not the whole row moved with it: that took straight lines out of line).
      x.set(r[best] as string, want[best] as number)
      for (let j = best + 1; j < r.length; j++) {
        const min = (x.get(r[j - 1] as string) as number) + gap(r[j - 1] as string, r[j] as string)
        x.set(r[j] as string, Math.max(want[j] as number, min))
      }
      for (let j = best - 1; j >= 0; j--) {
        const max = (x.get(r[j + 1] as string) as number) - gap(r[j] as string, r[j + 1] as string)
        x.set(r[j] as string, Math.min(want[j] as number, max))
      }
    }
    // Other column pins in the row: exactly in place too, pushing their neighbours aside.
    anchors.forEach((a, i) => {
      if (i === best || a?.[1] !== 3) return
      x.set(r[i] as string, a[0])
      for (let j = i + 1; j < r.length; j++) {
        const min = (x.get(r[j - 1] as string) as number) + gap(r[j - 1] as string, r[j] as string)
        x.set(r[j] as string, Math.max(x.get(r[j] as string) as number, min))
      }
      for (let j = i - 1; j >= 0; j--) {
        const max = (x.get(r[j + 1] as string) as number) - gap(r[j] as string, r[j + 1] as string)
        x.set(r[j] as string, Math.min(x.get(r[j] as string) as number, max))
      }
    })
  }
  for (let pass = 0; pass < 8; pass++) {
    if (pass % 2 === 0) for (const r of byRow) settle(r, true)
    else for (const r of [...byRow].reverse()) settle(r, false)
  }
  // End on a downward pass, so straight columns are exact.
  for (const r of byRow) settle(r, true)

  // Hand-made moves (flow.ts shift / branchShift) come last, so nothing else moves with them.
  const shiftOf = (k: string) =>
    cfg[k]?.shift ?? (isBranch(k) ? cfg[ownerOf(k)]?.branchShift : undefined)
  for (const k of keys) {
    const dx = shiftOf(k)?.x
    if (dx) x.set(k, (x.get(k) as number) + dx)
  }
  const left = Math.min(...[...x].map(([k, v]) => v - half(k)))
  for (const [k, v] of x) x.set(k, v - left)

  // A diamond's line leaves from a side corner when its first step is off to that side (one line
  // per corner: the one going furthest; the others leave from the bottom tip). Corner lines run
  // across at the diamond's height, so two in one row must not overlap: the shortest goes first,
  // and a later one that would run into it turns down early and enters its box from the side
  // (when it goes straight into a box on the next row), else it leaves from the bottom tip.
  const firstStep = (c: Chain) => x.get(c.via[0] ?? c.to) as number
  const sideStart = new Set<Chain>()
  /** Corner lines that turn down early: where they turn. */
  const turnAt = new Map<Chain, number>()
  const corners: Chain[] = []
  for (const k of keys) {
    if (!isBranch(k)) continue
    const middle = x.get(k) as number
    for (const s of [-1, 1]) {
      let far: Chain | undefined
      for (const c of chains) {
        if (c.from !== k || lineCfg(c.from, c.to)?.via) continue
        const d = (firstStep(c) - middle) * s
        if (d > half(k) && (!far || d > (firstStep(far) - middle) * s)) far = c
      }
      if (far) corners.push(far)
    }
  }
  const reach = (c: Chain) => Math.abs(firstStep(c) - (x.get(c.from) as number))
  corners.sort((a, b) => reach(a) - reach(b))
  const taken: { row: number; lo: number; hi: number }[] = []
  /** Something (another corner line, a box, a passing line) in the way on row r, between lo and hi. */
  const runBlocked = (r: number, lo: number, hi: number, self: string) =>
    taken.some((t) => t.row === r && t.lo < hi + lineGap && lo < t.hi + lineGap) ||
    (byRow[r] ?? []).some(
      (k) =>
        k !== self && (x.get(k) as number) + half(k) > lo && (x.get(k) as number) - half(k) < hi,
    )
  for (const c of corners) {
    const r = row.get(c.from) as number
    const from = x.get(c.from) as number
    const to = firstStep(c)
    const s = Math.sign(to - from)
    const out = from + s * half(c.from)
    if (!runBlocked(r, Math.min(out, to), Math.max(out, to), c.from)) {
      sideStart.add(c)
      taken.push({ row: r, lo: Math.min(from, to), hi: Math.max(from, to) })
      continue
    }
    const own = lineCfg(c.from, c.to)
    if (c.via.length || isBranch(c.to) || own?.end !== undefined || own?.enter === 'top') continue
    // Turn down as near its box as it can, clear of the box's row and of other corner lines.
    const edge = to - s * half(c.to)
    const targetRow = byRow[row.get(c.to) as number] ?? []
    const clear = (at: number) =>
      !targetRow.some((k) => Math.abs((x.get(k) as number) - at) < half(k) + lineGap / 2)
    for (let at = edge - s * lineGap; (at - out) * s >= lineGap / 2; at -= s * 4) {
      if (!clear(at) || runBlocked(r, Math.min(out, at), Math.max(out, at), c.from)) continue
      sideStart.add(c)
      turnAt.set(c, at)
      taken.push({ row: r, lo: Math.min(from, at), hi: Math.max(from, at) })
      break
    }
  }
  const fromSide = (c: Chain) => sideStart.has(c)
  /** Where a line comes down for the last time (its turn, its last place holder, or its box). */
  const lastStep = (c: Chain) => turnAt.get(c) ?? (x.get(c.via.at(-1) ?? c.from) as number)

  // Ports: several lines leaving (or entering) one box use their own points along its edge, in
  // the order of where they go (or come from), so they never run on top of each other.
  const port = (list: Chain[], c: Chain, middle: number, width: number) => {
    if (list.length < 2) return middle
    const i = list.indexOf(c)
    const spread = Math.min(width * 0.6, (list.length - 1) * PORT_GAP)
    return middle - spread / 2 + (spread * i) / (list.length - 1)
  }
  const outOf = new Map<string, Chain[]>()
  const into = new Map<string, Chain[]>()
  for (const c of chains) {
    if (!fromSide(c)) outOf.set(c.from, [...(outOf.get(c.from) ?? []), c])
    into.set(c.to, [...(into.get(c.to) ?? []), c])
  }
  // A box that several lines come into: a line coming down from well off to one side goes on
  // past the top and enters the box's side (nearest line highest, so they never cross), when
  // nothing in the box's row is in its way. Fewer lines crowd its top edge. flow.ts `enter` on a
  // line decides by hand ('top', 'left', 'right').
  /** Side entries: chain -> how far down the box's side (0..1). */
  const sideEnd = new Map<Chain, number>()
  /** Which side a side entry goes into (-1 left, 1 right). */
  const sideOf = new Map<Chain, number>()
  for (const [to, list] of into) {
    if (isBranch(to)) continue
    const middle = x.get(to) as number
    const inRow = byRow[row.get(to) as number] ?? []
    for (const s of [-1, 1]) {
      const fit = list.filter((c) => {
        if (turnAt.has(c)) return (lastStep(c) - middle) * s > 0
        const own = lineCfg(c.from, c.to)
        if (own?.via || own?.end !== undefined || (fromSide(c) && c.via.length === 0)) return false
        if (own?.enter === 'top') return false
        if (own?.enter) return (own.enter === 'left' ? -1 : 1) === s
        if (list.length < 2) return false
        const at = lastStep(c)
        if ((at - middle) * s <= half(to) + lineGap / 2) return false
        const lo = Math.min(at, middle) - lineGap / 2
        const hi = Math.max(at, middle) + lineGap / 2
        return !inRow.some(
          (k) =>
            k !== to && (x.get(k) as number) + half(k) > lo && (x.get(k) as number) - half(k) < hi,
        )
      })
      fit.sort((a, b) => (lastStep(a) - middle) * s - (lastStep(b) - middle) * s)
      fit.forEach((c, i) => {
        sideEnd.set(c, (i + 1) / (fit.length + 1))
        sideOf.set(c, s)
      })
    }
  }
  for (const [to, list] of into)
    into.set(
      to,
      list.filter((c) => !sideEnd.has(c)),
    )
  for (const list of outOf.values()) list.sort((a, b) => firstStep(a) - firstStep(b))
  for (const list of into.values()) list.sort((a, b) => lastStep(a) - lastStep(b))
  const startX = (c: Chain) => {
    const middle = x.get(c.from) ?? 0
    const own = lineCfg(c.from, c.to)?.start
    if (own !== undefined) return middle + own
    if (fromSide(c)) return middle + Math.sign(firstStep(c) - middle) * half(c.from)
    return port(outOf.get(c.from) ?? [], c, middle, widthOf(c.from))
  }
  // A straight line ("no" through a diamond) enters at the middle; the others keep their spacing
  // around it (inside the box).
  const endX = (c: Chain) => {
    const middle = x.get(c.to) ?? 0
    const own = lineCfg(c.from, c.to)?.end
    if (own !== undefined) return middle + own
    const side = sideOf.get(c)
    if (side !== undefined) return middle + side * half(c.to)
    const list = into.get(c.to) ?? []
    const w = widthOf(c.to)
    const s = list.find((l) => l.edge.straight)
    const shift = s ? middle - port(list, s, middle, w) : 0
    const room = Math.max(0, w / 2 - 8)
    return Math.min(middle + room, Math.max(middle - room, port(list, c, middle, w) + shift))
  }

  // Stretches between rows, and which ones run across (they need a height of their own).
  const xs = chains.map((c) => [startX(c), ...c.via.map((h) => x.get(h) ?? 0), endX(c)])
  /** stretch -> its lane in the gap above its lower end (autoFix). */
  const lanes = new Map<string, number>()
  const runs: { id: string; from: string; gap: number; a: number; b: number }[] = []
  chains.forEach((c, ci) => {
    if (lineCfg(c.from, c.to)?.via) return
    const pts = xs[ci] as number[]
    const rowsOf = [row.get(c.from) as number, ...c.via.map((h) => row.get(h) as number)]
    for (let i = 0; i + 1 < pts.length; i++) {
      if (i === 0 && fromSide(c)) continue
      if (i === pts.length - 2 && sideEnd.has(c)) continue
      const a = pts[i] as number
      const b = pts[i + 1] as number
      if (Math.abs(a - b) < 0.5) continue
      runs.push({
        id: `${ci}:${i}`,
        from: i === 0 ? c.from : `${c.from}>${c.to}`,
        gap: rowsOf[i] as number,
        a: Math.min(a, b),
        b: Math.max(a, b),
      })
    }
  })
  const laneCount = new Map<number, number>()
  if (options.autoFix) {
    const byGap = new Map<number, typeof runs>()
    for (const r of runs) byGap.set(r.gap, [...(byGap.get(r.gap) ?? []), r])
    for (const [g, list] of byGap) {
      // Greedy: each run takes the first lane free at its left end. Runs leaving the same box never
      // share one (their texts sit near that box and would run into each other).
      list.sort((p, q) => p.a - q.a)
      const ends: number[] = []
      const owners: Set<string>[] = []
      for (const r of list) {
        let lane = ends.findIndex((end, i) => end + lineGap <= r.a && !owners[i]?.has(r.from))
        if (lane < 0) lane = ends.length
        const owned = owners[lane] ?? new Set<string>()
        owned.add(r.from)
        owners[lane] = owned
        ends[lane] = r.b
        lanes.set(r.id, lane)
      }
      laneCount.set(g, ends.length)
    }
  }
  const hasRun = new Set(runs.map((r) => r.gap))
  /** The space for lines between row r and the next (a chapter header comes on top of it). */
  const linesGap = (r: number) => {
    const base = options.compact != null && !hasRun.has(r) ? options.compact : sizes.gapY
    const n = laneCount.get(r) ?? 0
    return n > 1 ? Math.max(base, (n + 1) * lineGap) : base
  }
  const gapAfter = (r: number) => linesGap(r) + headerAfter(r)

  // Rows are as tall as their tallest box (a row of diamonds is short).
  const rowHeight = byRow.map((r) => Math.max(0, ...r.map(heightOf)) || diamond)
  const rowTop: number[] = []
  let top = headerAfter(-1)
  rowHeight.forEach((h, r) => {
    rowTop.push(top)
    top += h + gapAfter(r)
  })
  const bottom = top - (count ? gapAfter(count - 1) : 0)
  const placeY = (k: string) => {
    const r = row.get(k) ?? 0
    return (rowTop[r] ?? 0) + ((rowHeight[r] ?? 0) - heightOf(k)) / 2 + (shiftOf(k)?.y ?? 0)
  }
  // A box moved above the top pushes the whole chart down.
  const above = Math.min(0, ...keys.map(placeY))
  const yOf = (k: string) => placeY(k) - above
  const boxes = keys.map((key) => ({
    key,
    x: (x.get(key) ?? 0) - widthOf(key) / 2,
    y: yOf(key),
    width: widthOf(key),
    height: heightOf(key),
  }))

  const lines: LaidLine[] = chains.map((c, ci) => {
    const own = lineCfg(c.from, c.to)
    const side = fromSide(c)
    const pts = xs[ci] as number[]
    const start: [number, number] = [
      pts[0] as number,
      side ? yOf(c.from) + heightOf(c.from) / 2 : yOf(c.from) + heightOf(c.from),
    ]
    const entry = sideEnd.get(c)
    const end: [number, number] = [
      pts.at(-1) as number,
      yOf(c.to) + (entry === undefined ? 0 : heightOf(c.to) * entry),
    ]
    const points: [number, number][] = own?.via
      ? [start, ...own.via.map(([vx, vy]): [number, number] => [vx, vy]), end]
      : [
          start,
          ...c.via.map((h, i): [number, number] => [pts[i + 1] as number, yOf(h)]),
          ...(turnAt.has(c) ? [[turnAt.get(c) as number, end[1]] as [number, number]] : []),
          end,
        ]
    // Heights of the parts that run across: a lane in the gap above (autoFix), plus flow.ts bend.
    const rowsOf = [row.get(c.from) as number, ...c.via.map((h) => row.get(h) as number)]
    const bends = points.slice(1).map((p, i): number | null => {
      const lane = lanes.get(`${ci}:${i}`)
      const r = rowsOf[i] as number
      let at: number | null = null
      // Lines run across below a chapter's header, never through its text.
      const gapTop = (rowTop[r] ?? 0) + (rowHeight[r] ?? 0) - above + headerAfter(r)
      if (lane !== undefined && !own?.via) {
        const n = laneCount.get(r) ?? 1
        at = gapTop + ((lane + 1) * linesGap(r)) / (n + 1)
      } else if (headerAfter(r) && !own?.via && runs.some((x) => x.id === `${ci}:${i}`)) {
        at = gapTop + linesGap(r) / 2
      }
      if (entry !== undefined && i === points.length - 2) return null
      if (own?.bend) at = (at ?? ((points[i] as [number, number])[1] + p[1]) / 2) + own.bend
      return at
    })
    return {
      from: c.from,
      to: c.to,
      points,
      ...(side ? { side: true } : {}),
      ...(entry !== undefined ? { sideEnd: true } : {}),
      ...(bends.some((b) => b !== null) ? { bends } : {}),
    }
  })
  return {
    width: Math.max(0, ...[...x].map(([k, v]) => v + half(k))),
    height: Math.max(0, bottom - above, ...boxes.map((b) => b.y + b.height)),
    boxes,
    lines,
    chart,
    chapters: ranks.map((rank) => {
      const r = (chapterRow.get(rank) ?? 0) - 1
      const top = r < 0 ? 0 : (rowTop[r] ?? 0) + (rowHeight[r] ?? 0)
      return { rank, top: top - above, height: header }
    }),
    grid: {
      origin: origin ? (x.get(origin) as number) : 0,
      step,
      rows: rowHeight.map((h, r) => ({ top: (rowTop[r] ?? 0) - above, height: h })),
    },
  }
}
