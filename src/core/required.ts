// Content the engine opens by itself. Plain data (no imports): vite/registry.ts reads it too.

/** Windows the engine always needs: `pnpm gen` / the dev server / a build stop without them. */
export const REQUIRED_WINDOWS: Record<string, string> = {
  menu: 'the ☰ button and the Back button',
  confirm: 'yes / no questions (quick load, quitting, overwriting a save…)',
  saves: 'saving and loading',
}

/** Content needed only by one feature: a clear error when that feature is used without it. */
export const FEATURE_CONTENT: Record<string, Record<string, string>> = {
  windows: {
    shop: 'game.shops.open()',
    crafting: 'crafting stations (game.crafting.open())',
    travel: 'fast travel (game.travel.open())',
    gameover: 'game over (a lost battle, game.gameOver())',
    textinput: 'asking for text (game.dialog.text())',
  },
  minigames: {
    battle: 'battles (game.battles.start(), random encounters)',
    extras: 'the Extras screen (gallery, scene replay, music room, movies...)',
    after_stories: 'the After Stories screen (VN mode, src/content/start.ts)',
  },
  events: {
    'extras/choice': 'choices in a route (choice() in src/content/routes)',
    'extras/movie': 'movies in a route and in the Extras movie tab',
  },
  routes: {
    common: 'VN mode: every new game starts this route',
  },
}

/**
 * Engine content kept by `pnpm setup:project` (scripts/setup-project.ts): everything above, as
 * paths under src/content. The engine's own screens and scenes, never the demo game.
 */
export function engineContentPaths(): string[] {
  const paths = Object.keys(REQUIRED_WINDOWS).map((id) => `windows/${id}`)
  for (const [kind, ids] of Object.entries(FEATURE_CONTENT))
    for (const id of Object.keys(ids)) paths.push(`${kind}/${id}`)
  return paths
}

/** The error for content that is missing. */
export function missingContentMessage(kind: string, id: string): string {
  const always = kind === 'windows' ? REQUIRED_WINDOWS[id] : undefined
  if (always) {
    return `src/content/${kind}/${id} is missing: the engine always opens it, for ${always}. Put it back (it may look and work however you like; only its folder name matters).`
  }
  const feature = FEATURE_CONTENT[kind]?.[id]
  if (feature) {
    return `src/content/${kind}/${id} is missing: ${feature} needs it. Put it back, or don't use that feature.`
  }
  return `Unknown ${kind} entry "${id}"`
}
