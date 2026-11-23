// pnpm vn:extension -> build/vn-extension/kroniki-vn-scripts-<version>.vsix
// Install in VSCodium: Extensions view → "…" menu → "Install from VSIX…".
// Only needed when the extension's own code changes; new game content is picked up automatically.
import { execFileSync } from 'node:child_process'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build } from 'esbuild'

const ROOT = path.resolve(import.meta.dirname, '..')
const SRC = path.join(ROOT, 'tools/vscode-vn')
const OUT = path.join(ROOT, 'build/vn-extension')
const STAGE = path.join(OUT, 'stage')
const pkg = JSON.parse(readFileSync(path.join(SRC, 'package.json'), 'utf8')) as {
  name: string
  displayName: string
  description: string
  version: string
  publisher: string
  engines: { vscode: string }
}

await build({
  entryPoints: [path.join(SRC, 'src/extension.ts')],
  outfile: path.join(SRC, 'dist/extension.js'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  logLevel: 'warning',
})

rmSync(OUT, { recursive: true, force: true })
const ext = path.join(STAGE, 'extension')
mkdirSync(ext, { recursive: true })
for (const file of ['package.json', 'language-configuration.json', 'syntaxes', 'dist'])
  cpSync(path.join(SRC, file), path.join(ext, file), { recursive: true })

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')
writeFileSync(
  path.join(STAGE, 'extension.vsixmanifest'),
  `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011">
  <Metadata>
    <Identity Language="en-US" Id="${pkg.name}" Version="${pkg.version}" Publisher="${pkg.publisher}"/>
    <DisplayName>${xml(pkg.displayName)}</DisplayName>
    <Description xml:space="preserve">${xml(pkg.description)}</Description>
    <Categories>Programming Languages</Categories>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${pkg.engines.vscode}"/>
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace"/>
    </Properties>
  </Metadata>
  <Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
  </Assets>
</PackageManifest>
`,
)
writeFileSync(
  path.join(STAGE, '[Content_Types].xml'),
  `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension=".json" ContentType="application/json"/>
  <Default Extension=".js" ContentType="application/javascript"/>
  <Default Extension=".vsixmanifest" ContentType="text/xml"/>
</Types>
`,
)
const vsix = path.join(OUT, `${pkg.name}-${pkg.version}.vsix`)
execFileSync(
  'zip',
  ['-q', '-r', '-X', vsix, '[Content_Types].xml', 'extension.vsixmanifest', 'extension'],
  {
    cwd: STAGE,
  },
)
rmSync(STAGE, { recursive: true, force: true })
console.log(`[vn] ${path.relative(ROOT, vsix)}`)
