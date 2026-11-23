// Shared by the flowchart window's parts.
import type { useFlowchart } from '@/core/routes/useFlowchart'

/** Space around the chart, px (so focus rings and arrows are never cut off). */
export const PAD = 16

/** Everything the window draws from: useFlowchart() (boxes, lines, tabs, selection, load). */
export type Chart = ReturnType<typeof useFlowchart>
