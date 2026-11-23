import { type Chart, PAD } from './chart'

/**
 * Developers only (content/config/flowchart.ts `debug`, dev builds): rows, columns and px for flow.ts
 * `row` / `column` / `shift` / `via`, and the key of every box and diamond (unseen ones too).
 */
export function DebugGrid({ chart }: { chart: Chart }) {
  const { layout, config } = chart
  if (!layout || !config.debug || !import.meta.env.DEV) return null
  const { origin, step, rows } = layout.grid
  const first = Math.floor(-origin / step)
  const last = Math.ceil((layout.width - origin) / step)
  const columns = Array.from({ length: last - first + 1 }, (_, i) => first + i)
  const ink = config.choiceLabel?.color ?? config.pathLine.color
  return (
    <svg
      width={layout.width + PAD * 2}
      height={layout.height + PAD * 2}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 2 }}
    >
      <title>Flowchart debug grid</title>
      <g transform={`translate(${PAD} ${PAD})`} fontSize={9} fill={ink}>
        {columns.map((c) => {
          const cx = origin + c * step
          return (
            <g key={`c${c}`}>
              <line
                x1={cx}
                y1={0}
                x2={cx}
                y2={layout.height}
                stroke={ink}
                strokeOpacity={0.25}
                strokeDasharray="2 4"
              />
              <text x={cx + 2} y={-4}>{`col ${c} · ${Math.round(cx)}`}</text>
            </g>
          )
        })}
        {rows.map((r, i) => (
          <g key={`r${r.top}`}>
            <rect
              x={0}
              y={r.top}
              width={layout.width}
              height={r.height}
              fill={ink}
              fillOpacity={0.05}
            />
            <text x={-PAD + 1} y={r.top + 10}>{`r${i}`}</text>
            <text x={-PAD + 1} y={r.top + 20}>
              {Math.round(r.top)}
            </text>
          </g>
        ))}
        {layout.boxes.map((b) => (
          <text key={b.key} x={b.x} y={b.y - 2} stroke="black" strokeWidth={2} paintOrder="stroke">
            {b.key}
          </text>
        ))}
      </g>
    </svg>
  )
}
