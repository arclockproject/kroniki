// Events, minigames, windows and characters. Part of core/define.ts (import from there).

import type { ComponentType } from 'react'
import type { Game } from '../game'
import type { FaceArea, LayeredPortrait } from '../portrait/define'
import type { SpinePortrait } from '../portrait/spine'
import type { AudioId, EventId, EventParams } from '../registry'
import type { SceneApi } from '../scene/types'
import type { AsepriteSpriteData } from '../sprite/types'
import type { VariantValue } from '../variants'
import type { ParamArgs, Typed } from './base'
import type { BattleStats } from './battle'

// ---------------------------------------------------------------- events

/** Everything an event script gets: say, narrate, choice, show, hide, background, filter, … */
export interface EventContext<P> extends SceneApi {
  params: P
  game: Game
  /** Resolves after `ms` milliseconds. */
  wait: (ms: number) => Promise<void>
  /**
   * A random number 0..1. Use this instead of Math.random() in events: saves made mid-scene
   * replay the scene, and this gives the same numbers again.
   */
  random: () => number
  /**
   * Runs another event inside this one (same scene, no fade) and waits for it to finish.
   * Loops are refused: an event cannot run itself, directly or through other events
   * (A → B → A). Use a `while` loop inside one event for repeating menus.
   */
  event: <K extends EventId>(id: K, ...params: ParamArgs<EventParams<K>>) => Promise<void>
}

/** An event's card in Extras → Scenes. */
export interface ReplayConfig {
  title: string
  /** Picture on the card (an imported image). Shown once the scene is unlocked. */
  preview?: string
}

export interface EventConfig<P = void> {
  /** Only in the version of the game built with this content variant (src/content/config/variants.ts); left out of the others. */
  only?: VariantValue
  /** Shown on saves made during this event (like a map's title). `title <text>` in a .vn file. */
  title: string
  /**
   * Replayable from the Extras window once the player has finished it: a title, or
   * `{ title, preview }` with a picture for its card (`import preview from '../preview.png'`).
   * Without a preview the card shows the first CG or background the event uses.
   * Replays don't change the game (it is restored afterwards).
   */
  replay?: string | ReplayConfig
  /**
   * What the event leaves behind, without playing it: a flowchart jump runs this for events on the
   * way (a `sets` in the route's flow.ts wins). .vn scripts get it by themselves from their set /
   * love / money / give… lines; `partial` = some of it could not be worked out (a choice, an `if`
   * on a scene variable): write a `sets` in flow.ts for that box.
   */
  leaves?: { run: (game: Game) => void; partial?: boolean }
  /**
   * The script. Write it as `async (ctx) => { ... }`. Typed as returning `void` on purpose
   * (the engine awaits it): events that run each other then never form circular types.
   */
  run: (ctx: EventContext<P>) => void
}

export type EventDefinition<P = void> = EventConfig<P> & Typed<P>

export { defineEnding, type EndingConfig } from '../endings'
export {
  type BackgroundConfig,
  defineBackground,
  defineGallery,
  type GalleryConfig,
  type LayeredCg,
} from '../gallery'
export { defineMovie, type MovieConfig } from '../movies'

export function defineEvent<P = void>(config: EventConfig<P>): EventDefinition<P> {
  return config as EventDefinition<P>
}

// ---------------------------------------------------------------- minigames

export interface MinigameProps<P = void, R = void> {
  params: P
  /** Ends the minigame. The value is returned to whoever called game.minigames.start(). */
  finish: (result: R) => void
}

export interface MinigameConfig<P = void, R = void> {
  component: ComponentType<MinigameProps<P, R>>
  /**
   * If set, the cancel action (Esc / B) quits the minigame with this result.
   * Leave it out for minigames the player must finish.
   */
  quitResult?: NoInfer<R>
  /**
   * false = no pause menu button (☰) over this minigame (Extras: it has its own ✕ and takes the
   * menu button itself). Default true.
   */
  menuButton?: boolean
}

export type MinigameDefinition<P = void, R = void> = MinigameConfig<P, R> & Typed<P, R>

export function defineMinigame<P = void, R = void>(
  config: MinigameConfig<P, R>,
): MinigameDefinition<P, R> {
  return config as MinigameDefinition<P, R>
}

// ---------------------------------------------------------------- windows

/** A window's way in and out (defineWindow `transition`). */
export interface WindowTransition {
  /** Coming in, ms. Default 0 (at once). */
  in?: number
  /** Going out, ms. Default 0 (at once). The window takes no input while it goes. */
  out?: number
  /**
   * 'fade' (default), 'scale' (grows from a little smaller), or a slide that also fades: 'slideUp'
   * (comes up from below), 'slideDown', 'slideLeft' (comes in from the right), 'slideRight'.
   * With "Reduce motion" every effect is a plain fade.
   */
  effect?: 'fade' | 'scale' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight'
  /** How far a slide moves, px. Default 24. */
  distance?: number
  /** CSS easing. Default 'ease'. */
  ease?: string
}

export interface WindowProps<P = void> {
  params: P
  close: () => void
}

export interface WindowConfig<P = void> {
  title: string
  component: ComponentType<WindowProps<P>>
  /** Minimum CSS width, e.g. 420 or '60cqw'. Grows to fit the content, never wider than the screen. Default 420. */
  width?: number | string
  /** Dims everything behind the window and blocks clicks to it. Default false. */
  modal?: boolean
  /** Shows the × button in the title bar. Default true. */
  closable?: boolean
  /**
   * How it comes in and goes out (like a boot screen's fades). Default: none, it just appears and
   * goes. { in: 200, out: 150, effect: 'slideUp' }.
   */
  transition?: WindowTransition
}

export type WindowDefinition<P = void> = WindowConfig<P> & Typed<P>

export function defineWindow<P = void>(config: WindowConfig<P>): WindowDefinition<P> {
  return config as WindowDefinition<P>
}

// ---------------------------------------------------------------- characters

declare const poseType: unique symbol
declare const characterPartsType: unique symbol
export type PosesOf<D> = D extends { readonly [poseType]: infer Pose extends string } ? Pose : never
/** Layer name -> option names of a character's layered portrait (never without one). */
export type PartsOf<D> = D extends { readonly [characterPartsType]: infer P } ? P : never
declare const spriteTagType: unique symbol
/** Tag names of a character's map sprite (never without one). */
export type SpriteTagsOf<D> = D extends { readonly [spriteTagType]: infer T extends string }
  ? T
  : never

/** Characters are loaded up front, so their files must not import `game`. */
export type CharacterConfig<Pose extends string = string, Parts = never> = {
  /** Shown instead of `name` until the game reveals it (game.characters.reveal). E.g. "???". */
  unknownName?: string
  name: string
  /** Name plate colour in dialogue (and the placeholder portrait). */
  color?: string
  /** Short sound played while their text types out (for lines without a voice clip). */
  blip?: AudioId
  /**
   * Their own chat box while they speak: names of looks from src/content/look/parts.ts, laid over
   * the normal ones. `box` = the chat box itself, `name` = the name tag (wins over `color`),
   * `text` = the text of their lines. Each is optional. Not used on full-page text (nvl).
   */
  chatBox?: { box?: string; name?: string; text?: string }
  /**
   * Gets a portrait, volume slider and mute button in Settings → Voices. Default: true when
   * they have a voice clip (src/content/audio/voice/<language>/<event id>/<their id>_<number>).
   */
  voiced?: boolean
  /**
   * Where the face is on their portrait, in portrait pixels (side image, Settings → Voices).
   * A square is best. A layered portrait's own box wins over this one (fromAseprite `faceArea`,
   * or the Aseprite "#face" layer). Default: the top of the portrait, full width.
   */
  faceArea?: FaceArea
  /**
   * How their portrait stands on the stage (like Ren'Py's anchor, position and zoom, in parts of
   * the picture instead of pixels). All optional.
   * - `show`: which part of the picture, top to bottom (0 = its top edge, 1 = its bottom edge),
   *   fills the portrait height (src/content/config/screen.ts stage.portraitHeight), that part's
   *   bottom on the screen's bottom edge. [0, 0.6] = head to waist, the legs go below the screen;
   *   [0.25, 1] = neck down fills it and the head sticks up above (with scale 1.3 it goes off
   *   the top of the screen). Only the screen's edges cut a picture.
   *   Default: config/screen.ts stage.show.
   * - `scale`: size next to the others (0.9 = a bit smaller). Default 1.
   * - `x`, `y`: a nudge in stage pixels (on a 720-tall screen; y > 0 = down). Default 0.
   * show() / animate() / distances still move and zoom them from there.
   */
  stage?: { show?: [number, number]; scale?: number; x?: number; y?: number }
  /** Relationship points (game.relationships): start value and limits. Default 0, -100..100. */
  relationship?: { start?: number; min?: number; max?: number }
  /** Stats as a party member (game.party). Without it the character can't join. */
  battle?: BattleStats
  /**
   * Drawn in battle (import from '../battle_sprite/<name>.gen'). Tags: idle (or idle_left /
   * idle_right, mirrored as needed), optionally hurt / attack / down. Default: the map sprite.
   */
  battleSprite?: AsepriteSpriteData
} & (
  | {
      /**
       * Simple portraits: one full image per pose, { neutral: annaNeutral, happy: annaHappy }.
       * The first is the default. Without any portraits a coloured placeholder is shown.
       */
      portraits?: Record<Pose, string>
      layered?: never
      spine?: never
    }
  | {
      /**
       * Layered portrait (defineLayeredPortrait): a base image plus parts (eyes, mouth, …).
       * Its expression names are the poses; its layers can be changed one by one with `parts`.
       */
      layered: LayeredPortrait<Pose, Parts>
      portraits?: never
      spine?: never
    }
  | {
      /**
       * Spine portrait (fromSpine with a Spine export): animated. Its expression names are the
       * poses; its parts (skins) can be changed with `parts`. One kind of portrait per character.
       */
      spine: SpinePortrait<Pose, Parts>
      portraits?: never
      layered?: never
    }
)

export type CharacterDefinition<
  Pose extends string = string,
  Parts = never,
  Tag extends string = never,
> = CharacterConfig<Pose, Parts> &
  CharacterSprite<Tag> & {
    readonly [poseType]: Pose
    readonly [characterPartsType]: Parts
    readonly [spriteTagType]: Tag
  }

/** Map sprite (sprites/name.gen.ts): what the character looks like on maps. */
interface CharacterSprite<Tag extends string> {
  /** Drawn on maps for objects with `character: '<id>'`; animations typed for npc(id).play(). */
  sprite?: AsepriteSpriteData<Tag>
}

export function defineCharacter<
  const Pose extends string = never,
  Parts = never,
  Tag extends string = never,
>(
  config: CharacterConfig<Pose, Parts> & CharacterSprite<Tag>,
): CharacterDefinition<Pose, Parts, Tag> {
  return config as CharacterDefinition<Pose, Parts, Tag>
}
