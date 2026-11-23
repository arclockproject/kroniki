// Builds the game for one or more targets:
// node scripts/build.ts <web|linux|win|android|android-bundle|all>... [--lite]
// (all = every one but android-bundle). --lite: the lite build for weaker devices (smaller pictures
// and sounds, src/content/config/media.ts); its files in build/dist end in "-lite".
// The web build runs once and every other target reuses it. A failing target does not stop the
// others; the summary lists it and the exit code is 1. Installers and the APK are copied to build/dist/.
import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { build as esbuild } from 'esbuild'
import app from '../src/content/config/app.ts'
import { MAIN_ICON, resolveApp } from '../src/core/app.ts'
import {
  BASE_LIMIT,
  clearPacks,
  listFiles,
  PACK_LIMIT,
  planPacks,
  TOTAL_LIMIT,
  totalBytes,
  writePacks,
} from './asset-packs.ts'
import { electronBuildOptions } from './electron-esbuild.ts'
import { generateIcons } from './icons.ts'

/** src/content/config/app.ts: ids, name, version, icon. */
const APP = resolveApp(app)

const TARGETS = ['web', 'linux', 'win', 'android', 'android-bundle'] as const
type Target = (typeof TARGETS)[number]
const ALL: Target[] = ['web', 'linux', 'win', 'android']

const DIST = 'build/dist'
const LITE = process.argv.includes('--lite')

/**
 * Content variants (src/content/config/variants.ts): --variant rating=adult (repeatable), also
 * --variant=rating=adult. Passed to vite and pnpm gen as GAME_VARIANTS; other values' files are
 * left out of the build. Without it each group uses its default.
 */
function takeVariants(args: string[]): string[] {
  const pairs: string[] = []
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (arg === '--variant') pairs.push(args[++i] ?? '')
    else if (arg.startsWith('--variant=')) pairs.push(arg.slice('--variant='.length))
    else rest.push(arg)
  }
  if (pairs.length > 0) process.env.GAME_VARIANTS = pairs.join(',')
  return rest
}
const ARGS = takeVariants(process.argv.slice(2))

/** "mygame-0.1.0.AppImage" -> "mygame-0.1.0-lite.AppImage" in a lite build. */
const flavour = (file: string) => (LITE ? file.replace(/(\.[^.]+)$/, '-lite$1') : file)
/** Whether a file in build/dist is from this kind of build (lite or not) and matches `pattern`. */
const sameFlavour = (file: string, pattern: RegExp) =>
  file.includes('-lite.') === LITE && pattern.test(file.replace('-lite.', '.'))
const RELEASE = 'build/electron/release'
const APK = 'android/app/build/outputs/apk/debug/app-debug.apk'
const AAB = 'android/app/build/outputs/bundle/release/app-release.aab'
const MB = 1024 * 1024
/** NSIS (Windows installer + portable exe) can't make files over 2 GB; leave room for Electron. */
const WIN_INSTALLER_LIMIT = 1700 * MB
/** Android can't install an APK over 4 GB. */
const APK_LIMIT = 4000 * MB
const isWindows = process.platform === 'win32'

// Gradle 8.14.3 (android/gradle/wrapper) runs on Java 17 to 24. JDK 21 is the one to install.
const JAVA_MIN = 17
const JAVA_MAX = 24

function parseTargets(args: string[]): Target[] {
  if (args.length === 0 || args.includes('all')) return ALL
  const unknown = args.filter((arg) => !(TARGETS as readonly string[]).includes(arg))
  if (unknown.length > 0) {
    console.error(`Unknown target: ${unknown.join(', ')}. Use: ${TARGETS.join(', ')}, all`)
    process.exit(1)
  }
  return TARGETS.filter((target) => args.includes(target))
}

function run(
  command: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): boolean {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: isWindows, ...options })
  return result.status === 0
}

class BuildError extends Error {}

// ---- Java ----

function javaMajor(javaHome: string | undefined): number | null {
  const java = javaHome ? join(javaHome, 'bin', isWindows ? 'java.exe' : 'java') : 'java'
  if (javaHome && !existsSync(java)) return null
  const result = spawnSync(java, ['-version'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) return null
  const match = /version "(\d+)(?:\.(\d+))?/.exec(`${result.stderr}${result.stdout}`)
  if (!match) return null
  const major = Number(match[1])
  return major === 1 ? Number(match[2]) : major // Java 8 reports "1.8"
}

function subfolders(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => join(dir, entry.name))
}

/** A JDK that Gradle can run on: JAVA_HOME if it fits, else the usual install folders. */
function findJavaHome(): string {
  const fromEnv = process.env.JAVA_HOME
  if (fromEnv) {
    const major = javaMajor(fromEnv)
    if (major !== null && major >= JAVA_MIN && major <= JAVA_MAX) return fromEnv
    console.warn(
      `JAVA_HOME is Java ${major ?? '?'} (needs ${JAVA_MIN}-${JAVA_MAX}); looking for another JDK.`,
    )
  }
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files'
  const candidates = [
    ...subfolders('/usr/lib/jvm'), // Linux (Arch: java-21-openjdk)
    ...subfolders(join(homedir(), '.local/jdk')),
    ...subfolders(join(homedir(), '.jdks')), // IntelliJ / Android Studio downloads
    ...subfolders('/Library/Java/JavaVirtualMachines').map((dir) => join(dir, 'Contents/Home')),
    ...subfolders(join(programFiles, 'Eclipse Adoptium')),
    ...subfolders(join(programFiles, 'Java')),
    ...subfolders(join(programFiles, 'Microsoft')),
    '/opt/android-studio/jbr',
    join(homedir(), 'android-studio/jbr'),
    join(programFiles, 'Android/Android Studio/jbr'),
  ]
  let best: { home: string; major: number } | null = null
  for (const home of candidates) {
    const major = javaMajor(home)
    if (major === null || major < JAVA_MIN || major > JAVA_MAX) continue
    // Prefer 21, then the newest that still works.
    if (!best || major === 21 || (best.major !== 21 && major > best.major)) best = { home, major }
  }
  if (!best) {
    throw new BuildError(
      `No JDK ${JAVA_MIN}-${JAVA_MAX} found. Install JDK 21 (Arch: sudo pacman -S jdk21-openjdk) ` +
        'or set JAVA_HOME to one.',
    )
  }
  return best.home
}

// ---- Android SDK ----

/** The SDK folder: ANDROID_HOME / ANDROID_SDK_ROOT, local.properties, or the default install folders. */
function findAndroidSdk(): string {
  const propsFile = 'android/local.properties'
  const fromProps = existsSync(propsFile)
    ? /^sdk\.dir=(.*)$/m.exec(readFileSync(propsFile, 'utf8'))?.[1]?.replace(/\\(.)/g, '$1')
    : undefined
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    fromProps,
    join(homedir(), 'Android/Sdk'), // Linux (Android Studio default)
    join(homedir(), 'Library/Android/sdk'), // macOS
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android/Sdk'), // Windows
    '/opt/android-sdk', // Arch AUR packages
  ]
  const sdk = candidates.find((dir): dir is string => !!dir && existsSync(dir))
  if (!sdk) {
    throw new BuildError(
      'No Android SDK found. Install it (see dev-notes/android.md) or set ANDROID_HOME to it.',
    )
  }
  if (!existsSync(join(sdk, 'licenses'))) {
    throw new BuildError(
      `Android SDK licences are not accepted in ${sdk}. Run: ` +
        `${join(sdk, 'cmdline-tools/latest/bin/sdkmanager')} --licenses`,
    )
  }
  // Gradle reads the SDK path from here. It is gitignored because it is machine-specific.
  const escaped = resolve(sdk).replace(/\\/g, '\\\\').replace(/:/g, '\\:')
  writeFileSync(propsFile, `sdk.dir=${escaped}\n`)
  return sdk
}

// ---- Targets ----

function buildWeb(): boolean {
  const mode = LITE ? ['--mode', 'lite'] : []
  // The game and engine code only: the engine's tests never stop a game from building.
  return run('pnpm', ['typecheck:build']) && run('pnpm', ['exec', 'vite', 'build', ...mode])
}

let electronMainBuilt = false
async function buildElectronMain(): Promise<void> {
  if (electronMainBuilt) return
  // Clear leftovers (e.g. dev sourcemaps) so they don't end up in the packaged app.
  rmSync('build/electron/main', { recursive: true, force: true })
  await esbuild({ ...electronBuildOptions, sourcemap: false })
  electronMainBuilt = true
}

function removeFiles(dir: string, pattern: RegExp): void {
  if (!existsSync(dir)) return
  for (const file of readdirSync(dir)) {
    if (pattern.test(file)) rmSync(join(dir, file), { force: true })
  }
}

/** Old files of this kind of build in build/dist (a lite build keeps the normal ones, and back). */
function removeDist(pattern: RegExp): void {
  if (!existsSync(DIST)) return
  for (const file of readdirSync(DIST)) {
    if (sameFlavour(file, pattern)) rmSync(join(DIST, file), { force: true })
  }
}

function collect(pattern: RegExp): void {
  if (!existsSync(RELEASE)) return
  for (const file of readdirSync(RELEASE)) {
    if (pattern.test(file)) copyFileSync(join(RELEASE, file), join(DIST, flavour(file)))
  }
}

const webBytes = () => totalBytes(listFiles('build/web'))

async function buildDesktop(
  platform: '--linux' | '--win',
  pattern: RegExp,
  targets: string[] = [],
): Promise<boolean> {
  // Old installers would otherwise be copied as if they were new.
  removeFiles(RELEASE, pattern)
  removeDist(pattern)
  await buildElectronMain()
  // On Linux the Windows installer (NSIS) needs wine.
  const ok = run('pnpm', [
    'exec',
    'electron-builder',
    '--config',
    'electron-builder.yml',
    // Ids, name, version and icon from src/content/config/app.ts (not package.json).
    `-c.appId=${APP.appId}`,
    // Installers and file names allow only letters, digits, - _ . spaces and ( ): "Jack's Game" ->
    // "Jacks Game" there (the window and the game keep the real name).
    `-c.productName=${APP.name.replace(/[^A-Za-z0-9 ._()-]/g, '').trim() || APP.id}`,
    `-c.icon=${join('src/content', MAIN_ICON)}`,
    `-c.extraMetadata.name=${APP.id}`,
    `-c.extraMetadata.version=${APP.version}`,
    `-c.extraMetadata.description=${APP.description}`,
    `-c.extraMetadata.desktopName=${APP.id}.desktop`,
    platform,
    ...targets,
  ])
  if (ok) collect(pattern)
  return ok
}

function buildWindows(): Promise<boolean> {
  const bytes = webBytes()
  if (bytes <= WIN_INSTALLER_LIMIT) return buildDesktop('--win', /\.exe$/)
  // Too big for NSIS: a zip of the game folder instead (Steam ships folders anyway).
  console.log(
    `The game is ${Math.round(bytes / MB)} MB, too big for a Windows installer (2 GB limit). ` +
      'Building a zip of the game folder instead.',
  )
  return buildDesktop('--win', /-win\.zip$/, ['zip'])
}

/**
 * JDK + SDK, the launcher icons and colours (scripts/icons.ts), then `cap sync` (copies build/web into
 * the app; asset packs from before are removed).
 */
async function prepareAndroid(): Promise<NodeJS.ProcessEnv | null> {
  const javaHome = findJavaHome()
  const sdk = findAndroidSdk()
  console.log(`JDK: ${javaHome}\nAndroid SDK: ${sdk}`)
  clearPacks('android')
  writeAndroidAppInfo()
  try {
    if (await generateIcons()) console.log('Android icons written (src/content/assets/icon).')
  } catch (error) {
    throw new BuildError(error instanceof Error ? error.message : String(error))
  }
  if (!run('pnpm', ['exec', 'cap', 'sync', 'android'])) return null
  return { ...process.env, JAVA_HOME: javaHome, ANDROID_HOME: sdk }
}

const gradlew = isWindows ? 'gradlew.bat' : './gradlew'

/**
 * src/content/config/app.ts into the Android build: android/app.properties (read by
 * android/app/build.gradle: store id, name, version) and capacitor.config.json (appId / appName,
 * copied into the app by cap sync; rewritten only when they differ).
 */
function writeAndroidAppInfo(): void {
  // A Java package: dot-separated parts, each starting with a letter.
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(APP.appId)) {
    throw new BuildError(
      `appId "${APP.appId}" (src/content/config/app.ts) is not a valid Android id: use parts like "com.mystudio.mygame" (letters, digits, _; each part starts with a letter).`,
    )
  }
  if (!Number.isInteger(APP.build) || APP.build < 1) {
    throw new BuildError('build (src/content/config/app.ts) must be a whole number, 1 or more.')
  }
  const line = (key: string, value: string) =>
    `${key}=${value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')}`
  writeFileSync(
    'android/app.properties',
    `${[
      '# Written by scripts/build.ts from src/content/config/app.ts. Do not edit.',
      line('appId', APP.appId),
      line('name', APP.name),
      line('version', APP.version),
      line('build', String(APP.build)),
    ].join('\n')}\n`,
  )
  const capFile = 'capacitor.config.json'
  const cap = JSON.parse(readFileSync(capFile, 'utf8')) as Record<string, unknown>
  if (cap.appId !== APP.appId || cap.appName !== APP.name) {
    writeFileSync(
      capFile,
      `${JSON.stringify({ ...cap, appId: APP.appId, appName: APP.name }, null, 2)}\n`,
    )
  }
}

async function buildAndroid(): Promise<boolean> {
  rmSync(join(DIST, flavour(`${APP.id}-debug.apk`)), { force: true })
  if (webBytes() > APK_LIMIT) {
    throw new BuildError(
      'The game is over 4 GB: too big for an APK. Use android-bundle (Play Store).',
    )
  }
  const env = await prepareAndroid()
  if (!env || !run(gradlew, ['assembleDebug'], { cwd: 'android', env })) return false
  copyFileSync(APK, join(DIST, flavour(`${APP.id}-debug.apk`)))
  return true
}

/** Play Store bundle (.aab): big games get their media split into install-time asset packs. */
async function buildAndroidBundle(): Promise<boolean> {
  rmSync(join(DIST, flavour(`${APP.id}.aab`)), { force: true })
  if (!existsSync('android/keystore.properties')) {
    console.warn(
      'No android/keystore.properties: the bundle is NOT signed and Play will refuse it ' +
        '(see dev-notes/android.md "Signing").',
    )
  }
  const env = await prepareAndroid()
  if (!env) return false
  // ANDROID_BASE_LIMIT_MB: only to try packs with a small game.
  const testLimit = Number(process.env.ANDROID_BASE_LIMIT_MB)
  const base = testLimit > 0 ? testLimit * MB : BASE_LIMIT
  const files = listFiles('android/app/src/main/assets/public')
  let packs: ReturnType<typeof planPacks>
  try {
    packs = planPacks(files, { base, pack: PACK_LIMIT, total: TOTAL_LIMIT })
  } catch (error) {
    throw new BuildError(error instanceof Error ? error.message : String(error))
  }
  writePacks('android', packs)
  if (packs.length > 0) {
    const moved = packs.reduce((sum, pack) => sum + totalBytes(pack), 0)
    console.log(`Media moved into ${packs.length} asset pack(s): ${Math.round(moved / MB)} MB.`)
  }
  const ok = run(gradlew, ['bundleRelease'], { cwd: 'android', env })
  // Leave the Android project as a normal app (for Android Studio and APK builds).
  clearPacks('android')
  if (!ok) return false
  copyFileSync(AAB, join(DIST, flavour(`${APP.id}.aab`)))
  return true
}

const steps: Record<
  Exclude<Target, 'web'>,
  { label: string; build: () => Promise<boolean> | boolean }
> = {
  linux: { label: 'Linux (AppImage)', build: () => buildDesktop('--linux', /\.AppImage$/) },
  win: { label: 'Windows (installer + portable, or zip when over 2 GB)', build: buildWindows },
  android: { label: 'Android (debug APK)', build: buildAndroid },
  'android-bundle': { label: 'Android (Play Store bundle)', build: buildAndroidBundle },
}

// ---- Main ----

const targets = parseTargets(ARGS.filter((arg) => arg !== '--lite'))
if (process.env.GAME_VARIANTS) console.log(`Content variants: ${process.env.GAME_VARIANTS}`)
mkdirSync(DIST, { recursive: true })

console.log('\n=== Web ===')
if (!buildWeb()) {
  console.error('!!! Web build failed; nothing else was built.')
  process.exit(1)
}

const failed: string[] = []
for (const target of targets) {
  if (target === 'web') continue
  const step = steps[target]
  console.log(`\n=== ${step.label} ===`)
  let ok: boolean
  try {
    ok = await step.build()
  } catch (error) {
    if (!(error instanceof BuildError)) throw error
    console.error(error.message)
    ok = false
  }
  if (!ok) {
    failed.push(step.label)
    console.error(`!!! ${step.label} failed`)
  }
}

console.log('\n=== Summary ===')
console.log(`Web: build/web/${LITE ? ' (lite)' : ''}`)
const artifacts = readdirSync(DIST)
if (artifacts.length > 0) console.log(`Installers in ${DIST}/:\n  ${artifacts.join('\n  ')}`)
if (failed.length > 0) {
  console.error(`Failed: ${failed.join(', ')}`)
  process.exit(1)
}
console.log('All targets built.')
