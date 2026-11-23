# Kroniki Engine

A game engine for **visual novels and story-driven RPGs**, built with React and PixiJS. Write scenes as plain text, draw maps in Tiled, and ship one game to desktop (Windows, Linux), Android and the browser, with keyboard, gamepad and touch support.

> **Status: early development.** The engine works and the demo shows what it can do, but APIs, content folders and save formats may still change between versions. Great for trying it out and for small projects, but expect some updates to your game when you upgrade.

| [**Play the demo**](https://kroniki.arclockproject.org/demo/) | [**Read the guide**](https://kroniki.arclockproject.org/) |
| --- | --- |
| See what a game made with Kroniki Engine looks and feels like, right in your browser. No install needed. | Everything about making a game: first steps, step by step recipes and a page for every part of the engine. |

New here? Start with the guide's **[First steps](https://kroniki.arclockproject.org/#setup)**, then follow a **[recipe](https://kroniki.arclockproject.org/recipes.html)** to add your first NPC, map or shop.

---

## The guide

The **[Kroniki Engine guide](https://kroniki.arclockproject.org/)** is the place to learn the engine. Every page has examples you can copy. It also ships in [`docs/`](docs/index.html), so you can read it offline in any browser.

- **Start:** [first steps](https://kroniki.arclockproject.org/#setup), [recipes](https://kroniki.arclockproject.org/recipes.html) (a talking NPC, a new map, a shop, a quest, a battle area...)
- **World:** [maps](https://kroniki.arclockproject.org/world/maps.html), [characters](https://kroniki.arclockproject.org/world/characters.html), [art](https://kroniki.arclockproject.org/world/art.html)
- **Story:** [writing a scene](https://kroniki.arclockproject.org/story/events/scripts.html), [`.vn` scripts](https://kroniki.arclockproject.org/story/vn.html), [routes and flowchart](https://kroniki.arclockproject.org/story/routes.html)
- **Gameplay:** [items](https://kroniki.arclockproject.org/gameplay/items.html), [quests](https://kroniki.arclockproject.org/gameplay/progress.html), [battles](https://kroniki.arclockproject.org/gameplay/battles.html), [extras](https://kroniki.arclockproject.org/gameplay/extras.html)
- **Interface:** [screens](https://kroniki.arclockproject.org/interface/screens.html), [input](https://kroniki.arclockproject.org/interface/input.html), [look](https://kroniki.arclockproject.org/interface/look.html), [translations](https://kroniki.arclockproject.org/interface/translations.html)
- **Systems:** [audio](https://kroniki.arclockproject.org/systems/audio.html), [saves](https://kroniki.arclockproject.org/systems/saves.html), [variants](https://kroniki.arclockproject.org/systems/variants.html), [tools and building](https://kroniki.arclockproject.org/systems/tools.html)

## What it does

**Story**
- Visual-novel scenes: dialogue box, choices, character portraits, backgrounds, CGs, camera moves, weather, filters and transitions.
- `.vn` dialogue scripts: write scenes as plain text, with an editor extension for highlighting, checks and autocomplete.
- Routes and an auto-generated flowchart: the player can jump back to any scene they have seen.
- Backlog, Back (rewind), skip, auto mode, voices with lip sync, chapters, multiple endings and after stories.

**World and gameplay**
- A 2D world to walk around in: Tiled maps, NPCs, doors, props, day and night, lights, a minimap and fast travel.
- Items, money, shops, quests, a journal, a party, turn-based battles, crafting, timers and a calendar.
- Achievements, a CG gallery, scene replay, a music room and New Game+.
- Minigames: any full-screen game you write in React or PixiJS.

**VN-only mode.** Turn the maps off with one setting and you have a pure visual novel with routes and a flowchart.

**Built for shipping**
- Desktop builds with Electron, Android with Capacitor, and a web build, all from one command.
- Keyboard, gamepad and touch work on every screen. Phone layouts are landscape.
- One save system: slots, autosave, quick save, saves in the middle of a scene, export and import, and save upgrades between versions.
- Translations, content variants (one project, several builds), an audio manager with preloading, and encrypted media in builds.
- Works fully offline. Every script, font and picture ships with the game.

Want to see it in action first? **[Play the demo](https://kroniki.arclockproject.org/demo/)**.

## How you make a game

All game content lives in `src/content/`. The engine lives in `src/core/`, and you normally never touch it.

Each piece of content is a folder with a typed definition. Its id is the folder name, and ids autocomplete everywhere:

```ts
// src/content/items/potion/index.ts
import { defineItem } from '@/core/define'

export default defineItem({
  name: 'Potion',
  description: 'Restores a little health.',
  price: 20,
})
```

```ts
// anywhere in your game
game.items.add('potion', 2, { notify: true })
await game.events.start('jack/hello')
game.windows.open('inventory')
```

Content is TypeScript, not JSON, so a typo in an id is a compile error, not a crash at runtime. Scenes can also be written as `.vn` text files:

```
bg town_square
show anna at right
anna: Oh, you made it!
choice:
  * Wave back
    love anna +1
  * Pretend you didn't see her
    > You look the other way.
```

`.vn` is optional. A scene can just as well be a plain TypeScript event (`say()`, `choice()`, `game.*`), and a game can mix both. A `.vn` file is compiled to TypeScript, so it can do everything a `.ts` event can.

If you do use `.vn`, the **Kroniki VN Scripts** editor extension for VSCodium / VS Code gives you full support:

- **Syntax colors** for speakers, commands, markup and choices.
- **Autocomplete by context:** characters, poses, stage positions, items, flags, sounds and voice clip numbers, read from your own project. New content shows up right away, without reinstalling.
- **Checks as you type:** unknown ids (with "did you mean"), lines it doesn't understand and bad indentation.
- **Show generated TypeScript:** see exactly what a scene compiles to.

Build it with `pnpm vn:extension`, then install `build/vn-extension/*.vsix` with "Install from VSIX..." in the editor's Extensions view. More in the guide: [Dialogue scripts (.vn)](https://kroniki.arclockproject.org/story/vn.html#extension).

**Next:** the guide's [Writing a scene](https://kroniki.arclockproject.org/story/events/scripts.html) walks you through your first scene.

## Quick start

You need Node.js 24, pnpm (`corepack enable pnpm`) and [Git LFS](https://git-lfs.com). The demo's art and sound files are stored with Git LFS, and the game doesn't build without them.

```sh
git clone https://github.com/arclockproject/kroniki.git
cd kroniki
pnpm install
pnpm dev:browser    # open the address it prints
```

**No Git LFS on your machine?** `pnpm setup:lfs` is optional: use it only if you'd rather not install Git LFS yourself. It downloads Git LFS into `tools/git-lfs` and sets up only this repository to use it. Then fetch the files the clone left as placeholders:

```sh
pnpm setup:lfs
tools/git-lfs/git-lfs pull
```

To start your own game, run `pnpm setup:project`. It asks whether you're making a visual novel or a game with maps, then removes the demo game and leaves a tiny starter (the player on an empty map, and an empty route for VN mode). Nothing changes until you pick, and Ctrl+C or an empty answer exits.

Then give the game its name and ids in `src/content/config/app.ts`, and carry on with the guide's **[First steps](https://kroniki.arclockproject.org/#setup)**: it explains each field and what to do next.

## Commands

| Command | What it does |
| --- | --- |
| `pnpm dev:browser` | Dev server in the browser |
| `pnpm dev:electron` | The desktop app in dev mode |
| `pnpm setup:project` | Start your own game: pick visual novel or maps, remove the demo (asks first) |
| `pnpm build` | Every target: web, Linux, Windows and Android (installers in `build/dist`) |
| `pnpm build:web` | Web build only (also `build:linux`, `build:win`, `build:android`) |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm typecheck` | Code generation and TypeScript checks |
| `pnpm lint` | Biome lint and format check (`pnpm lint:fix` fixes what it can) |
| `pnpm lang` | Translation status (`--write` adds missing keys) |
| `pnpm vn:extension` | Builds the `.vn` editor extension |
| `pnpm guide` | Refreshes the guide's search index |

The hosted guide and demo are published by [`.github/workflows/pages.yml`](.github/workflows/pages.yml), run by hand from the Actions tab.

## Project layout

```
src/
  content/      your game: maps, events, characters, items, windows, look, settings...
    config/     settings you set once (name, mode, input, screen, flowchart...)
    ui/         how the engine's screens are laid out
    look/       colors, fonts, frames, buttons and UI sounds
  core/         the engine
docs/           the guide (open docs/index.html in a browser)
scripts/        build, test and tool scripts
electron/       desktop app shell
android/        Android project
```

## Tech stack

React, Material UI, PixiJS 8, zustand with immer, Vite, TypeScript, Electron, Capacitor, Vitest and Biome. Optional: Tiled maps, Aseprite portraits and sprites, and Spine animations.

## About the name

*Kroniki* (said "kro-NEE-kee") is Polish for "chronicles". Every game made with the engine is a chronicle of its own: a story with its routes, choices and endings, and the adventures of the people who live in its world.

## License

[MIT](LICENSE)
