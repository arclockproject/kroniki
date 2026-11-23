// game.extras: the gallery (CG pictures), scene replay, movies and the music room. Unlocks are kept
// across all saves.

import thumbnails from 'virtual:gallery-thumbnails'
import modeConfig from '@/content/config/mode'
import newGamePlusConfig from '@/content/config/newgameplus'
import scenes from '@/content/scenes'
import { audio } from '../audio/manager'
import { musicPlayer } from '../audio/musicPlayer'
import { type LineVoice, recorded, voicesKey } from '../audio/voiceClips'
import type { EndingConfig, EventConfig, GalleryConfig, MovieConfig, ReplayConfig } from '../define'
import { cgImage, cgPicture, cgVariants, type Picture } from '../gallery'
import { getGame } from '../gameRef'
import { lang, t } from '../lang'
import {
  type AudioId,
  type EndingId,
  type EventId,
  endings as endingRegistry,
  type GalleryId,
  gallery as galleryRegistry,
  loadEvent,
  loadEventMedia,
  type MovieId,
  movies as movieRegistry,
  registry,
} from '../registry'
import { playVoices } from '../scene/director'
import type { CompletionPart } from '../scenes'
import { type GameState, useGameStore } from '../stores/game'
import {
  type FavouriteVoice,
  isPersistentFrozen,
  isUnlocked,
  persistentSnapshot,
  replacePersistent,
  setPersistentFrozen,
  unlock,
  usePersistentStore,
} from '../stores/persistent'
import { useSystemStore } from '../stores/system'
import { toast } from '../ui/toast'
import { persistentFlags, unlockable, unlockKey } from '../unlocks'
import { variantOff } from '../variants'
import { events } from './events'

const gallery = galleryRegistry as Record<string, GalleryConfig>

/** A gallery picture's thumbnail (the build makes one per picture file), else the picture. */
const thumbnailOf = (url: string) => (thumbnails as Record<string, string>)[url] ?? url

/** A picture with every image in the player's language. */
function localPicture(picture: Picture): Picture {
  if (typeof picture === 'string') return lang.image(picture)
  return { ...picture, layers: picture.layers.map((l) => ({ ...l, src: lang.image(l.src) })) }
}

const endingUnlocks = unlockable<EndingId>({
  name: 'ending',
  exists: (id) => endingRegistry[id] !== undefined,
  store: persistentFlags(unlockKey.ending),
  toast: (id) => ({
    text: t('Ending reached: {title}', { title: t((endingRegistry[id] as EndingConfig).title) }),
    kind: 'ending',
    params: { ending: id },
  }),
})

/** One ending of Extras → Endings (src/content/endings). */
export interface EndingEntry {
  id: EndingId
  title: string
  description?: string
  hint?: string
  image?: string
  unlocked: boolean
}

/** What Extras counts as found / to find, per kind and in total. */
export interface Completion {
  found: number
  total: number
  /** 0..100, rounded down (100 only when everything is found). */
  percent: number
  parts: Partial<Record<CompletionPart, { found: number; total: number }>>
}

/** The event that plays a movie from Extras (src/content/events/extras/movie, params { movie }). */
const MOVIE_EVENT: EventId = 'extras/movie'

/** One movie of Extras → Movies (src/content/movies). */
export interface MovieEntry {
  id: MovieId
  title: string
  /** Its `poster`, if it has one (else the tile shows the first frame of `video`). */
  poster?: string
  video: string
  unlocked: boolean
}

/** One track of the music room (src/content/scenes.ts `musicRoom`). */
export interface MusicEntry {
  id: AudioId
  title: string
  artist?: string
  unlocked: boolean
}

let replaying = false

/** One variant of a gallery picture (variant undefined = no toggles on). */
export interface GalleryVariant {
  variant?: string
  /** What to draw: an image URL, or stacked layers (a layered CG with toggles on). */
  picture: Picture
  unlocked: boolean
}

export interface GalleryEntry {
  id: GalleryId
  title: string
  thumbnail: string
  /** Any of its variants unlocked. */
  unlocked: boolean
  /** In gallery order. */
  variants: GalleryVariant[]
}

export interface SceneEntry {
  id: EventId
  title: string
  /** Card picture (a thumbnail when one was made): its `preview`, else its first CG or background. */
  preview?: string
  unlocked: boolean
}

/** The first CG or background an event shows (for a scene card without its own preview). */
async function firstPicture(id: EventId): Promise<string | undefined> {
  const media = await loadEventMedia(id).catch(() => [])
  for (const item of media) {
    if (item.kind === 'image') return item.url
    if (item.kind === 'cg') {
      const picture = gallery[item.id] as GalleryConfig | undefined
      if (picture) return cgImage(picture, lang.current())
    }
  }
  return undefined
}

export const extras = {
  /** Unlocks a gallery picture or one of its variants (events do this with cg('id', 'variant')). */
  unlockImage(id: GalleryId, variant?: string): void {
    unlock(unlockKey.image(id, variant))
  },

  /** Whether the picture (any variant, or the one given) is unlocked. */
  imageUnlocked(id: GalleryId, variant?: string): boolean {
    if (variant !== undefined) return isUnlocked(unlockKey.image(id, variant))
    const picture = gallery[id] as GalleryConfig | undefined
    if (!picture) return false
    return cgVariants(picture).some((v) => isUnlocked(unlockKey.image(id, v)))
  },

  /**
   * Every gallery picture with its variants, unlocked or not. `revealAll` shows everything as
   * unlocked without saving it (Extras → "Show all").
   */
  images(revealAll = false): GalleryEntry[] {
    return registry.gallery.map((id) => {
      const picture = gallery[id] as GalleryConfig
      // Everything in the player's language: "<name>.<lang>" layers or "<name>.<lang>.<ext>" files.
      const language = lang.current()
      const image = lang.image(cgImage(picture, language))
      const variants = cgVariants(picture).map((variant) => ({
        ...(variant === undefined ? {} : { variant }),
        picture: localPicture(cgPicture(picture, variant, language)),
        unlocked: revealAll || isUnlocked(unlockKey.image(id, variant)),
      }))
      return {
        id,
        title: picture.title,
        thumbnail: picture.thumbnail ? lang.image(picture.thumbnail) : thumbnailOf(image),
        unlocked: variants.some((v) => v.unlocked),
        variants,
      }
    })
  },

  /** Done automatically when an event with `replay` finishes. */
  unlockScene(id: EventId): void {
    unlock(unlockKey.scene(id))
  },

  sceneUnlocked(id: EventId): boolean {
    return isUnlocked(unlockKey.scene(id))
  },

  /** Every replayable event (loads their code). */
  async scenes(): Promise<SceneEntry[]> {
    const defs = await Promise.all(
      registry.events.map(async (id) => ({
        id,
        def: (await loadEvent(id)) as EventConfig<unknown>,
      })),
    )
    // An event with `only` for another content variant is not in this build (an empty stand-in).
    const replayable = defs.filter(({ def }) => def.replay && !variantOff(def))
    return Promise.all(
      replayable.map(async ({ id, def }) => {
        const replay: ReplayConfig =
          typeof def.replay === 'string' ? { title: def.replay } : (def.replay as ReplayConfig)
        const preview = replay.preview ?? (await firstPicture(id))
        return {
          id,
          title: replay.title,
          // In the player's language ("<name>.<lang>.<ext>" next to it), as a thumbnail when made.
          ...(preview ? { preview: thumbnailOf(lang.image(preview)) } : {}),
          unlocked: extras.sceneUnlocked(id),
        }
      }),
    )
  },

  /**
   * Plays an event again without changing the game: the game state is put back afterwards.
   * Saving is off meanwhile. The scene shows above the title screen on a black backdrop.
   * A scene not unlocked yet (Extras → Show all) also leaves the across-saves data untouched:
   * no pictures, scenes, read lines, achievements or title screens are earned by watching it.
   */
  async replay(id: EventId, params?: unknown): Promise<void> {
    if (replaying) return
    const before = structuredClone(useGameStore.getState()) as GameState
    const preview = !extras.sceneUnlocked(id)
    const persistentBefore = preview ? persistentSnapshot() : null
    if (preview) setPersistentFrozen(true)
    replaying = true
    useSystemStore.setState((s) => {
      s.sceneReplay = true
    })
    try {
      await (events.start as (id: EventId, params?: unknown) => Promise<void>)(id, params)
    } finally {
      replaying = false
      useSystemStore.setState((s) => {
        s.sceneReplay = false
      })
      useGameStore.setState(before, true)
      if (persistentBefore) {
        // Favourite voices are the player's own picks (starred in the log meanwhile): they stay.
        const { voices } = usePersistentStore.getState()
        replacePersistent({ ...persistentBefore, ...(voices ? { voices } : {}) })
        setPersistentFrozen(false)
      }
    }
  },

  /**
   * The favourite voices (lines starred in the log), newest first. Kept on this device, across
   * saves. A line whose clips are no longer in the game is left out.
   */
  favouriteVoices(): FavouriteVoice[] {
    const list = usePersistentStore.getState().voices ?? []
    return list.filter((line) => recorded(line.voices).length > 0).reverse()
  },

  /** Is the line with these clips a favourite? */
  isFavouriteVoice(voices: readonly LineVoice[]): boolean {
    const key = voicesKey(voices)
    return (usePersistentStore.getState().voices ?? []).some(
      (line) => voicesKey(line.voices) === key,
    )
  },

  /**
   * Stars a voiced line, or takes its star away (one star per set of clips). Returns whether it is a
   * favourite now. A full list (src/content/scenes.ts voice.favourites.max) takes no more: a toast
   * says so.
   */
  toggleFavouriteVoice(line: FavouriteVoice): boolean {
    if (extras.isFavouriteVoice(line.voices)) {
      const key = voicesKey(line.voices)
      usePersistentStore.setState((s) => {
        s.voices = (s.voices ?? []).filter((kept) => voicesKey(kept.voices) !== key)
      })
      return false
    }
    const { max } = scenes.voice.favourites
    if ((usePersistentStore.getState().voices ?? []).length >= max) {
      toast(t('Favourite voices are full ({max}). Remove one in Extras first.', { max }))
      return false
    }
    usePersistentStore.setState((s) => {
      s.voices = [
        ...(s.voices ?? []),
        {
          voices: line.voices.map((voice) => ({ ...voice })),
          name: line.name,
          ...(line.color ? { color: line.color } : {}),
          text: line.text,
        },
      ]
    })
    return true
  },

  /** Plays a favourite voice, in the voice language set now (each speaker's volume applies). */
  playFavouriteVoice(line: FavouriteVoice): void {
    playVoices(recorded(line.voices))
  },

  /**
   * The music room's tracks, in the order of src/content/scenes.ts. A track unlocks when it has
   * played in the game (or all are open with `unlock: 'always'`). `revealAll` shows every track
   * as unlocked without saving it.
   */
  music(revealAll = false): MusicEntry[] {
    const always = scenes.musicRoom.unlock === 'always'
    return scenes.musicRoom.tracks
      .filter((track) => audio.has(track.id))
      .map((track) => ({
        id: track.id as AudioId,
        title: track.title,
        ...(track.artist ? { artist: track.artist } : {}),
        unlocked: always || revealAll || isUnlocked(unlockKey.music(track.id)),
      }))
  },

  /**
   * Plays a track from the music room (null stops the music). Playing here never unlocks a
   * track, so one only shown through "Show all" stays locked.
   */
  playMusic(id: AudioId | null): void {
    // Through the music room's player (core/audio/musicPlayer.ts), so its controls show it.
    if (id === null) musicPlayer.stop()
    else musicPlayer.play(id)
  },

  /** Whether the movie has played in the game (Extras → Movies). */
  movieUnlocked(id: MovieId): boolean {
    return isUnlocked(unlockKey.movie(id))
  },

  /** Unlocks a movie without playing it (movie('id') in an event unlocks it by itself). */
  unlockMovie(id: MovieId): void {
    unlock(unlockKey.movie(id))
  },

  /**
   * Every movie of src/content/movies, in folder order. `revealAll` shows every movie as
   * unlocked without saving it (Extras → "Show all").
   */
  movies(revealAll = false): MovieEntry[] {
    return registry.movies.map((id) => {
      // Typed as a movie even when the game has none (the id type is then `never`).
      const def: MovieConfig = movieRegistry[id]
      return {
        id,
        title: def.title,
        poster: def.poster,
        video: def.video,
        unlocked: revealAll || extras.movieUnlocked(id),
      }
    })
  },

  /**
   * Plays a movie as it plays in a scene (music fades out, the screen goes black), through the
   * event src/content/events/extras/movie. Like a scene replay, the game is put back afterwards
   * and watching a movie that is not unlocked yet (Show all) unlocks nothing.
   */
  playMovie(id: MovieId): Promise<void> {
    return extras.replay(MOVIE_EVENT, { movie: id })
  },

  /** Whether the story has ended this way before (in any playthrough). */
  endingReached: endingUnlocks.has,

  /**
   * Marks an ending as reached, for good (events do this with ending('id')). Returns true the
   * first time. `notify` (default true) shows a toast then.
   */
  reachEnding(id: EndingId, options: { notify?: boolean } = {}): boolean {
    // Every ending (also one seen before) refreshes what New Game+ carries over.
    const carries = newGamePlusConfig.enabled && newGamePlusConfig.unlock === 'ending'
    if (carries && endingRegistry[id] && !isPersistentFrozen()) getGame().save.unlockNewGamePlus()
    return endingUnlocks.unlock(id, options)
  },

  /**
   * The endings in order (`order`, then folder order). Secret ones are left out until reached.
   * `revealAll` shows every ending as reached without saving it.
   */
  endings(revealAll = false): EndingEntry[] {
    return registry.endings
      .map((id, index) => ({ id, index, def: endingRegistry[id] as EndingConfig }))
      .sort((a, b) => (a.def.order ?? a.index) - (b.def.order ?? b.index))
      .map(({ id, def }) => ({
        id,
        title: def.title,
        description: def.description,
        hint: def.hint,
        image: def.image ? lang.image(def.image) : undefined,
        unlocked: revealAll || extras.endingReached(id),
        secret: def.secret === true,
      }))
      .filter((entry) => entry.unlocked || !entry.secret)
      .map(({ secret: _secret, ...entry }) => entry)
  },

  /**
   * How much of the game the player has found: the kinds listed in src/content/scenes.ts
   * `completion.count`, each as found / total, and one overall percentage.
   * (Scenes are not in it: counting them needs every event loaded. Use scenes() for that.)
   */
  completion(): Completion {
    const parts: Completion['parts'] = {}
    const add = (part: CompletionPart, list: { unlocked: boolean }[]) => {
      if (!scenes.completion.count.includes(part) || list.length === 0) return
      parts[part] = { found: list.filter((e) => e.unlocked).length, total: list.length }
    }
    add('endings', extras.endings())
    add(
      'gallery',
      extras.images().flatMap((picture) => picture.variants),
    )
    add('movies', extras.movies())
    add('music', extras.music())
    // Visual novel mode has no Achievements tab, so they are not counted either.
    if (!modeConfig.vnOnly)
      add(
        'achievements',
        registry.achievements.map((id) => ({
          unlocked: id in usePersistentStore.getState().achievements,
        })),
      )
    let found = 0
    let total = 0
    for (const part of Object.values(parts)) {
      found += part.found
      total += part.total
    }
    return { found, total, percent: total > 0 ? Math.floor((found / total) * 100) : 0, parts }
  },

  /**
   * Whether any picture, scene, movie, ending or achievement is unlocked (e.g. for Extras in the
   * title menu). Achievements don't count in visual novel mode (Extras has no tab for them there).
   */
  anyUnlocked(): boolean {
    const { unlocked, achievements } = usePersistentStore.getState()
    return (
      (!modeConfig.vnOnly && Object.keys(achievements).length > 0) ||
      Object.keys(unlocked).some((key) => /^(gallery|scene|movie|ending):/.test(key))
    )
  },

  isReplaying(): boolean {
    return replaying
  },
}

/** React: re-renders when something is unlocked. */
export function useUnlocked(): Record<string, true> {
  return usePersistentStore((s) => s.unlocked)
}

/** The favourite voices (newest first); the component redraws when one is added or removed. */
export function useFavouriteVoices(): FavouriteVoice[] {
  usePersistentStore((s) => s.voices)
  return extras.favouriteVoices()
}
