import screen from '@/content/config/screen'
import { audio } from '../audio/manager'
import type {
  Facing,
  MapConfig,
  MapContext,
  MapTransition,
  PropDefinition,
  SpawnOf,
  WorldApi,
} from '../define'
import { getGame } from '../gameRef'
import { lang } from '../lang'
import {
  type EventId,
  loadEvent,
  loadMap,
  type MapDef,
  type MapId,
  type MapParams,
  onHotUpdate,
  props as propDefs,
} from '../registry'
import { backgroundInstantly } from '../scene/director'
import { isFastForward } from '../scene/replay'
import { spriteSheet } from '../sprite/types'
import { useGameStore } from '../stores/game'
import { useSystemStore } from '../stores/system'
import { wait } from '../wait'
import { getWorld, peekWorld } from '../world/getWorld'
import { type Layout, layoutFromTiled } from '../world/layout'
import { npcHandle } from '../world/npc'
import { setInUse, trim as trimTextures } from '../world/textures'
import type { World } from '../world/World'
import { events, startEvent } from './events'
import { placedProps } from './props'
import { forgetStructureLayout, placedLayouts } from './structures'

export const FADE_MS = screen.timings.mapFade
/** Only show the loading screen if loading takes longer than this. */
const LOADING_DELAY_MS = screen.timings.loadingDelay

export interface MapGoOptions<S extends string = string> {
  /** 'fade' (default) or 'instant'. */
  transition?: MapTransition
  /** Spawn point name from the map's `spawns`. Default: its first spawn. */
  spawn?: S
  /** Exact player position in tiles (e.g. from a save). Overrides `spawn`. */
  position?: { x: number; y: number; facing?: Facing }
}

/** Where the player is right now, for save files. */
export interface MapSnapshot {
  id: MapId
  params: unknown
  x: number
  y: number
  facing: Facing
}

/** Maps without params take optional options; maps with params require `{ params }`. */
type SpawnName<K extends MapId> = Extract<SpawnOf<MapDef<K>>, string>
type GoArgs<K extends MapId> = [MapParams<K>] extends [void]
  ? [options?: MapGoOptions<SpawnName<K>>]
  : [options: MapGoOptions<SpawnName<K>> & { params: MapParams<K> }]

type AnyMap = MapConfig<unknown, string>

const set = useSystemStore.setState

// Map changes run one at a time; a go() during a transition waits for it.
let queue: Promise<unknown> = Promise.resolve()
let cleanup: (() => void) | undefined
let currentContext: MapContext<unknown> | undefined
// The spawns of the map on screen (for "I'm stuck").
let currentLayout: Layout | undefined
const changeListeners = new Set<(id: MapId) => void>()

const nextFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
    else setTimeout(resolve, 16)
  })

/**
 * Starts the map's intro event while the black cover is still up, and waits until the event
 * has drawn its first frame. The map is shown only after that (no flash of the map).
 */
async function startIntro(def: AnyMap, ctx: MapContext<unknown>) {
  const intro = typeof def.intro === 'function' ? def.intro(ctx as MapContext<never>) : def.intro
  if (!intro) return
  if (def.introOnce && events.seen(intro as EventId)) return
  backgroundInstantly()
  startEvent(intro).catch((error: unknown) => console.error('[maps] intro', error))
  // Event scripts load a little later: wait until one is running, then let it draw.
  for (let i = 0; i < 100 && useSystemStore.getState().event === null; i++) {
    await wait(10)
  }
  await nextFrame()
  await nextFrame()
}

async function change(id: MapId, options: MapGoOptions & { params?: unknown } = {}) {
  // Replaying a mid-scene save changes maps instantly (behind the loading cover).
  const fade = options.transition !== 'instant' && !isFastForward()
  const previous = useSystemStore.getState().map

  // 1. Fade out (or start from black when there was no map yet).
  if (fade && previous) {
    set((s) => {
      s.mapTransition = 'out'
    })
    await wait(FADE_MS)
  } else if (fade) {
    set((s) => {
      s.mapTransition = 'loading'
    })
  }

  // 2. Load code + assets, showing the loading screen only if it is slow.
  const showLoading = setTimeout(() => {
    set((s) => {
      s.mapTransition = 'loading'
      s.loadingProgress = 0
    })
  }, LOADING_DELAY_MS)
  let world: World
  let def: AnyMap
  let layout: Layout
  let stamps: Awaited<ReturnType<typeof placedLayouts>>
  let images: string[]
  try {
    ;[world, def] = await Promise.all([getWorld(), loadMap(id) as Promise<AnyMap>])
    // Load the intro's script now, so starting it later has no gap.
    if (typeof def.intro === 'string') await loadEvent(def.intro)
    layout = layoutFromTiled(def)
    // Structures placed in this map earlier (saved), with their images.
    stamps = await placedLayouts(id)
    const propSheets = placedProps(id)
      .map((p) => {
        const sprite = (propDefs as Record<string, PropDefinition>)[p.prop]?.sprite
        return sprite && spriteSheet(sprite, lang.current())
      })
      .filter((sheet): sheet is string => !!sheet)
    const loaded = await Promise.all([
      world.preloadSprites(propSheets),
      ...stamps.map((s) => world.preload(s.layout)),
      world.preload(layout, (progress) =>
        set((s) => {
          s.loadingProgress = progress
        }),
      ),
      // Music is nice to have: a missing/broken file must not stop the map from loading.
      def.music
        ? audio.preload([def.music]).catch((e: unknown) => console.warn('[maps]', e))
        : null,
    ])
    images = loaded.flatMap((urls) => urls ?? []) // music's slot is null
  } catch (error) {
    clearTimeout(showLoading)
    set((s) => {
      s.mapTransition = null
    })
    throw error
  }
  clearTimeout(showLoading)

  // 3. Leave the old map, build the new one.
  if (previous && currentContext) {
    const prevDef = (await loadMap(previous.id)) as AnyMap
    await prevDef.onExit?.(currentContext)
  }
  cleanup?.()
  cleanup = undefined

  const spawnNames = Object.keys(layout.spawns)
  const spawnName = options.spawn ?? spawnNames[0] ?? ''
  const spawn = layout.spawns[spawnName]
  if (!spawn) console.warn(`[maps] "${id}" has no spawn "${spawnName}", using 0,0`)
  world.build(def, layout, spawn ?? { x: 0, y: 0 }, id)
  currentLayout = layout
  for (const stamp of stamps) world.addStructure(stamp.id, stamp.layout, stamp.at)
  for (const placement of placedProps(id)) world.addProp(placement)
  // The old map is gone: free its images if they don't fit the memory budget.
  setInUse(images)
  trimTextures()
  if (options.position) {
    const { x, y, facing } = options.position
    world.api().player.place(x, y, facing)
  }
  if (def.music) audio.music(def.music)
  else if (def.music === null) audio.stopMusic()

  const ctx: MapContext<unknown> = { params: options.params, game: getGame(), world: world.api() }
  currentContext = ctx
  set((s) => {
    s.map = { id, params: options.params, spawn: spawnName }
  })
  const result = def.setup?.(ctx)
  if (typeof result === 'function') cleanup = result

  // 3b. Intro event (not when a save is loading: that one brings its own event).
  if (!isFastForward() && !options.position) await startIntro(def, ctx)

  // 4. Fade in.
  if (fade) {
    set((s) => {
      s.mapTransition = 'in'
    })
    await wait(FADE_MS)
  }
  set((s) => {
    s.mapTransition = null
  })
  await def.onEnter?.(ctx)
  for (const listener of changeListeners) listener(id)
}

/** The current map's world API, or undefined (with a warning) when no map is shown. */
function world(what: string): WorldApi | undefined {
  if (!currentContext) console.warn(`[maps] ${what}: no map is shown`)
  return currentContext?.world
}

export const maps = {
  /**
   * Switches map: fade out, load (loading screen if slow), build, fade in.
   * Resolves once the new map is visible and its onEnter has finished.
   */
  go<K extends MapId>(id: K, ...[options]: GoArgs<K>): Promise<void> {
    const run = queue.then(() => change(id, options as MapGoOptions & { params?: unknown }))
    queue = run.catch(() => {})
    return run
  },

  /** Starts loading a map's code and assets in the background (e.g. during the title screen). */
  /**
   * Leaves the current map for good (back to the title screen): runs its onExit and cleanup,
   * and empties the screen. The next map change builds a new one.
   */
  unload(): Promise<void> {
    const run = queue.then(async () => {
      const previous = useSystemStore.getState().map
      if (previous && currentContext) {
        const def = (await loadMap(previous.id)) as AnyMap
        await def.onExit?.(currentContext)
      }
      cleanup?.()
      cleanup = undefined
      peekWorld()?.clear()
      currentContext = undefined
      currentLayout = undefined
      set((s) => {
        s.map = null
        s.mapTransition = null
      })
    })
    queue = run.catch(() => {})
    return run
  },

  /**
   * "I'm stuck": fades out, moves the player to the map's `when_stuck` spawn (or `spawn`, or the
   * first spawn), and fades in. Resolves false when nothing can be done right now.
   */
  unstuck(): Promise<boolean> {
    const run = queue.then(async () => {
      const s = useSystemStore.getState()
      if (!s.map || s.mapTransition || s.event || s.minigame || s.title !== null) return false
      if (!currentContext || !currentLayout) return false
      const spawns = currentLayout.spawns
      const name =
        'when_stuck' in spawns ? 'when_stuck' : 'spawn' in spawns ? 'spawn' : Object.keys(spawns)[0]
      const spawn = name === undefined ? undefined : spawns[name]
      if (!spawn) {
        console.warn('[maps] unstuck: this map has no spawns')
        return false
      }
      set((st) => {
        st.mapTransition = 'out'
      })
      await wait(FADE_MS)
      currentContext.world.player.place(spawn.x + 0.5, spawn.y + 0.5, spawn.facing ?? 'down')
      set((st) => {
        st.mapTransition = 'in'
      })
      await wait(FADE_MS)
      set((st) => {
        st.mapTransition = null
      })
      return true
    })
    queue = run.catch(() => {})
    return run
  },

  preload(id: MapId): void {
    void Promise.all([getWorld(), loadMap(id) as Promise<AnyMap>])
      .then(([world, def]) => world.preload(layoutFromTiled(def)))
      .catch((error: unknown) => console.error('[maps] preload failed', error))
  },

  /**
   * A sprite object on the current map (character id or object name), for events and scripts:
   * `const jack = game.maps.npc('jack'); await jack.walk({ left: 5 }, { up: 2, speed: 6 })`.
   */
  npc: ((id: string) =>
    currentContext
      ? currentContext.world.npc(id)
      : npcHandle(
          id,
          () => undefined,
          () => undefined,
        )) as WorldApi['npc'],

  /**
   * The player on the current map, for cutscenes: game.maps.player.walk({ up: 2 }),
   * walkTo({ x, y }), face('left'). Does nothing (with a warning) when no map is shown.
   */
  player: {
    face: (facing: Facing) => world('player.face')?.player.face(facing),
    walk: (...steps: Parameters<WorldApi['player']['walk']>) =>
      world('player.walk')?.player.walk(...steps) ?? Promise.resolve(),
    walkTo: (...args: Parameters<WorldApi['player']['walkTo']>) =>
      world('player.walkTo')?.player.walkTo(...args) ?? Promise.resolve(false),
    bark: (...args: Parameters<WorldApi['player']['bark']>) =>
      world('player.bark')?.player.bark(...args) ?? Promise.resolve(),
    emote: (...args: Parameters<WorldApi['player']['emote']>) =>
      world('player.emote')?.player.emote(...args) ?? Promise.resolve(),
  },

  /** The map camera: follow('jack'), panTo({ x, y }), zoom(2), reset(). */
  camera: {
    follow: (...args: Parameters<WorldApi['camera']['follow']>) =>
      world('camera.follow')?.camera.follow(...args) ?? Promise.resolve(),
    panTo: (...args: Parameters<WorldApi['camera']['panTo']>) =>
      world('camera.panTo')?.camera.panTo(...args) ?? Promise.resolve(),
    reset: (...args: Parameters<WorldApi['camera']['reset']>) =>
      world('camera.reset')?.camera.reset(...args) ?? Promise.resolve(),
    zoom: (...args: Parameters<WorldApi['camera']['zoom']>) =>
      world('camera.zoom')?.camera.zoom(...args) ?? Promise.resolve(),
  },

  /** Colour over the current map until the next map change (see WorldApi.lighting). */
  lighting: (...args: Parameters<WorldApi['lighting']>) => world('lighting')?.lighting(...args),

  /** The terrain under the player's feet (a name from src/content/terrain.ts), or undefined. */
  terrain: () => world('terrain')?.terrain(),

  /** Rain, snow or null on the current map (see WorldApi.weather). */
  weather: (...args: Parameters<WorldApi['weather']>) => world('weather')?.weather(...args),

  current(): MapId | undefined {
    return useSystemStore.getState().map?.id
  },

  /** The current map and exact player position, or null when no map is shown. */
  snapshot(): MapSnapshot | null {
    const map = useSystemStore.getState().map
    if (!map || !currentContext) return null
    const { player } = currentContext.world
    return { id: map.id, params: map.params, x: player.x, y: player.y, facing: player.facing }
  },

  /** Calls `listener` after every finished map change (used for autosave). Returns an unsubscribe. */
  onChange(listener: (id: MapId) => void): () => void {
    changeListeners.add(listener)
    return () => changeListeners.delete(listener)
  },
}

// Dev: when the current map (or a structure placed in it) is saved, rebuild it right away with
// the player where they were. Other maps/events/windows just use the new code next time.
if (import.meta.env.DEV) {
  onHotUpdate((kind, id) => {
    const shown = useSystemStore.getState().map
    if (kind === 'structures') forgetStructureLayout(id)
    if (!shown || useSystemStore.getState().mapTransition !== null) return
    const affected =
      (kind === 'maps' && id === shown.id) ||
      (kind === 'structures' && placedStructures(shown.id).includes(id))
    if (!affected) return
    const where = maps.snapshot()
    const go = maps.go as (id: MapId, options: object) => Promise<void>
    console.info(`[maps] ${kind}/${id} changed: rebuilding ${shown.id}`)
    go(shown.id, {
      params: shown.params,
      transition: 'instant',
      ...(where ? { position: { x: where.x, y: where.y, facing: where.facing } } : {}),
    }).catch((error: unknown) => console.error('[maps] hot rebuild failed', error))
  })
}

function placedStructures(map: string): string[] {
  return (useGameStore.getState().structures[map] ?? []).map((p) => p.structure)
}
