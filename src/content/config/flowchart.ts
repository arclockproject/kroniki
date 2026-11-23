// How the visual novel flowchart is drawn (VN mode, src/content/config/mode.ts). Edit freely: this is game
// content. The boxes' looks are the flow* parts in src/content/look/parts.ts; the window itself is
// src/content/windows/flowchart. Box titles and descriptions: src/content/routes/<route>/flow.ts.
import { defineFlowchart } from '@/core/flowchart'
import { tx } from '@/core/lang'
import { gold } from '../look/colors'

export default defineFlowchart({
  node: { width: 168, height: 52, gapX: 36, gapY: 44, image: 'left' }, // picture: 'left' | 'right' | 'top' | 'bottom' | 'none'
  shape: 'rounded',
  corner: 10,
  // Where a line runs across another, it hops over it with a small arc (radius px; null = off).
  hops: 5,
  // flag() / check() splits: a diamond; "yes" goes off to this side, "no" goes straight on.
  branch: { size: 26, side: 'right' },
  arrows: false,
  // Chapters (chapter('id') in a route): "Chapter 1" over a line, one per chapter number (sub
  // chapters never add one); later boxes go below it.
  chapters: {
    header: 30,
    size: 12,
    color: gold,
    line: { color: 'rgba(242, 212, 138, 0.4)', width: 1, dash: [6, 4] },
  },
  // Fixing the layout: lineGap (px between side-by-side lines), autoFix (no lines on top of each
  // other), compact (smaller gap where lines only go straight down; null = off), labels (where
  // option text sits), debug (dev builds: keys, rows, columns, px for flow.ts shift/column/row/via).
  lineGap: 16,
  autoFix: true,
  compact: null,
  labels: 'middle',
  debug: false,
  line: { color: 'rgba(255, 255, 255, 0.35)', width: 2 },
  pathLine: { color: gold, width: 3 },
  lockedLine: { color: 'rgba(255, 255, 255, 0.2)', width: 2, dash: [5, 5] },
  // Boxes not reached yet: 'hidden' (VN style: no spoilers) or 'locked' ("???" boxes).
  unseen: 'hidden',
  // The picked option on a line that came from a choice (null = none). outline = a halo for reading.
  choiceLabel: { color: gold, size: 12, outline: 'rgba(10, 12, 18, 0.9)' },
  text: {
    locked: tx('???'),
    end: tx('The end'),
    choice: tx('Choice'),
    load: tx('Load'),
    loadQuestion: tx('Start from here? Progress since your last save will be lost.'),
    cannotLoad: tx('Reach this scene in the story to load it.'),
    noWay: tx(
      'Every way here goes through a choice you have not picked yourself yet. Pick it in the story to load this scene.',
    ),
    routes: tx('Routes'),
    afterStories: tx('After Stories'),
  },
  panel: { width: 0.32, side: 'left' },
  tabs: { side: 'right', image: 'top' }, // tab picture: 'left' | 'right' | 'top' | 'bottom' | 'none'
  height: 0.72,
})
