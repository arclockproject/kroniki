// Where the flowchart's lines go, as SVG: their paths (in the configured shape, with hops over
// other lines) and where a choice's text sits on them. No React.
import type { FlowLine } from '@/core/routes/useFlowchart'
import type { Chart } from './chart'

/**
 * An SVG path through the line's points, in the configured shape. Each stretch goes down, across,
 * down; a line leaving a diamond's side goes across first, then down; a line entering a box's side
 * goes down, then across into it. `hops`: where it jumps over other lines (core/routes/hops.ts).
 */
export function linePath(
  line: FlowLine,
  shape: Chart['config']['shape'],
  corner: number,
  hops: { x: number; y: number }[] = [],
  radius = 0,
): string {
  const [first, ...rest] = line.points
  if (!first) return ''
  /** Across to `to` at height y, with a small arc over every line it crosses on the way. */
  const across = (from: number, to: number, y: number) => {
    const s = Math.sign(to - from)
    let out = ''
    for (const h of hops
      .filter(
        (h) => Math.abs(h.y - y) < 0.5 && (h.x - from) * s > radius && (to - h.x) * s > radius,
      )
      .sort((p, q) => (p.x - q.x) * s))
      out += ` H ${h.x - s * radius} A ${radius} ${radius} 0 0 ${s > 0 ? 1 : 0} ${h.x + s * radius} ${y}`
    return `${out} H ${to}`
  }
  let d = `M ${first[0]} ${first[1]}`
  let [px, py] = first
  rest.forEach(([x, y], i) => {
    const sx = Math.sign(x - px)
    const last = i === rest.length - 1
    if (shape === 'straight') d += ` L ${x} ${y}`
    else if (i === 0 && line.side) {
      // Across from the diamond's corner, then down (and maybe across again into a box's side).
      const next = !last && line.sideEnd ? rest[i + 1] : undefined
      if (shape === 'curve') d += ` Q ${x} ${py} ${x} ${y}`
      else if (shape === 'elbow') d += `${across(px, x, py)} V ${y}`
      else {
        const c = Math.max(0, Math.min(corner, Math.abs(x - px), (y - py) / 2))
        d += `${across(px, x - sx * c, py)} Q ${x} ${py} ${x} ${py + c}`
        if (next && next[1] === y) {
          const s2 = Math.sign(next[0] - x)
          const c2 = Math.max(0, Math.min(corner, Math.abs(next[0] - x), y - py - c))
          d += ` V ${y - c2} Q ${x} ${y} ${x + s2 * c2} ${y}`
          px = x + s2 * c2
          py = y
          return
        }
        d += ` V ${y}`
      }
    } else if (last && line.sideEnd) {
      // Down past the box's top, then across into its side.
      if (y === py) d += across(px, x, y)
      else if (shape === 'curve') d += ` Q ${px} ${y} ${x} ${y}`
      else if (shape === 'elbow') d += ` V ${y}${across(px, x, y)}`
      else {
        const c = Math.max(0, Math.min(corner, Math.abs(x - px), y - py))
        d += ` V ${y - c} Q ${px} ${y} ${px + sx * c} ${y}${across(px + sx * c, x, y)}`
      }
    } else if (x === px) d += ` V ${y}`
    else {
      // Where it runs across: the layout's height (lanes, flow.ts bend), else halfway.
      const mid = line.bends?.[i] ?? (py + y) / 2
      if (shape === 'curve') d += ` C ${px} ${mid} ${x} ${mid} ${x} ${y}`
      else if (shape === 'elbow') d += ` V ${mid}${across(px, x, mid)} V ${y}`
      else {
        const c = Math.max(0, Math.min(corner, Math.abs(x - px) / 2, mid - py, y - mid))
        d +=
          ` V ${mid - c} Q ${px} ${mid} ${px + sx * c} ${mid}` +
          `${across(px + sx * c, x - sx * c, mid)} Q ${x} ${mid} ${x} ${mid + c} V ${y}`
      }
    }
    px = x
    py = y
  })
  return d
}

/**
 * Where a line's text goes on its first stretch: just under the box it leaves, where it runs across
 * (halfway), or just over the box it reaches. Returns the text's middle and baseline.
 */
export function labelAt(
  line: FlowLine,
  at: Chart['config']['labels'],
  size: number,
): [number, number] {
  const [x0, y0] = line.points[0] ?? [0, 0]
  const [x1, y1] = line.points[1] ?? [x0, y0]
  if (at === 'start') return [x0, y0 + size + 2]
  if (at === 'end') return [x1, y1 - 4]
  return [(x0 + x1) / 2, (line.bends?.[0] ?? (y0 + y1) / 2) + size / 3]
}
