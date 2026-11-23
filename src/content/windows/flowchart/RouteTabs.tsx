import { Box, ButtonBase, Stack, Typography } from '@mui/material'
import { flowImageDirection } from '@/core/flowchart'
import { useLang } from '@/core/lang'
import { part } from '@/core/ui/part'
import type { Chart } from './chart'

function RouteTab({ chart, tab }: { chart: Chart; tab: Chart['tabs'][number] }) {
  const t = useLang()
  const open = tab.id === chart.route
  const imageAt = chart.config.tabs.image
  const across = imageAt === 'left' || imageAt === 'right'
  return (
    <ButtonBase
      aria-pressed={open}
      onClick={() => chart.setRoute(tab.id)}
      sx={[
        part('flowTab'),
        open ? part('flowTab', 'selected') : {},
        tab.color ? { borderColor: tab.color } : {},
        { p: 1, flexDirection: flowImageDirection(imageAt), gap: 0.5, flexShrink: 0 },
      ]}
    >
      {imageAt !== 'none' && tab.image && (
        <Box
          component="img"
          src={tab.image}
          alt=""
          sx={{
            width: across ? '40%' : '100%',
            aspectRatio: across ? '1' : '16 / 9',
            objectFit: 'cover',
            borderRadius: 0.5,
            flexShrink: 0,
          }}
        />
      )}
      <Typography variant="body2" sx={{ lineHeight: 1.2 }}>
        {t(tab.title)}
      </Typography>
    </ButtonBase>
  )
}

/**
 * The route tabs: the main story's, then a line and the after stories' (routes with `afterStory`
 * and the routes they move on to). Each group scrolls by itself when it has many tabs.
 */
export function RouteTabs({ chart }: { chart: Chart }) {
  const t = useLang()
  const main = chart.tabs.filter((tab) => !tab.afterStory)
  const after = chart.tabs.filter((tab) => tab.afterStory)
  const { routes: routesHeading, afterStories: heading } = chart.config.text
  const group = (list: typeof main) => (
    <Stack spacing={1} sx={{ minHeight: 0, flex: '0 1 auto', overflowY: 'auto', p: '2px' }}>
      {list.map((tab) => (
        <RouteTab key={tab.id} chart={chart} tab={tab} />
      ))}
    </Stack>
  )
  return (
    <Stack spacing={1} sx={{ flexShrink: 0, width: 112, minHeight: 0 }}>
      {routesHeading && (
        <Box sx={[part('flowTabHeading'), { flexShrink: 0, textAlign: 'center' }]}>
          {t(routesHeading)}
        </Box>
      )}
      {group(main)}
      {after.length > 0 && (
        <>
          <Box
            role="separator"
            sx={[part('flowTabDivider'), { flexShrink: 0, pt: 0.5, textAlign: 'center' }]}
          >
            {heading ? t(heading) : null}
          </Box>
          {group(after)}
        </>
      )}
    </Stack>
  )
}
