import { Box, Button, Typography } from '@mui/material'
import { useLang } from '@/core/lang'
import { part } from '@/core/ui/part'
import type { Chart } from './chart'

/** The selected box: its picture, title, route, description, and Load (or why it can't load). */
export function SidePanel({ chart, onLoad }: { chart: Chart; onLoad: () => void }) {
  const t = useLang()
  const box = chart.selected
  const { text } = chart.config
  const routeTitle = chart.tabs.find((tab) => tab.id === chart.route)?.title
  return (
    <Box
      sx={[
        part('flowPanel'),
        {
          width: `${chart.config.panel.width * 100}%`,
          flexShrink: 0,
          p: 1.5,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          overflowY: 'auto',
        },
      ]}
    >
      {box?.seen && box.image && (
        <Box component="img" src={box.image} alt="" sx={{ width: '100%', borderRadius: 1 }} />
      )}
      <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
        {box ? (box.seen ? t(box.title) : t(text.locked)) : ''}
      </Typography>
      {routeTitle && (
        <Typography variant="caption" color="text.secondary">
          {t(routeTitle)}
        </Typography>
      )}
      {box?.seen && box.description && (
        <Typography variant="body2" sx={{ whiteSpace: 'pre-line' }}>
          {t(box.description)}
        </Typography>
      )}
      <Box sx={{ flex: 1 }} />
      {(box?.kind === 'event' || box?.kind === 'choice') &&
        (box.loadable ? (
          <Button variant="contained" onClick={onLoad}>
            {t(text.load)}
          </Button>
        ) : (
          <Typography variant="caption" color={box.unreachable ? 'warning.main' : 'text.secondary'}>
            {t(box.unreachable ? text.noWay : text.cannotLoad)}
          </Typography>
        ))}
    </Box>
  )
}
