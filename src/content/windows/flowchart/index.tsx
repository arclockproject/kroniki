// The flowchart (visual novel mode, src/content/config/mode.ts): every route's boxes, which ones were
// reached, and loading the story from one of them. Opened from the pause menu. Edit freely: this is
// game content. Sizes, lines and wording: src/content/config/flowchart.ts; box looks: the flow* parts in
// src/content/look/parts.ts; box titles and descriptions: src/content/routes/<route>/flow.ts.
//
// Keys / pad: arrows move between boxes (the side panel shows the box), confirm picks it (the way
// through it lights up), confirm again loads it. LB / RB (Q / R) switch routes. Touch: tap, tap again.
//
// The parts: Boxes.tsx (boxes and diamonds), Lines.tsx + linePath.ts (the lines), ChapterLines.tsx,
// SidePanel.tsx (the selected box), RouteTabs.tsx, DebugGrid.tsx (dev only), chart.ts (shared).
import { Box, Typography } from '@mui/material'
import { type SetStateAction, useEffect, useRef } from 'react'
import { defineWindow, type RouteId } from '@/core/define'
import { game } from '@/core/game'
import { useTabs } from '@/core/input/useTabs'
import { useLang } from '@/core/lang'
import { useFlowchart } from '@/core/routes/useFlowchart'
import { Diamond, FlowBoxButton } from './Boxes'
import { ChapterLines } from './ChapterLines'
import { PAD } from './chart'
import { DebugGrid } from './DebugGrid'
import { Lines } from './Lines'
import { RouteTabs } from './RouteTabs'
import { SidePanel } from './SidePanel'

function Flowchart() {
  const t = useLang()
  const chart = useFlowchart()
  const { config, layout } = chart
  const order = chart.tabs.map((tab) => tab.id)
  useTabs<RouteId>((next: SetStateAction<RouteId>) => {
    chart.setRoute(typeof next === 'function' ? next(chart.route) : next)
  }, order)

  const load = async () => {
    const yes = await game.dialog.ask(t(config.text.loadQuestion), {
      cancel: t('Cancel'),
      load: t(config.text.load),
    })
    if (yes === 'load') await chart.load()
  }

  // Keys / pad start on the selected box (where the story is), also after switching routes.
  const chartRef = useRef<HTMLDivElement>(null)
  const ready = layout !== null && chart.selected !== null
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when a route's chart appears
  useEffect(() => {
    if (!ready) return
    const box = chartRef.current?.querySelector<HTMLElement>(
      `[data-flow-box="${chart.selected?.key}"]`,
    )
    box?.focus({ focusVisible: true } as FocusOptions)
    box?.scrollIntoView({ block: 'center', inline: 'center' })
  }, [chart.route, ready])

  const chartArea = (
    <Box
      key="chart"
      ref={chartRef}
      sx={{ flex: 1, minWidth: 0, overflow: 'auto', position: 'relative' }}
    >
      {chart.error && <Typography color="error">{chart.error}</Typography>}
      {layout && (
        <Box
          sx={{
            position: 'relative',
            width: layout.width + PAD * 2,
            height: layout.height + PAD * 2,
            // Centred when the chart is narrower than its area (scrolls from the left edge when wider).
            mx: 'auto',
          }}
        >
          <ChapterLines chart={chart} />
          <Lines chart={chart} />
          {chart.branches.map((branch) => (
            <Diamond key={branch.key} chart={chart} branch={branch} />
          ))}
          {chart.boxes.map((box) => (
            <FlowBoxButton key={box.key} chart={chart} box={box} onLoad={() => void load()} />
          ))}
          <DebugGrid chart={chart} />
        </Box>
      )}
    </Box>
  )
  const panel = <SidePanel key="panel" chart={chart} onLoad={() => void load()} />
  const tabs = <RouteTabs key="tabs" chart={chart} />
  const middle = config.panel.side === 'left' ? [panel, chartArea] : [chartArea, panel]
  const row = config.tabs.side === 'right' ? [...middle, tabs] : [tabs, ...middle]
  return (
    <Box sx={{ display: 'flex', gap: 1.5, width: '86cqw', height: `${config.height * 100}cqh` }}>
      {row}
    </Box>
  )
}

export default defineWindow({ title: 'Flowchart', component: Flowchart, width: '86cqw' })
