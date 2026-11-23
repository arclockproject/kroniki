// Line hops: where a flowchart line runs across another one, it jumps over it with a small arc
// (like wiring diagrams), so a crossing never looks like a join. Pure: the window draws the arcs.
// The pieces here follow the window's linePath for right-angle shapes ('rounded', 'elbow').
import type { FlowchartConfig } from '../flowchart'

/** Hop radius when content/config/flowchart.ts has no `hops`. */
const DEFAULT_HOP = 5

interface HopLine {
  points: [number, number][]
  bends?: (number | null)[]
  side?: boolean
  sideEnd?: boolean
}

type Piece = { at: number; a: number; b: number }

/** The straight runs of a right-angle line: across (at = y) and down (at = x), corners left out. */
function pieces(line: HopLine): { across: Piece[]; down: Piece[] } {
  const across: Piece[] = []
  const down: Piece[] = []
  const [first, ...rest] = line.points
  if (!first) return { across, down }
  let [px, py] = first
  const h = (y: number, a: number, b: number) => {
    if (a !== b) across.push({ at: y, a: Math.min(a, b), b: Math.max(a, b) })
  }
  const v = (x: number, a: number, b: number) => {
    if (a === b) return
    const prev = down.at(-1)
    // Straight on through a place holder: one piece (a crossing right at the joint still counts).
    if (prev && prev.at === x && prev.b === Math.min(a, b)) prev.b = Math.max(a, b)
    else down.push({ at: x, a: Math.min(a, b), b: Math.max(a, b) })
  }
  rest.forEach(([x, y], i) => {
    if (i === 0 && line.side) {
      h(py, px, x)
      v(x, py, y)
    } else if (i === rest.length - 1 && line.sideEnd) {
      v(px, py, y)
      h(y, px, x)
    } else if (x === px) v(x, py, y)
    else {
      const mid = line.bends?.[i] ?? (py + y) / 2
      v(px, py, mid)
      h(mid, px, x)
      v(x, mid, y)
    }
    px = x
    py = y
  })
  return { across, down }
}

/**
 * For each line, where it hops over another: { x, y } on its runs across (the line running across
 * hops, the one going down stays straight). Crossings too near a corner are left out (no room for
 * the arc). Empty lists when hops are off or the shape has no right angles.
 */
function lineHops(
  lines: readonly HopLine[],
  config: Pick<FlowchartConfig, 'shape' | 'corner' | 'hops'>,
): { x: number; y: number }[][] {
  const r = hopRadius(config)
  if (!r || (config.shape !== 'rounded' && config.shape !== 'elbow')) return lines.map(() => [])
  const corner = config.shape === 'rounded' ? config.corner : 0
  const all = lines.map(pieces)
  return all.map((mine, i) =>
    mine.across.flatMap((run) =>
      all.flatMap((other, j) =>
        j === i
          ? []
          : other.down
              .filter(
                (d) =>
                  d.at > run.a + corner + r &&
                  d.at < run.b - corner - r &&
                  run.at > d.a + corner &&
                  run.at < d.b - corner,
              )
              .map((d) => ({ x: d.at, y: run.at })),
      ),
    ),
  )
}

/** The hop radius in px (0 = no hops). */
function hopRadius(config: Pick<FlowchartConfig, 'hops'>): number {
  return config.hops === undefined ? DEFAULT_HOP : Math.max(0, config.hops ?? 0)
}

export { hopRadius, lineHops }
