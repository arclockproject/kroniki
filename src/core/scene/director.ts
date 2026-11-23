// Implements the event commands (say, choice, show, ...) on top of the system store.
// The event layer (UI) calls advance() / pick() when the player continues or chooses.
import scenes from '@/content/scenes'
import weatherConfig from '@/content/weather'
import { audio } from '../audio/manager'
import { type LineVoice, recorded, voiceSound } from '../audio/voiceClips'
import { characterVoiceVolume } from '../audio/voices'
import { cgPicture, type GalleryConfig, pictureUrls, type StackedPicture } from '../gallery'
import { getGame } from '../gameRef'
import { lang, t } from '../lang'
import { characterNames } from '../managers/characters'
import { dialog } from '../managers/dialog'
import type { MovieConfig } from '../movies'
import type { LayeredPortrait } from '../portrait/define'
import type { SpinePortrait } from '../portrait/spine'
import {
  backgrounds,
  type CharacterId,
  characters,
  gallery,
  insets,
  type MovieId,
  movies,
} from '../registry'
import type { MoveStep } from '../scenes'
import { selfVoicing } from '../selfVoicing'
import { useGameStore } from '../stores/game'
import { isRead, lineKey, markRead, unlock } from '../stores/persistent'
import { useSettingsStore } from '../stores/settings'
import { useSystemStore } from '../stores/system'
import { unlockKey } from '../unlocks'
import { wait } from '../wait'
import { chapterCardCovered, chapterCardDone, isUnderCard } from './chapterCard'
import {
  animate,
  defaultStagePosition,
  fade,
  flash,
  frameFx,
  moveCamera,
  placeActor,
  playMove,
  removeActor,
  resetEffects,
  shake,
  startShake,
  stopShake,
} from './effects'
import { parseVoiceClip, voiceClip, voiceSpeaker } from './lineCode'
import { stripMarkup } from './markup'
import { maskTransition } from './mask'
import { isSkippingEffects, playback } from './playback'
import { characterUrls, notePictureShown } from './preload'
import {
  isFastForward,
  isRushing,
  recordingPoint,
  recordStep,
  setWaiting,
  takeStep,
} from './replay'
import type { ChoiceView } from './state'
import { DEFAULT_BACKGROUND_FADE, emptyScene, LOG_LIMIT } from './state'
import type {
  BackgroundOptions,
  ChoiceOption,
  ChoiceSettings,
  FilterTarget,
  ImageOptions,
  InputOptions,
  InsetOptions,
  LineStyle,
  LineValue,
  MoviePlayOptions,
  SceneApi,
  SceneFilter,
  StagePosition,
} from './types'
import { LINE_STYLE_KEYS } from './types'

/** inset() without its own duration: fade, ms (src/content/scenes.ts inset.fadeMs). */
const INSET_FADE_MS = scenes.inset?.fadeMs ?? 300

const set = useSystemStore.setState

let lineId = 0
/** The next background() appears at once (set by a map intro, see maps.ts). */
let instantBackground = false

/** Map intros: the event's first background() must not fade in from the map. */
export function backgroundInstantly() {
  instantBackground = true
}
let continueLine: (() => void) | undefined
let movieId = 0
/** Increases when the scene is cleared: commands still waiting from before then give up. */
let sceneRun = 0
let finishMovie: (() => void) | undefined
let choose: ((index: number) => void) | undefined

function character(id: CharacterId) {
  return characters[id] as {
    name: string
    color?: string
    portraits?: Record<string, string>
    layered?: LayeredPortrait
    spine?: SpinePortrait
  }
}

/** How loud a character's voice plays (Settings → Voices: their slider, or 0 when muted). */
export const voiceVolume = characterVoiceVolume

/**
 * The clips a line plays, kept only when recorded. `voice`: a number (this event's clip of the
 * speaker), a clip by name, or { speaker: number | clip } for several voices at once. No `voice`
 * = none.
 */
export function lineVoices(
  style: LineStyle,
  eventId: string,
  speakers: readonly string[],
): LineVoice[] {
  const { voice } = style
  if (voice === undefined || voice === null) return []
  const clipOf = (who: string, value: number | string) =>
    typeof value === 'number' ? voiceClip(eventId, who, value, scenes.voice.digits) : value
  if (typeof voice === 'object') {
    const all = Object.entries(voice as Record<string, number | string | undefined>)
    return recorded(
      all.flatMap(([who, value]) =>
        value === undefined ? [] : [{ clip: clipOf(who, value), speaker: who }],
      ),
    )
  }
  if (typeof voice === 'number' && speakers.length > 1)
    console.warn(
      `[events] a line said together needs a voice per speaker: { voice: { ${speakers.map((s, i) => `${s}: ${i + 1}`).join(', ')} } }`,
    )
  const who =
    typeof voice === 'string'
      ? (parseVoiceClip(voice)?.speaker ?? voiceSpeaker(speakers[0] ?? null, style.as))
      : voiceSpeaker(speakers[0] ?? null, style.as)
  return recorded([{ clip: clipOf(who, voice), speaker: who }])
}

/** Plays a line's voices together (each at its speaker's volume; each mouth follows its own). */
export function playVoices(voices: readonly LineVoice[]): void {
  const clips = voices.flatMap((voice) => {
    const id = voiceSound(voice.clip)
    return id
      ? [
          {
            id,
            volume: voiceVolume(voice.speaker),
            ...(voice.speaker ? { who: voice.speaker } : {}),
          },
        ]
      : []
  })
  if (clips.length) audio.voices(clips)
}

/** Splits say()/narrate() options into the line style and the {name} values. */
function splitOptions(options: Record<string, unknown> = {}) {
  const style: Record<string, unknown> = {}
  const values: Record<string, LineValue> = {}
  for (const [key, value] of Object.entries(options)) {
    if (key in LINE_STYLE_KEYS) style[key] = value
    else if (typeof value === 'string' || typeof value === 'number') values[key] = value
    else values[key] = String(value)
  }
  // A named look (content/scenes.ts lineStyles) goes under what the line itself sets.
  const presets: Record<string, LineStyle> = scenes.lineStyles
  const named = typeof style.style === 'string' ? presets[style.style] : undefined
  if (style.style !== undefined && !named)
    console.warn(`[events] no line style "${String(style.style)}" in content/scenes.ts`)
  return { style: { ...named, ...style } as LineStyle, values }
}

/**
 * A chapter card on screen: run `then` once it is gone (the scene starts after it). Null when no card
 * is up, or a save is replaying (no card then). A scene that ended meanwhile never goes on.
 */
function afterCard<T>(then: () => Promise<T>): Promise<T> | null {
  const card = chapterCardDone()
  if (!card || isFastForward()) return null
  const run = sceneRun
  return card.then(() => (run === sceneRun ? then() : new Promise<T>(() => {})))
}

function line(
  who: readonly CharacterId[],
  source: string,
  options?: Record<string, unknown>,
): Promise<void> {
  const waiting = afterCard(() => line(who, source, options))
  if (waiting) return waiting
  const { style, values } = splitOptions(options)
  // One speaker, or several saying it together (then no one is "the" speaker: plain chat box).
  const speaker = who.length === 1 ? (who[0] as CharacterId) : null
  const group = who.length > 1 ? [...who] : undefined
  const info = speaker ? character(speaker) : undefined
  // Translated here, once per line (the log keeps the translated text too). The translation key
  // is the text with its {name} holes, so one translation works for every value.
  const text = t(source, values)
  // The shown name: style.as wins, else the character's current name (may still be hidden).
  const name = style.as
    ? t(style.as, values)
    : group
      ? scenes.text.groupName(group.map((id) => characterNames.name(id)))
      : speaker
        ? characterNames.name(speaker)
        : null
  lineId += 1
  const id = lineId
  // Read tracking: per event + source text, remembered across saves (skip mode).
  const running = useSystemStore.getState().event
  const key = lineKey(running?.stack[0] ?? '', source)
  const read = isRead(key)
  // Voice files are named after the event the line is written in (not the one it runs inside).
  const voices = lineVoices(style, running?.id ?? '', who)
  const plain = stripMarkup(text)
  // Where the scene is now (before this line is recorded): the log can jump back to it.
  const at = recordingPoint()
  set((s) => {
    const page = s.scene.nvl
    if (page) {
      // Full-page text: the line before joins the page; a full page starts over.
      const before = s.scene.line
      if (before?.page)
        s.scene.page.push({
          id: before.id,
          name: before.name,
          color: before.speaker ? (character(before.speaker).color ?? null) : null,
          text: before.text,
          style: before.style,
          read: before.read,
        })
      const max = scenes.nvl.maxLines
      if (max > 0 && s.scene.page.length >= max) s.scene.page = []
    }
    s.scene.line = {
      id,
      speaker,
      ...(group ? { group } : {}),
      name,
      text,
      style,
      advanced: false,
      read,
      voices,
      ...(page ? { page } : {}),
    }
    s.scene.log.push({
      name,
      color: info?.color ?? null,
      text: plain,
      ...(voices.length ? { voices } : {}),
      ...(speaker ? { speaker } : {}),
      ...(at ? { at } : {}),
    })
    if (s.scene.log.length > LOG_LIMIT) s.scene.log.splice(0, s.scene.log.length - LOG_LIMIT)
  })
  // Fast-forward (loading a mid-scene save, rollback): this line was already read.
  if (takeStep('l')) {
    recordStep({ k: 'l' })
    markRead(key)
    set((s) => {
      if (s.scene.line?.id === id) s.scene.line.advanced = true
    })
    return Promise.resolve()
  }
  // Dev start: lines before the marker go by (not marked read: nobody read them).
  if (isRushing()) {
    recordStep({ k: 'l' })
    set((s) => {
      if (s.scene.line?.id === id) s.scene.line.advanced = true
    })
    return Promise.resolve()
  }
  if (voices.length) playVoices(voices)
  // Self-voicing reads lines that have no recorded voice.
  else selfVoicing.speak(name ? `${name}: ${plain}` : plain)
  setWaiting(true)
  return new Promise((resolve) => {
    continueLine = () => {
      continueLine = undefined
      setWaiting(false)
      recordStep({ k: 'l' })
      markRead(key)
      // "Voices play to the end": the clip goes on until the next one starts.
      if (voices.length && !useSettingsStore.getState().voiceKeep) audio.stopVoice()
      set((s) => {
        if (s.scene.line?.id === id) s.scene.line.advanced = true
      })
      resolve()
    }
  })
}

function choice(
  options: readonly ChoiceOption[] | Record<string, ChoiceOption>,
  settings: ChoiceSettings<string | number> = {},
): Promise<number | string> {
  const waiting = afterCard(() => choice(options, settings))
  if (waiting) return waiting
  const isList = Array.isArray(options)
  const all: [string | number, ChoiceOption][] = isList
    ? options.map((option, i) => [i, option])
    : Object.entries(options)
  // Hidden options are left out; disabled ones show (greyed, with their reason) but can't be picked.
  const visible = all
    .map(([key, option]) => ({
      key,
      option: typeof option === 'string' ? { label: option } : option,
    }))
    .filter(({ option }) => !option.hidden)
  // "Picked before" is remembered like read lines: per event and answer text, across saves.
  const choiceEvent = useSystemStore.getState().event?.stack[0] ?? ''
  const chosenKey = (label: string) => lineKey(choiceEvent, `choice:${label}`)
  const views: ChoiceView[] = visible.map(({ option }) => ({
    label: t(option.label),
    ...(scenes.choices.markChosen && isRead(chosenKey(option.label)) ? { chosen: true } : {}),
    disabled:
      option.disabled === undefined || option.disabled === false
        ? null
        : typeof option.disabled === 'string'
          ? t(option.disabled)
          : '',
  }))
  const enabled = views.findIndex((v) => v.disabled === null)
  if (enabled === -1) {
    console.warn('[event] choice() has no option that can be picked; using the first one')
    return Promise.resolve(visible[0]?.key ?? all[0]?.[0] ?? (isList ? 0 : ''))
  }
  const fallback =
    settings.default === undefined
      ? enabled
      : Math.max(
          0,
          visible.findIndex((v) => v.key === settings.default),
        )
  const replayed = takeStep('c')
  if (replayed) {
    recordStep(replayed)
    return Promise.resolve(replayed.v)
  }
  // Dev start: a choice before the marker takes its default answer.
  if (isRushing()) {
    const key = visible[fallback]?.key ?? fallback
    recordStep({ k: 'c', v: key })
    return Promise.resolve(key)
  }
  const timeout = settings.timeout && settings.timeout > 0 ? settings.timeout : null
  const resumeSkip = playback.pauseAtChoice() // skipping always stops at choices
  set((s) => {
    s.scene.choices = views
    s.scene.choiceTimer = timeout ? { ms: timeout, startedAt: Date.now() } : null
  })
  // After the answers are in: the end of Back (replay.ts) redraws the scene with them.
  setWaiting(true)
  selfVoicing.speak(views.map((v) => v.label).join('. '), { interrupt: false })
  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    choose = (index) => {
      if (views[index]?.disabled !== null) return
      clearTimeout(timer)
      choose = undefined
      setWaiting(false)
      recordStep({ k: 'c', v: visible[index]?.key ?? '' })
      const picked = visible[index]?.option.label
      if (picked !== undefined) markRead(chosenKey(picked))
      set((s) => {
        s.scene.choices = null
        s.scene.choiceTimer = null
      })
      resumeSkip()
      resolve(visible[index]?.key ?? '')
    }
    // Out of time: the default (or first possible) option is chosen.
    // A window open over the scene (e.g. Save) pauses the timer: check again shortly.
    const expire = () => {
      if (useSystemStore.getState().windows.length > 0) timer = setTimeout(expire, 500)
      else choose?.(fallback)
    }
    if (timeout) timer = setTimeout(expire, timeout)
  })
}

/** The commands given to event scripts. */
export const sceneApi: SceneApi = {
  say: ((who: string | readonly string[], text: string, options?: Record<string, unknown>) => {
    // 'anna:happy' = Anna, switching to (and showing) her happy pose. A list = said together.
    const ids = (typeof who === 'string' ? [who] : who).map((one) => {
      const [id, pose] = one.split(':', 2) as [CharacterId, string | undefined]
      if (pose) sceneApi.show(id, { pose } as never)
      return id
    })
    return line(ids, text, options)
  }) as SceneApi['say'],
  narrate: ((text: string, options?: Record<string, unknown>) =>
    line([], text, options)) as SceneApi['narrate'],
  choice: choice as SceneApi['choice'],

  show(
    who,
    options: {
      pose?: string
      parts?: object
      at?: StagePosition
      flip?: boolean
      scale?: number
      y?: number
      offsetX?: number
      distance?: string
      frame?: readonly [number, number]
      tint?: SceneFilter | null
    } = {},
  ) {
    const info = character(who)
    const poses = info.spine?.expressions ?? info.layered?.expressions ?? info.portraits
    const defaultPose = poses ? (Object.keys(poses)[0] ?? null) : null
    const parts = (options.parts ?? {}) as Record<string, string | null>
    const existing = useSystemStore.getState().scene.actors.find((a) => a.id === who)
    const at = options.at ?? existing?.at ?? defaultStagePosition()
    const distances: Record<string, { scale: number; y?: number }> = scenes.stage.distances
    const distance = options.distance === undefined ? undefined : distances[options.distance]
    if (options.distance !== undefined && !distance)
      console.warn(
        `[events] show("${who}"): no distance "${options.distance}" in content/scenes.ts`,
      )
    const framed = options.frame ? frameFx(who, options.frame) : undefined
    // New characters fade in; moving ones slide (see effects.ts).
    placeActor(
      who,
      at,
      !existing,
      // `frame` is a scale and y (computed for this character); `scale` / `y` given too win.
      {
        scale: options.scale ?? framed?.scale,
        y: options.y ?? framed?.y,
        offsetX: options.offsetX,
      },
      framed ? undefined : distance && { scale: distance.scale, y: distance.y ?? 0 },
    )
    if (!existing) notePictureShown(characterUrls(who))
    set((s) => {
      const actor = s.scene.actors.find((a) => a.id === who)
      if (actor) {
        if (options.pose !== undefined) {
          actor.pose = options.pose
          // The new expression wins for the parts it sets; other changes (e.g. an outfit) stay.
          const setByExpression =
            info.spine?.expressions[options.pose]?.parts ??
            info.layered?.expressions[options.pose] ??
            {}
          for (const part of Object.keys(setByExpression)) delete actor.parts[part]
        }
        Object.assign(actor.parts, parts)
        actor.at = at
        if (options.flip !== undefined) actor.flip = options.flip
        if (options.tint !== undefined) actor.tint = options.tint
      } else {
        s.scene.actors.push({
          id: who,
          pose: options.pose ?? defaultPose,
          parts,
          at,
          flip: options.flip ?? false,
          ...(options.tint !== undefined ? { tint: options.tint } : {}),
        })
      }
    })
  },

  hide(who) {
    const gone = who ? [who] : useSystemStore.getState().scene.actors.map((a) => a.id)
    for (const id of gone) removeActor(id)
    set((s) => {
      s.scene.actors = who ? s.scene.actors.filter((a) => a.id !== who) : []
    })
  },

  animate: (who, to, options) => animate(who, to, options),
  camera: (to, options) => moveCamera(to, options),
  shake: (options) => shake(options),
  startShake: (strength) => startShake(strength),
  stopShake: (duration) => stopShake(duration),
  flash: (color, duration) => flash(color, duration),
  fade: (color, duration) => fade(color, duration),

  background(value, options) {
    setBackground(value, options)
    if (value) notePictureShown([value])
    set((s) => {
      s.scene.backgroundRef = null
    })
  },

  bg(id, ...rest) {
    const [given, options] = rest as [string | null | undefined, BackgroundOptions | undefined]
    const key = String(id)
    const variant = given ?? undefined
    const config = backgrounds[key]
    const named = Object.keys(config?.variants ?? {})
    // Like a layered CG: with variants it has only those (`base: {}` = no toggles on).
    if (!config || (named.length > 0 && (variant === undefined || !named.includes(variant)))) {
      console.warn(
        config
          ? `[events] bg('${key}'${variant ? `, '${variant}'` : ''}): name one of its variants: ${named.join(', ')}`
          : `[events] bg('${key}'): no such background in src/content/backgrounds`,
      )
      return
    }
    const shown = cgPicture(config, named.length > 0 ? variant : undefined, lang.current())
    setBackground(shown, options)
    notePictureShown(pictureUrls(shown))
    set((s) => {
      s.scene.backgroundRef = { kind: 'bg', id: key, ...(variant ? { variant } : {}) }
    })
  },

  inset(id, ...rest) {
    const [given, options] = rest as unknown as [
      string | null | undefined,
      InsetOptions | undefined,
    ]
    // Fast-forward (Back, a mid-scene load): it is simply there, no fade.
    const fade = isFastForward() || isUnderCard() ? 0 : (options?.duration ?? INSET_FADE_MS)
    if (id === null) {
      set((s) => {
        s.scene.inset = null
        s.scene.insetFade = fade
      })
      return
    }
    const key = String(id)
    const variant = given ?? undefined
    const config = insets[key]
    const named = Object.keys(config?.variants ?? {})
    // Like bg(): with variants it has only those.
    if (!config || (named.length > 0 && (variant === undefined || !named.includes(variant)))) {
      console.warn(
        config
          ? `[events] inset('${key}'${variant ? `, '${variant}'` : ''}): name one of its variants: ${named.join(', ')}`
          : `[events] inset('${key}'): no such picture in src/content/insets`,
      )
      return
    }
    const picture = cgPicture(config, named.length > 0 ? variant : undefined, lang.current())
    notePictureShown(pictureUrls(picture))
    set((s) => {
      s.scene.inset = { id: key, ...(variant ? { variant } : {}), picture }
      s.scene.insetFade = fade
    })
  },

  cg(id, ...rest) {
    const [variant, options] = rest as unknown as [
      string | undefined,
      BackgroundOptions | undefined,
    ]
    const picture = id ? (gallery as Record<string, GalleryConfig>)[id] : undefined
    if (!id || !picture) {
      setBackground(null)
      set((s) => {
        s.scene.backgroundRef = null
      })
      return
    }
    const shown = cgPicture(picture, variant, lang.current())
    setBackground(shown, options)
    set((s) => {
      s.scene.backgroundRef = { kind: 'cg', id, ...(variant ? { variant } : {}) }
    })
    // With variants, only named ones are in the gallery: the unnamed plain picture unlocks nothing.
    const named = Object.keys(picture.variants ?? {})
    if (variant === undefined && named.length > 0) {
      if (import.meta.env.DEV)
        console.warn(
          `[gallery] cg('${id}') has variants (${named.join(', ')}): name one, e.g. ` +
            `cg('${id}', '${named[0]}'). Add base: {} to its variants for the plain picture.`,
        )
    } else {
      unlock(unlockKey.image(id, variant))
    }
    notePictureShown(pictureUrls(shown))
  },

  rename(who, name) {
    characterNames.rename(who, name)
  },

  reveal(who) {
    characterNames.reveal(who)
  },

  filter(value: SceneFilter | null, { on = 'all' }: { on?: FilterTarget } = {}) {
    set((s) => {
      if (on === 'all') s.scene.filter = value
      else if (on === 'background' || on === 'characters') s.scene.partFilters[on] = value
      else {
        const actor = s.scene.actors.find((a) => a.id === on)
        if (actor) actor.tint = value
        else
          console.warn(
            `[events] filter(…, { on: "${on}" }): "${on}" is not on stage (show() them first)`,
          )
      }
    })
  },

  movie(src: string, { unlock: unlocks = true, ...played }: MoviePlayOptions = {}) {
    // Loading a mid-scene save, going back a line, or skipping: the movie is not shown again.
    if (isFastForward() || isSkippingEffects()) return Promise.resolve()
    // A movie from src/content/movies: its own file and options; it unlocks in Extras → Movies.
    // Cast, not annotated: with no movies at all the lookup is `never` and would narrow `def` away.
    const def = (Object.hasOwn(movies, src) ? movies[src as MovieId] : undefined) as
      | MovieConfig
      | undefined
    if (def && unlocks) unlock(unlockKey.movie(src))
    const { title: _title, video, poster: _poster, ...own } = def ?? { title: '', video: src }
    const options = { ...own, ...played }
    src = video
    finishMovie?.()
    const id = ++movieId
    const release = options.keepMusic ? undefined : audio.duck(0, 400)
    set((s) => {
      s.scene.movie = { ...options, id, src }
    })
    return new Promise<void>((resolve) => {
      finishMovie = () => {
        finishMovie = undefined
        release?.()
        set((s) => {
          if (s.scene.movie?.id === id) s.scene.movie = null
        })
        resolve()
      }
    })
  },

  async image(name: string, src: string | null, options: ImageOptions = {}) {
    const instant = isFastForward() || isSkippingEffects()
    const duration = instant ? 0 : Math.max(0, options.duration ?? 300)
    const run = sceneRun
    if (src === null) {
      set((s) => {
        const image = s.scene.images.find((i) => i.name === name)
        if (image) Object.assign(image, { leaving: true, duration })
      })
      await pause(duration)
      if (run === sceneRun)
        set((s) => {
          s.scene.images = s.scene.images.filter((i) => !(i.name === name && i.leaving))
        })
      return
    }
    notePictureShown([src])
    set((s) => {
      const existing = s.scene.images.find((i) => i.name === name)
      if (existing) {
        Object.assign(existing, options, { src, duration, leaving: false })
      } else {
        s.scene.images.push({
          name,
          src,
          x: options.x ?? 50,
          y: options.y ?? 50,
          width: options.width ?? (options.height === undefined ? 40 : undefined),
          height: options.height,
          opacity: options.opacity ?? 1,
          scale: options.scale ?? 1,
          rotate: options.rotate ?? 0,
          layer: options.layer ?? 'front',
          pixelated: options.pixelated ?? false,
          duration,
        })
      }
    })
    await pause(duration)
  },

  async clearImages(duration?: number) {
    const names = useSystemStore.getState().scene.images.map((i) => i.name)
    await Promise.all(names.map((name) => sceneApi.image(name, null, { duration })))
  },

  weather(kind, options) {
    set((s) => {
      s.scene.weather = kind
        ? { kind, intensity: options?.intensity ?? weatherConfig.defaultIntensity }
        : null
    })
  },

  move(who, name) {
    const steps = (scenes.moves as Record<string, readonly MoveStep[]>)[name]
    if (!steps) {
      console.warn(`[events] move("${who}", "${name}"): no such move in src/content/scenes.ts`)
      return Promise.resolve()
    }
    return playMove(who, steps)
  },

  ending(id) {
    getGame().extras.reachEnding(id)
  },

  async chapter(id) {
    getGame().chapters.reach(id)
    await chapterCardCovered()
  },

  nvl(on = true) {
    set((s) => {
      if (s.scene.nvl === on) return
      s.scene.nvl = on
      s.scene.page = []
      // The last line of the other mode must not hang around.
      if (s.scene.line?.advanced) s.scene.line = null
    })
  },

  clearPage() {
    set((s) => {
      s.scene.page = []
      if (s.scene.line?.page && s.scene.line.advanced) s.scene.line = null
    })
  },

  async input(prompt: string, options: InputOptions = {}): Promise<string> {
    const waiting = afterCard(() => sceneApi.input(prompt, options))
    if (waiting) return waiting
    const replayed = takeStep('i')
    if (replayed) {
      recordStep(replayed)
      return replayed.v
    }
    // Dev start: typed text before the marker is its default.
    if (isRushing()) {
      const value = options.default?.trim() || 'Dev'
      recordStep({ k: 'i', v: value })
      return value
    }
    playback.stopSkip()
    const run = sceneRun
    const fallback = options.default ?? ''
    // Asked again until there is an answer (the window can't be cancelled, but it can be replaced).
    for (;;) {
      const typed = await dialog.prompt(t(prompt), {
        ...options,
        ...(options.title ? { title: t(options.title) } : {}),
        ...(options.placeholder ? { placeholder: t(options.placeholder) } : {}),
        cancellable: false,
      })
      const value = typed || fallback
      if (value && run === sceneRun) {
        recordStep({ k: 'i', v: value })
        return value
      }
      // The event was stopped (a save was loaded): don't ask again.
      if (run !== sceneRun) return fallback
    }
  },
}

function setBackground(value: string | StackedPicture | null, options: BackgroundOptions = {}) {
  // A mask needs time to be seen: none while skipping or catching up with a save.
  // Under a chapter card (scene/chapterCard.ts) nobody sees it: at once.
  const instant = instantBackground || isFastForward() || isSkippingEffects() || isUnderCard()
  const mask = instant || !value ? undefined : options.transition
  // Fast-forward (Back, a mid-scene load): the stage is redrawn once at the end, so a fade would
  // only show the picture coming in again.
  const fade =
    instantBackground || isFastForward() || isUnderCard()
      ? 0
      : (options.duration ??
        (mask ? maskTransition(mask)?.duration : undefined) ??
        DEFAULT_BACKGROUND_FADE)
  instantBackground = false
  set((s) => {
    s.scene.background = value
    s.scene.backgroundFade = fade
    s.scene.backgroundTransition = mask && fade > 0 ? mask : null
  })
}

/** A wait that scene commands use for their own fades (0 = no wait at all). */
function pause(ms: number): Promise<void> {
  return ms > 0 ? wait(ms) : Promise.resolve()
}

/**
 * Forgets log lines: those of one scene run (it is about to be replayed after "Back" / a jump, and
 * would show twice), or all of them (another save was loaded).
 */
export function forgetLog(fromRun?: number) {
  set((s) => {
    s.scene.log =
      fromRun === undefined
        ? []
        : s.scene.log.filter((entry) => entry.at === undefined || entry.at.run < fromRun)
  })
}

/** UI: the player continues past the current line. */
export function advance() {
  continueLine?.()
}

/** UI: the movie with this id ended, failed to play, or the player skipped it. */
export function endMovie(id: number) {
  if (useSystemStore.getState().scene.movie?.id === id) finishMovie?.()
}

/** UI: the player picked option `index`. */
export function pick(index: number) {
  choose?.(index)
}

/** Clears the stage after an event (keeps the log). */
/** The stage the last event ended on (a route choice() shows over it). */
/**
 * Clears the scene after an event. While a route plays (VN mode) the stage stays as the event left
 * it (background, characters, pictures, weather, filter, fade colour): the next event, or a route
 * choice, goes on from there. Lines, choices, full-page text and movies always go.
 */
export function resetScene() {
  const keepStage = useGameStore.getState().route != null
  instantBackground = false
  sceneRun++
  continueLine = undefined
  choose = undefined
  // A movie still playing ends with its event (its promise resolves; an aborted script ignores it).
  finishMovie?.()
  selfVoicing.stop()
  playback.sceneEnded()
  resetEffects({ keepStage })
  set((s) => {
    const before = s.scene
    s.scene = emptyScene(before.log)
    if (keepStage) {
      s.scene.background = before.background
      s.scene.backgroundRef = before.backgroundRef
      s.scene.backgroundFade = 0
      s.scene.actors = before.actors
      s.scene.filter = before.filter
      s.scene.partFilters = before.partFilters
      s.scene.images = before.images.filter((image) => !image.leaving)
      s.scene.weather = before.weather
    }
  })
}
