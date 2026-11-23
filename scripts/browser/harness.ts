// Shared by the browser tests (pnpm test:browser): starts the dev server, finds a Chromium and
// opens the game in it. Runs through Node type stripping: no enums, namespaces or parameter
// properties here.
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { type Browser, type BrowserContext, chromium, type Page } from 'playwright-core'
import { createServer, type Plugin, type ViteDevServer } from 'vite'
import app from '../../src/content/config/app.ts'

/** src/content/config/app.ts: the storage keys start with its id. */
const APP = app

export const ROOT = path.resolve(import.meta.dirname, '../..')
/** Not 5173: the developer's own dev server may be running there. */
export const PORT = Number(process.env.GAME_TEST_PORT ?? 5180)
export const SHOTS = path.join(ROOT, 'build/browser-test')

const MODE_FILE = path.join(ROOT, 'src/content/config/mode.ts')

/** The `vnOnly` written in src/content/config/mode.ts (what a build of the game uses). */
export function contentVnOnly(): boolean {
  return /vnOnly:\s*true/.test(readFileSync(MODE_FILE, 'utf8'))
}

/**
 * The browser smoke test always runs the normal game with maps, whatever src/content/config/mode.ts says
 * (the developer switches it often): this keeps the file's config and overrides only `vnOnly`.
 */
function forceMode(vnOnly: boolean): Plugin {
  return {
    name: 'test-force-mode',
    enforce: 'pre',
    transform(code, id) {
      if (id.split('?')[0] !== MODE_FILE) return null
      const config = code.replace(/export default/, 'const contentMode =')
      return `${config}\nexport default { ...contentMode, vnOnly: ${vnOnly} }\n`
    },
  }
}

/** A Chromium to drive: CHROME_PATH, else the newest one Playwright has downloaded. */
export function findChromium(): string {
  const fromEnv = process.env.CHROME_PATH
  if (fromEnv && existsSync(fromEnv)) return fromEnv
  const cache = path.join(homedir(), '.cache/ms-playwright')
  const found = existsSync(cache)
    ? readdirSync(cache)
        .filter((name) => /^chromium-\d+$/.test(name))
        .sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]))
        .flatMap((name) => [
          path.join(cache, name, 'chrome-linux64/chrome'),
          path.join(cache, name, 'chrome-linux/chrome'),
          path.join(cache, name, 'chrome-win/chrome.exe'),
          path.join(cache, name, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
        ])
        .find((file) => existsSync(file))
    : undefined
  if (found) return found
  throw new Error(
    'No Chromium found. Run `pnpm exec playwright-core install chromium`, or set CHROME_PATH to a Chrome / Chromium binary.',
  )
}

export interface Screen {
  name: string
  width: number
  height: number
  touch: boolean
}

/** The sizes every check runs at. Phones are landscape only (see dev-notes/MEMORY.md). */
export const SCREENS: Screen[] = [
  { name: 'desktop', width: 1280, height: 720, touch: false },
  { name: 'phone', width: 844, height: 390, touch: true },
]

export interface Session {
  server: ViteDevServer | null
  browser: Browser
  url: string
  close(): Promise<void>
}

/** Starts the dev server (unless GAME_URL points at a running game) and a headless browser. */
export async function startSession(): Promise<Session> {
  mkdirSync(SHOTS, { recursive: true })
  let server: ViteDevServer | null = null
  let url = process.env.GAME_URL ?? ''
  if (!url) {
    server = await createServer({
      root: ROOT,
      logLevel: 'error',
      server: { port: PORT, strictPort: true, host: '127.0.0.1' },
      plugins: [forceMode(false)],
    })
    await server.listen()
    url = `http://127.0.0.1:${PORT}/`
  }
  const browser = await chromium.launch({
    executablePath: findChromium(),
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  })
  return {
    server,
    browser,
    url,
    async close() {
      await browser.close()
      await server?.close()
    },
  }
}

export interface GamePage {
  page: Page
  context: BrowserContext
  /** Console errors and uncaught exceptions seen so far. */
  errors: string[]
  shot(name: string): Promise<void>
}

/** Messages that are not the game's fault in a headless browser. */
const IGNORED = [/AudioContext/i, /favicon/i, /WebGL.*(fallback|software)/i, /GPU stall/i]

/** A fresh browser profile on the game, with the dev panel switched off. */
export async function openGame(session: Session, screen: Screen): Promise<GamePage> {
  const context = await session.browser.newContext({
    viewport: { width: screen.width, height: screen.height },
    hasTouch: screen.touch,
    isMobile: screen.touch,
  })
  // Before any game code runs: no dev panel over the buttons.
  await context.addInitScript((key: string) => {
    try {
      const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>
      localStorage.setItem(key, JSON.stringify({ ...stored, showDevPanel: false }))
    } catch {
      // no storage: the test hides the panel by hand
    }
  }, `${APP.id}:settings`)
  const page = await context.newPage()
  const errors: string[] = []
  const note = (text: string) => {
    if (!IGNORED.some((pattern) => pattern.test(text))) errors.push(text)
  }
  page.on('pageerror', (error) => note(`uncaught: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') note(`console: ${message.text()}`)
  })
  await page.goto(session.url, { waitUntil: 'load' })
  return {
    page,
    context,
    errors,
    shot: async (name) => {
      await page.screenshot({ path: path.join(SHOTS, `${screen.name}-${name}.png`) })
    },
  }
}

/** Runs code in the page with the running `game` object (dev server only). */
export function withGame<T>(page: Page, body: string): Promise<T> {
  return page.evaluate(
    `(async () => { const { game } = await import('/src/core/game.ts'); ${body} })()`,
  ) as Promise<T>
}

/** Waits until the game says so (polls `body`, which must return a boolean). */
export async function waitForGame(page: Page, body: string, timeoutMs = 15000): Promise<void> {
  const until = Date.now() + timeoutMs
  for (;;) {
    if (await withGame<boolean>(page, body)) return
    if (Date.now() > until) throw new Error(`timed out waiting for: ${body}`)
    await page.waitForTimeout(100)
  }
}
