// React: everything the flowchart window shows (src/content/windows/flowchart). The window only
// draws; this hook knows the routes, the boxes, what was reached, the way that would load, and loads.
//  - focus (keys / pad / mouse over): the box shown in the side panel
//  - pick (click, tap, confirm): also prefers ways through that box; picking it again loads it
import { useEffect, useMemo, useState } from 'react'
import flowchartConfig from '@/content/config/flowchart'
import type { FlowDefinition, RouteConfig, RouteId } from '../defs/routes'
import { getGame } from '../gameRef'
import { chapterManager } from '../managers/chapters'
import { optionShown, routes } from '../managers/routes'
import { loadEvent, loadFlow, loadRoute, registry } from '../registry'
import { useGameStore } from '../stores/game'
import { usePersistentStore } from '../stores/persistent'
import { END, type RouteGraph, START } from './graph'
import { type Layout, layoutGraph } from './layout'
import { optionKey, seenAt } from './progress'

export interface FlowBox {
  key: string
  kind: 'event' | 'choice' | 'route' | 'end'
  /** Untranslated: the window translates it. Locked boxes get the config's `locked` text. */
  title: string
  description?: string
  image?: string
  /** A part name added on top of the box look (flow.ts `look`). */
  look?: string
  /** Reached in some playthrough. */
  seen: boolean
  /** Where the story is now. */
  current: boolean
  /** On the way that would load the selected box. */
  onPath: boolean
  /** Can be loaded (an event box reached through seen boxes). */
  loadable: boolean
  /**
   * Reached, but every way to it goes through a dotted line (a choice option never picked live):
   * it can't be loaded until the player picks that option in the story.
   */
  unreachable: boolean
  /** Route boxes: the route they lead into. */
  link?: RouteId
  x: number
  y: number
}

/** A flag() / check() diamond: the way splits here without the player picking. */
export interface FlowBranch {
  key: string
  /** Its flag id or check label (not shown to players by default: it can spoil). */
  name: string
  /** Passed in some playthrough (as far as the chart can tell). */
  seen: boolean
  onPath: boolean
  /** Top-left corner and size of the space it fills (it is drawn turned 45 degrees inside it). */
  x: number
  y: number
  size: number
}

/** A chapter's line across the chart (chapter() in the route). */
/** A chapter NUMBER's line (sub chapters never get one: 1.1 and 1.2 are both under "Chapter 1"). */
export interface FlowChapter {
  number: number
  /** "Chapter 1" (translated). */
  label: string
  /** A box of this chapter number was reached (unseen ones are hidden in the 'hidden' style). */
  seen: boolean
  /** The room above the line (the line is at top + height). */
  top: number
  height: number
}

export interface FlowLine {
  from: string
  to: string
  points: [number, number][]
  /** Leaves from a diamond's side corner: across first, then down. */
  side?: boolean
  /** Ends on its box's side: down past the top, then across into it. */
  sideEnd?: boolean
  onPath: boolean
  /** Leads to a box not reached yet. */
  locked: boolean
  /** Comes from a box not reached yet. */
  fromUnseen: boolean
  /** The choice option this line was picked with (or flow.ts `label`; untranslated), once its box is reached. */
  label?: string
  /** flow.ts: move the label, px. */
  labelShift?: { x?: number; y?: number }
  /** flow.ts: this line's own colour / width / dashes. */
  look?: { color?: string; width?: number; dash?: [number, number] }
  /** Heights of the parts running across (from the layout). */
  bends?: (number | null)[]
}

export interface RouteTab {
  id: RouteId
  title: string
  image?: string
  color?: string
  /** An after story (or a route one moves on to): its own group, after the main story's tabs. */
  afterStory: boolean
}

interface RouteData {
  graph: RouteGraph
  flow: FlowDefinition | null
  /** Event id -> its title. */
  titles: Record<string, string>
  /** Linked route id -> its config. */
  linked: Record<string, RouteConfig>
}

const dataCache = new Map<RouteId, Promise<RouteData>>()
function routeData(id: RouteId): Promise<RouteData> {
  let data = dataCache.get(id)
  if (!data) {
    data = (async () => {
      const [graph, flow] = await Promise.all([routes.graph(id), loadFlow(id).catch(() => null)])
      const titles: Record<string, string> = {}
      const linked: Record<string, RouteConfig> = {}
      await Promise.all(
        Object.values(graph.nodes).map(async (node) => {
          if (node.kind === 'event') titles[node.event] = (await loadEvent(node.event)).title
          if (node.kind === 'route') linked[node.route] = await loadRoute(node.route)
        }),
      )
      return { graph, flow, titles, linked }
    })()
    data.catch(() => dataCache.delete(id))
    dataCache.set(id, data)
  }
  return data
}

/** The routes the player has reached (common always), common first, then in the order reached. */
function reachedRoutes(): RouteId[] {
  const reached = registry.routes.filter((id) => id === 'common' || seenAt(id, START) > 0)
  return reached.sort((a, b) =>
    a === 'common' ? -1 : b === 'common' ? 1 : seenAt(a, START) - seenAt(b, START),
  )
}

/** The box shown first: where the story is, else the box reached last in that route. */
function firstBox(graph: RouteGraph): string | null {
  const current = routes.current()
  if (current?.route === graph.route && current.key) return current.key
  let best: string | null = null
  let at = 0
  for (const key of Object.keys(graph.nodes)) {
    const when = key === START ? 0 : seenAt(graph.route, key)
    if (when > at) {
      at = when
      best = key
    }
  }
  return best
}

export function useFlowchart() {
  // Redraw when something is reached or picked.
  const progress = usePersistentStore((s) => s.routes)
  const currentRun = useGameStore((s) => s.route)
  // biome-ignore lint/correctness/useExhaustiveDependencies: reachedRoutes() reads the store `progress` comes from
  const tabIds = useMemo(() => reachedRoutes(), [progress])
  const [route, setRouteState] = useState<RouteId>(
    () => (routes.current()?.route as RouteId | undefined) ?? ('common' as RouteId),
  )
  const [data, setData] = useState<RouteData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [way, setWay] = useState<string[]>([])
  /** The box `way` was worked out for (the lookup is async). */
  const [wayFor, setWayFor] = useState<string | null>(null)
  const [tabs, setTabs] = useState<RouteTab[]>([])
  /** The box picked last while this window is open (picking it again loads it). */
  const [lastPick, setLastPick] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void Promise.all([
      Promise.all(tabIds.map((id) => loadRoute(id).then((def) => ({ id, def })))),
      routes.afterStoryRoutes(),
    ]).then(([list, after]) => {
      if (!live) return
      const all = list.map(({ id, def }) => ({
        id,
        title: def.title,
        ...(def.image ? { image: def.image } : {}),
        ...(def.color ? { color: def.color } : {}),
        afterStory: after.has(id),
      }))
      // The main story first, then the after stories (each group in the order reached).
      setTabs([...all.filter((tab) => !tab.afterStory), ...all.filter((tab) => tab.afterStory)])
    })
    return () => {
      live = false
    }
  }, [tabIds])

  useEffect(() => {
    let live = true
    setData(null)
    setError(null)
    routeData(route).then(
      (d) => {
        if (!live) return
        setData(d)
        setSelected((key) => (key && d.graph.nodes[key] ? key : firstBox(d.graph)))
      },
      (e: unknown) => {
        if (live) setError(e instanceof Error ? e.message : String(e))
      },
    )
    return () => {
      live = false
    }
  }, [route])

  // The way that would load the selected box (in this route).
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new pick or seen box changes the way
  useEffect(() => {
    let live = true
    if (!selected || selected === START) {
      setWay([])
      setWayFor(null)
      return
    }
    void routes.way(route, selected).then((plan) => {
      if (!live) return
      setWay(plan?.at(-1)?.nodes ?? [])
      setWayFor(`${route}/${selected}`)
    })
    return () => {
      live = false
    }
  }, [route, selected, progress])

  const hidden = useMemo(() => {
    const set = new Set<string>()
    for (const [key, node] of Object.entries(data?.flow?.nodes ?? {}))
      if (node?.hidden) set.add(key)
    return set
  }, [data])

  const layout: Layout | null = useMemo(
    () =>
      data
        ? layoutGraph(data.graph, flowchartConfig.node, hidden, {
            branchSide: flowchartConfig.branch?.side ?? null,
            branchSize: flowchartConfig.branch?.size ?? 0,
            nodes: data.flow?.nodes ?? {},
            lineGap: flowchartConfig.lineGap,
            autoFix: flowchartConfig.autoFix,
            compact: flowchartConfig.compact,
            ...(flowchartConfig.chapters
              ? {
                  chapterRank: (key: string) => chapterOfBox(data.graph.chapters[key]),
                  chapterHeader: flowchartConfig.chapters.header,
                }
              : {}),
          })
        : null,
    [data, hidden],
  )

  const current = currentRun?.id === route ? currentRun.visited.at(-1) : undefined
  const onWay = new Set(way)
  /** A choice option the chart may show: not hidden, its condition met now, or picked live once. */
  const known = (box: string, option: string) => {
    const node = data?.graph.nodes[box]
    const cond = node?.kind === 'choice' ? node.hidden?.[option] : undefined
    return !cond || optionShown(cond) || seenAt(route, optionKey(box, option)) > 0
  }
  const boxes: FlowBox[] = []
  if (data && layout) {
    for (const { key, x, y } of layout.boxes) {
      const node = data.graph.nodes[key]
      if (!node || node.kind === 'start') continue
      const seen = seenAt(route, key) > 0
      const flow = data.flow?.nodes[key]
      const base = {
        key,
        seen,
        current: key === current,
        onPath: onWay.has(key),
        unreachable: seen && key === selected && wayFor === `${route}/${key}` && way.length === 0,
        x,
        y,
      }
      if (node.kind === 'event') {
        boxes.push({
          ...base,
          kind: 'event',
          title: flow?.title ?? data.titles[node.event] ?? key,
          ...(flow?.description ? { description: flow.description } : {}),
          ...(flow?.image ? { image: flow.image } : {}),
          ...(flow?.look ? { look: flow.look } : {}),
          loadable: seen && key === selected && way.length > 0,
        })
      } else if (node.kind === 'route') {
        const def = data.linked[node.route]
        boxes.push({
          ...base,
          kind: 'route',
          title: def?.title ?? node.route,
          ...(def?.description ? { description: def.description } : {}),
          ...(def?.image ? { image: def.image } : {}),
          link: node.route,
          loadable: false,
        })
      } else if (node.kind === 'choice') {
        // Its question (or "Choice"); the side panel lists the options.
        boxes.push({
          ...base,
          kind: 'choice',
          title: node.question ?? flowchartConfig.text.choice,
          description: node.options
            .filter((_, i) => known(key, node.keys[i] as string))
            .map((o) => `- ${o}`)
            .join('\n'),
          loadable: seen && key === selected && way.length > 0,
        })
      } else if (node.kind === 'end') {
        boxes.push({ ...base, kind: 'end', title: flowchartConfig.text.end, loadable: false })
      }
    }
  }
  // Diamonds: the first after a box is passed once the box is reached (like its lines); a later
  // one once a box it leads to was reached too.
  const chart = layout?.chart
  const boxSeen = (key: string) => seenAt(route, key) > 0
  const branchSeen = (key: string): boolean => {
    const b = chart?.branches[key]
    if (!b || !boxSeen(b.owner)) return false
    return b.root || b.leaves.some(boxSeen)
  }
  const keySeen = (key: string) => (chart?.branches[key] ? branchSeen(key) : boxSeen(key))
  const wayPairs = new Set(way.slice(1).map((k, i) => `${way[i]}>${k}`))
  const edgeOf = (from: string, to: string) =>
    chart?.edges.find((e) => e.from === from && e.to === to)
  const lineOnPath = (from: string, to: string) =>
    edgeOf(from, to)?.pairs.some((p) => wayPairs.has(p)) ?? false
  const branches: FlowBranch[] = []
  if (chart && layout) {
    for (const { key, x, y, width } of layout.boxes) {
      const b = chart.branches[key]
      if (!b) continue
      const into = chart.edges.find((e) => e.to === key)
      const onPath = into ? lineOnPath(into.from, key) : false
      branches.push({ key, name: b.name, seen: branchSeen(key), onPath, x, y, size: width })
    }
  }
  const chapterLines: FlowChapter[] = []
  if (data && layout) {
    for (const c of layout.chapters) {
      const boxesIn = Object.keys(data.graph.chapters).filter(
        (k) => chapterOfBox(data.graph.chapters[k]) === c.rank,
      )
      chapterLines.push({
        number: c.rank,
        label: chapterManager.numberLabel(c.rank),
        seen: boxesIn.some((k) => seenAt(route, k) > 0),
        top: c.top,
        height: c.height,
      })
    }
  }
  const lines: FlowLine[] = (layout?.lines ?? []).flatMap((line): FlowLine[] => {
    const edge = edgeOf(line.from, line.to)
    // A hidden option (choice ask.hidden) that can't show yet and was never picked: no line.
    const options = (edge?.values ?? []).map(String)
    const visible =
      data?.graph.nodes[line.from]?.kind === 'choice'
        ? options.filter((v) => known(line.from, v))
        : options
    if (options.length > 0 && visible.length === 0) return []
    // Lines leaving a choice box: the options that lead here (several can share a line).
    const fromChoice = data?.graph.nodes[line.from]?.kind === 'choice'
    // Dashed until the box is reached, and (choice lines) until one of its options was picked:
    // reaching the box another way doesn't count.
    const unpicked =
      fromChoice &&
      !(edge?.values ?? []).some((v) => seenAt(route, optionKey(line.from, String(v))) > 0)
    const reached = keySeen(line.to)
    const owner = chart?.branches[line.from]?.owner ?? line.from
    const own =
      data?.flow?.nodes[line.from]?.lines?.[line.to] ?? data?.flow?.nodes[owner]?.lines?.[line.to]
    const firstShown = Math.max(0, options.indexOf(visible[0] as string))
    const picked =
      own?.label !== undefined ? own.label : fromChoice ? edge?.labels[firstShown] : undefined
    return [
      {
        ...(own?.labelShift ? { labelShift: own.labelShift } : {}),
        ...(own?.look ? { look: own.look } : {}),
        ...line,
        onPath: lineOnPath(line.from, line.to),
        locked: !reached || unpicked,
        fromUnseen: !keySeen(line.from),
        ...(picked && reached ? { label: picked } : {}),
      },
    ]
  })

  const setRoute = (id: RouteId) => {
    if (id === route) return
    setSelected(null)
    setRouteState(id)
  }

  return {
    config: flowchartConfig,
    tabs,
    route,
    setRoute,
    error,
    layout,
    boxes,
    branches,
    chapters: chapterLines,
    lines,
    selected: boxes.find((b) => b.key === selected) ?? null,
    /** Show a box in the side panel (focus). */
    focus: (key: string) => setSelected(key),
    /**
     * Click / tap / confirm on a box: a route box opens that route's tab; an unseen box only shows;
     * otherwise it becomes the preferred way. Returns true when the box was already picked and can
     * be loaded (the window then asks to load it).
     */
    pick: (key: string): boolean => {
      const box = boxes.find((b) => b.key === key)
      setSelected(key)
      if (!box?.seen) return false
      if (box.kind === 'route' && box.link) {
        if (tabIds.includes(box.link)) setRoute(box.link)
        return false
      }
      if (box.kind !== 'event' && box.kind !== 'choice') return false
      const again = lastPick === `${route}/${key}`
      setLastPick(`${route}/${key}`)
      routes.pick(route, key)
      return again && box.loadable
    },
    /** Loads the selected box (closes the windows first). Resolves false if it can't be loaded. */
    load: async (): Promise<boolean> => {
      if (!selected) return false
      const game = getGame()
      game.windows.closeAll()
      return routes.jump(route, selected)
    },
    end: END,
  }
}

/**
 * The latest chapter NUMBER a box can be entered in (sub chapters don't count: only a new number
 * draws a line), or undefined before any chapter.
 */
function chapterOfBox(ids: string[] | undefined): number | undefined {
  let best: number | undefined
  for (const id of ids ?? []) {
    const n = chapterManager.info(id)?.number
    if (n !== undefined && (best === undefined || n > best)) best = n
  }
  return best
}

/** Tests: forget loaded chart data. */
export function forgetFlowchartData(): void {
  dataCache.clear()
}
