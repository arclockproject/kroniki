// What sits on the flowchart: the boxes (events, choices, route links, the end), which can be
// focused, picked and loaded, and the flag() / check() diamonds, which only show the way splits.
import { Box, ButtonBase, Typography } from '@mui/material'
import { flowImageDirection } from '@/core/flowchart'
import { useLang } from '@/core/lang'
import type { FlowBox, FlowBranch } from '@/core/routes/useFlowchart'
import { type PartName, part } from '@/core/ui/part'
import { type Chart, PAD } from './chart'

/** One box: focus shows it in the side panel, a pick lights the way, a second pick loads it. */
export function FlowBoxButton({
  chart,
  box,
  onLoad,
}: {
  chart: Chart
  box: FlowBox
  onLoad: () => void
}) {
  const t = useLang()
  const { config } = chart
  // Not reached yet, hidden style: keeps its place but can't be seen, picked or focused.
  const hidden = !box.seen && config.unseen === 'hidden'
  const { width, height, image: imageAt } = config.node
  const title = box.seen ? t(box.title) : t(config.text.locked)
  const image = box.seen && imageAt !== 'none' ? box.image : undefined
  const looks: (PartName | false | undefined)[] = [
    !box.seen && 'flowNodeLocked',
    box.kind === 'route' && 'flowRouteLink',
    box.kind === 'end' && 'flowEnd',
    box.kind === 'choice' && 'flowChoice',
    box.onPath && 'flowNodeOnPath',
    box.current && 'flowNodeCurrent',
    chart.selected?.key === box.key && 'flowNodeSelected',
    box.seen && (box.look as PartName | undefined),
  ]
  const color = box.link ? chart.tabs.find((tab) => tab.id === box.link)?.color : undefined
  return (
    <ButtonBase
      data-flow-box={box.key}
      aria-label={title}
      aria-hidden={hidden || undefined}
      disabled={hidden}
      tabIndex={hidden ? -1 : 0}
      onFocus={() => chart.focus(box.key)}
      onClick={() => {
        if (chart.pick(box.key)) onLoad()
      }}
      sx={[
        part('flowNode'),
        ...looks.map((name) => (name ? part(name) : {})),
        color ? { borderColor: color } : {},
        hidden ? { visibility: 'hidden' } : {},
        {
          position: 'absolute',
          left: box.x + PAD,
          top: box.y + PAD,
          width,
          height,
          px: 1,
          gap: 1,
          display: 'flex',
          flexDirection: flowImageDirection(imageAt),
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'hidden',
        },
      ]}
    >
      {image && (
        <Box
          component="img"
          src={image}
          alt=""
          sx={{
            height: imageAt === 'top' || imageAt === 'bottom' ? '50%' : height - 12,
            aspectRatio: '1',
            objectFit: 'cover',
          }}
        />
      )}
      <Typography
        variant="body2"
        sx={{
          lineHeight: 1.2,
          textAlign: 'center',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {box.kind === 'route' && box.seen ? `→ ${title}` : title}
      </Typography>
    </ButtonBase>
  )
}

/** A flag() / check() diamond: a square turned 45 degrees in the middle of its space. */
export function Diamond({ chart, branch }: { chart: Chart; branch: FlowBranch }) {
  const { config } = chart
  if (!branch.seen && config.unseen === 'hidden') return null
  const side = branch.size / Math.SQRT2
  return (
    <Box
      aria-hidden
      sx={[
        part('flowBranch'),
        branch.onPath ? part('flowBranchOnPath') : {},
        {
          position: 'absolute',
          left: branch.x + PAD + (branch.size - side) / 2,
          top: branch.y + PAD + (branch.size - side) / 2,
          width: side,
          height: side,
          transform: 'rotate(45deg)',
          pointerEvents: 'none',
          opacity: branch.seen ? 1 : 0.5,
        },
      ]}
    />
  )
}
