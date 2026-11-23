import { type Chart, PAD } from './chart'

/** Chapter lines: "Chapter 1" over a line across the whole chart (one per chapter number). */
export function ChapterLines({ chart }: { chart: Chart }) {
  const { layout, config } = chart
  const look = config.chapters
  if (!layout || !look) return null
  const shown = chart.chapters.filter((c) => c.seen || config.unseen !== 'hidden')
  return (
    <svg
      width={layout.width + PAD * 2}
      height={layout.height + PAD * 2}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    >
      <title>Flowchart chapters</title>
      <g transform={`translate(${PAD} ${PAD})`}>
        {shown.map((c) => {
          const y = c.top + c.height - look.line.width
          return (
            <g key={c.number}>
              <text x={0} y={y - 6} fontSize={look.size} fill={look.color}>
                {c.label}
              </text>
              <line
                x1={-PAD / 2}
                x2={layout.width + PAD / 2}
                y1={y}
                y2={y}
                stroke={look.line.color}
                strokeWidth={look.line.width}
                strokeDasharray={look.line.dash?.join(' ')}
              />
            </g>
          )
        })}
      </g>
    </svg>
  )
}
