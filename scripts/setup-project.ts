// pnpm setup:project: starts a new game from this repository. It asks which kind of game it is
// (visual novel only, or the game with maps), then removes the demo game from src/content, so the
// new game starts from a clean slate that still typechecks, builds and starts. Nothing is changed
// until a kind is picked: Ctrl+C, Ctrl+D or an empty answer exits without touching any file.
//   - Kept: the engine's own content (src/core/required.ts: the windows, minigames, events and the
//     'common' route it opens by itself), every window, ui/, look/, config/, boot/, titles/, fonts/,
//     the UI sounds (audio/sfx) and the root settings files.
//   - Removed: the demo's maps, events, characters, items, quests, battles, routes, art and sounds,
//     and the tests that run on them (*.demo.test.ts(x)).
//   - Written: a tiny starter. New game puts the player (characters/hero) on an empty map
//     (maps/start). In VN mode the 'common' route starts empty. Lists in the root files that named
//     demo content (travel places, recipes, music room, flags, chapters...) are emptied.
//   - Symbolic links (or Windows junctions) anywhere in the folders it works in stop it before
//     anything else: the project never has any, and deleting through one could reach files outside.
// Undo: `git checkout -- src/content && git clean -fd src/content`.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { createInterface } from 'node:readline/promises'
import { engineContentPaths } from '../src/core/required.ts'

const CONTENT = path.resolve('src/content')

/** Folders emptied, apart from the paths in KEEP. */
const WIPE = [
  'achievements',
  'audio/ambient',
  'audio/music',
  'audio/system_voice',
  'audio/voice',
  'backgrounds',
  'characters',
  'codex',
  'endings',
  'enemies',
  'events',
  'gallery',
  'items',
  'lang/ja',
  'lang/pl',
  'maps',
  'minigames',
  'movies',
  'props',
  'quests',
  'routes',
  'shops',
  'skills',
  'structures',
  'tilesets',
  'troops',
  'variants',
]

/** Kept inside the wiped folders: the engine's own content, and what the starter builds on. */
const KEEP = new Set([
  ...engineContentPaths(),
  'characters/hero/sprites', // the player's map sprite (src/content/config/player.ts)
  'tilesets/heaven.png', // the starter map's tiles
  'tilesets/heaven.tsj',
])

/**
 * Tests that run on the demo game (its items, maps, recipes, chapters, translations, sounds) end in
 * .demo.test.ts(x). They go with the demo, so they can never fail in a game built from a wiped copy.
 */
const TEST_FOLDERS = ['src', 'vite', 'scripts', 'electron']

/** Every *.demo.test.* file under the folder. */
function demoTests(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && /\.demo\.test\.tsx?$/.test(e.name))
    .map((e) => path.join(e.parentPath, e.name))
}

const rel = (file: string) => path.relative(CONTENT, file).split(path.sep).join('/')

/** Deletes everything under `dir` except the KEEP paths (and the folders that lead to them). */
function wipe(dir: string) {
  if (!existsSync(dir)) return
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    const at = rel(full)
    if (KEEP.has(at)) continue
    if (entry.isDirectory() && [...KEEP].some((k) => k.startsWith(`${at}/`))) {
      wipe(full)
      continue
    }
    rmSync(full, { recursive: true, force: true })
  }
}

/** Writes a file under src/content (folders made as needed). */
function write(file: string, text: string) {
  const full = path.join(CONTENT, file)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, text)
}

/** One change to a root file: replace `from` (must be found) with `to`. */
type Edit = [file: string, from: string | RegExp, to: string]

const found = ([file, from]: Edit) => {
  const text = readFileSync(path.join(CONTENT, file), 'utf8')
  return typeof from === 'string' ? text.includes(from) : from.test(text)
}

function apply([file, from, to]: Edit) {
  const full = path.join(CONTENT, file)
  writeFileSync(
    full,
    readFileSync(full, 'utf8').replace(from, () => to),
  )
}

// ---- Ask first: nothing changes before a kind of game is picked ----

/** VN mode (true) or the game with maps (false); null = cancelled. */
async function askMode(): Promise<boolean | null> {
  if (!process.stdin.isTTY) {
    console.log('pnpm setup:project asks a question: run it in a terminal.')
    return null
  }
  console.log(
    [
      'This removes the demo game from src/content and starts your game from a clean slate.',
      '(Undo: git checkout -- src/content && git clean -fd src/content)',
      '',
      'Which kind of game is it?',
      '  1  Visual novel: scenes, choices, routes and a flowchart (VN mode)',
      '  2  Game with maps: walk around, NPCs, items, quests, battles (VN scenes work here too)',
      '',
    ].join('\n'),
  )
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  // Ctrl+C or Ctrl+D: stop right here.
  const cancelled = new Promise<null>((resolve) => {
    rl.on('SIGINT', () => resolve(null))
    rl.on('close', () => resolve(null))
  })
  const answer = await Promise.race([
    rl.question('Pick 1 or 2 (anything else cancels): '),
    cancelled,
  ])
  rl.close()
  const picked = answer?.trim()
  if (picked === '1') return true
  if (picked === '2') return false
  return null
}

/** --check (scripts/setup-project.demo.test.ts): only checks that the script still fits src/content. */
const CHECK = process.argv.includes('--check')

/** Every symbolic link (or junction) at or under `dir`. Links are listed, never followed. */
function links(dir: string): string[] {
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(dir)
  } catch {
    return []
  }
  if (stat.isSymbolicLink()) return [dir]
  if (!stat.isDirectory()) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isSymbolicLink()) return [full]
    return entry.isDirectory() ? links(full) : []
  })
}

// A link is a red flag: this project never has one, and this script deletes files. Stop first.
const linked = TEST_FOLDERS.flatMap((dir) => links(path.resolve(dir)))
if (linked.length > 0) {
  console.error('STOP: symbolic links found! Nothing was changed.')
  console.error(
    'This project never contains links, and pnpm setup:project deletes files: through a link it could delete files outside the project.',
  )
  for (const link of linked) {
    let target = '?'
    try {
      target = readlinkSync(link)
    } catch {}
    console.error(`  ${path.relative(process.cwd(), link)} -> ${target}`)
  }
  console.error('')
  console.error('Safest: make a fresh clone of the repository and run pnpm setup:project there.')
  console.error('Or, if this copy has work you want to keep: find out why the links are there,')
  console.error('remove them, and run it again.')
  process.exit(1)
}

// Run once: the starter map is the sign the demo is already gone.
if (existsSync(path.join(CONTENT, 'maps/start'))) {
  console.log(
    'The demo game is already removed (src/content/maps/start exists). Nothing was changed.',
  )
  console.log('Switch the kind of game in src/content/config/mode.ts (vnOnly).')
  process.exit(CHECK ? 1 : 0)
}

const vnOnly = CHECK ? true : await askMode()
if (vnOnly === null) {
  console.log('\nCancelled. Nothing was changed.')
  process.exit(0)
}

// Root files that named demo content. Every one is checked BEFORE anything is deleted: when a file
// changed and a part can't be found, nothing is touched (update this script).
const edits: Edit[] = [
  ['save/index.ts', /return game\.maps\.go\('[^']*'/, "return game.maps.go('start'"],
  ['start.ts', /game\.maps\.preload\('[^']*'\)/, "game.maps.preload('start')"],
  ['travel.ts', "import { tx } from '@/core/lang'\n", ''],
  ['travel.ts', /blockedMaps: \[[^\]]*\],/, 'blockedMaps: [],'],
  ['travel.ts', /\n {2}places: \{[\s\S]*\n {2}\},\n\}\)/, '\n  places: {},\n})'],
  ['recipes.ts', /\n {2}recipes: \{[\s\S]*\n {2}\},\n\}\)/, '\n  recipes: {},\n})'],
  ['ambient.ts', /weather: \{[^}]*\}/, 'weather: {}'],
  ['scenes.ts', /tracks: \[[\s\S]*?\] satisfies/, 'tracks: [] satisfies'],
  ['flags.ts', /defineFlags\(\{[\s\S]*?\n\}\)/, 'defineFlags({})'],
  ['chapters.ts', /\n {2}chapters: \{[\s\S]*\n {2}\},\n\}\)/, '\n  chapters: {},\n})'],
  ['config/mode.ts', /vnOnly: (true|false),/, `vnOnly: ${vnOnly},`],
]
const missing = edits.filter((e) => !found(e))
// Kept paths must exist too (the engine's own content, the starter's sprite and tiles).
const lost = [...KEEP].filter((p) => !existsSync(path.join(CONTENT, p)))
for (const p of lost) console.error(`src/content/${p} is missing (kept by this script)`)
if (missing.length > 0 || lost.length > 0) {
  for (const [file, from] of missing)
    console.error(`src/content/${file}: could not find ${String(from)}`)
  console.error(
    'These files changed since scripts/setup-project.ts was written: update the script. Nothing was changed.',
  )
  process.exit(1)
}
if (CHECK) {
  console.log('setup:project fits src/content.')
  process.exit(0)
}

// ---- Remove the demo ----

for (const folder of WIPE) wipe(path.join(CONTENT, folder))
for (const file of TEST_FOLDERS.flatMap((dir) => demoTests(path.resolve(dir)))) rmSync(file)
console.log('Removed the demo game from src/content.')

// ---- The starter ----

write(
  'characters/hero/index.ts',
  `import { defineCharacter } from '@/core/define'
// Map sprite (also the player's, see content/config/player.ts).
import sprite from './sprites/hero.gen'

// The player. Give them a name, and portraits (src/content/characters/<id>/portraits) when the game
// needs them.
export default defineCharacter({
  name: 'Me',
  color: '#ffd54f',
  sprite,
  // Party member stats (src/content/stats.ts). Skills: battle.skills, from src/content/skills.
  battle: {
    base: { hp: 32, mp: 8, attack: 6, defense: 4, magic: 2, resistance: 3, speed: 5, luck: 4 },
    growth: {
      hp: 6,
      mp: 2,
      attack: 1.5,
      defense: 1,
      magic: 0.4,
      resistance: 0.6,
      speed: 0.8,
      luck: 0.5,
    },
  },
})
`,
)

write(
  'maps/start/index.ts',
  `import { defineMap } from '@/core/define'
import tiled from './start.gen'

// The first map: the player starts on its 'start' spawn (src/content/save/index.ts). Draw it in
// Tiled (start.tmx), or make your own maps next to it.
export default defineMap({
  title: 'Start',
  background: '#94e3ea',
  tiled,
})
`,
)

/** A 12 x 8 floor framed by the heaven tileset's edges (tiles 1-9: top, middle, bottom rows). */
function starterMap(): string {
  const width = 12
  const height = 8
  const rows: string[] = []
  for (let y = 0; y < height; y++) {
    const band = y === 0 ? 0 : y === height - 1 ? 6 : 3
    const row: number[] = []
    for (let x = 0; x < width; x++) row.push(band + (x === 0 ? 1 : x === width - 1 ? 3 : 2))
    rows.push(row.join(','))
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<map version="1.10" tiledversion="1.12.2" orientation="orthogonal" renderorder="right-down" width="${width}" height="${height}" tilewidth="16" tileheight="16" infinite="0" nextlayerid="3" nextobjectid="2">
 <tileset firstgid="1" source="../../tilesets/heaven.tsj"/>
 <layer id="1" name="Ground" width="${width}" height="${height}">
  <data encoding="csv">
${rows.join(',\n')}
</data>
 </layer>
 <objectgroup id="2" name="Objects">
  <object id="1" name="start" type="spawn" x="${(width * 16) / 2}" y="${(height * 16) / 2}">
   <properties>
    <property name="facing" value="down"/>
   </properties>
   <point/>
  </object>
 </objectgroup>
</map>
`
}
write('maps/start/start.tmx', starterMap())

rmSync(path.join(CONTENT, 'routes/common'), { recursive: true, force: true })
write(
  'routes/common/index.ts',
  `// VN mode (src/content/config/mode.ts): every new game starts this route. Each
// \`await event('<event id>')\` is one scene and one box on the flowchart (docs: story/routes.html).
import { defineRoute } from '@/core/define'

export default defineRoute({
  title: 'Common',
  run: async () => {
    // await event('intro')
  },
})
`,
)

// ---- Root files that named demo content ----

for (const e of edits) apply(e)

console.log('Wrote a starter: maps/start, the player (characters/hero), an empty common route.')
console.log(
  vnOnly
    ? 'VN mode: new games start src/content/routes/common. Add your first scene there.'
    : 'Game with maps: new games start on src/content/maps/start (src/content/save/index.ts).',
)
console.log('Next: pnpm typecheck && pnpm dev:browser')
