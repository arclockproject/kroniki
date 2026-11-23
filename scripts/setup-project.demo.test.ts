// pnpm setup:project must keep fitting the demo in src/content (removed with it by the wipe): every root-file edit still finds its text and
// every kept path (the engine's own content, the starter's sprite and tiles) exists. --check asks
// nothing and changes nothing.
import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('setup:project still fits src/content', () => {
  const run = spawnSync(process.execPath, ['scripts/setup-project.ts', '--check'], {
    encoding: 'utf8',
  })
  expect(run.stderr).toBe('')
  expect(run.status).toBe(0)
})
