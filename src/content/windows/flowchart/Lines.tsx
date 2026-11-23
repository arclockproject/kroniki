// The flowchart's lines (SVG under the boxes): normal, on the way that would load, or into a box not
// reached yet; their arrows, and the picked option's text on lines out of a choice.
import type { FlowchartLine } from '@/core/flowchart'
import { useLang } from '@/core/lang'
import { hopRadius, lineHops } from '@/core/routes/hops'
import type { FlowLine } from '@/core/routes/useFlowchart'
import { type Chart, PAD } from './chart'
import { labelAt, linePath } from './linePath'

/** All lines of the open route's chart. */
export function Lines({ chart }: { chart: Chart }) {
  const t = useLang()
  const { config, layout, lines } = chart
  if (!layout) return null
  const style = (line: FlowLine): FlowchartLine => ({
    ...(line.onPath ? config.pathLine : line.locked ? config.lockedLine : config.line),
    ...line.look,
  })
  const kinds: [string, FlowchartLine][] = [
    ['line', config.line],
    ['path', config.pathLine],
    ['locked', config.lockedLine],
  ]
  // Lines on the way are drawn last, so they are on top. Hidden-style charts still draw every line
  // leaving a reached box (dashed into a box not reached, which stays invisible), but nothing that
  // starts from a box not reached: the chart never shows past the first unseen box.
  const ordered = [...lines]
    .filter((line) => !(line.fromUnseen && config.unseen === 'hidden'))
    .sort((a, b) => Number(a.onPath) - Number(b.onPath))
  // Where a line runs across another, it hops over it (content/config/flowchart.ts `hops`).
  const hops = lineHops(ordered, config)
  const radius = hopRadius(config)
  const label = config.choiceLabel
  return (
    <svg
      width={layout.width + PAD * 2}
      height={layout.height + PAD * 2}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <title>Flowchart lines</title>
      <defs>
        {kinds.map(([id, s]) => (
          <marker
            key={id}
            id={`flow-arrow-${id}`}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={s.color} />
          </marker>
        ))}
      </defs>
      <g transform={`translate(${PAD} ${PAD})`}>
        {ordered.map((line, i) => {
          const s = style(line)
          const kind = line.onPath ? 'path' : line.locked ? 'locked' : 'line'
          return (
            <path
              key={`${line.from}>${line.to}`}
              d={linePath(line, config.shape, config.corner, hops[i], radius)}
              fill="none"
              stroke={s.color}
              strokeWidth={s.width}
              strokeDasharray={s.dash?.join(' ')}
              markerEnd={config.arrows ? `url(#flow-arrow-${kind})` : undefined}
            />
          )
        })}
        {/* The picked option of a choice, halfway down its first stretch (branches are furthest
            apart there, so labels don't run into each other). */}
        {label &&
          ordered.map((line) => {
            if (!line.label) return null
            const [lx, ly] = labelAt(line, config.labels, label.size)
            return (
              <text
                key={`label:${line.from}>${line.to}`}
                x={lx + (line.labelShift?.x ?? 0)}
                y={ly + (line.labelShift?.y ?? 0)}
                textAnchor="middle"
                fontSize={label.size}
                fill={label.color}
                stroke={label.outline}
                strokeWidth={3}
                paintOrder="stroke"
              >
                {t(line.label)}
              </text>
            )
          })}
      </g>
    </svg>
  )
}
