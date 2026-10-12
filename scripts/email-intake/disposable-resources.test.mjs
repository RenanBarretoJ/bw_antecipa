import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { disposableResources, resumeDisposableResources } from './disposable-resources.mjs'

test('resource cleanup refuses non-disposable project IDs before invoking Docker', async () => {
  await assert.rejects(disposableResources({ projectId: 'production', file: 'unused' }), { code: 'ERR_ASSERTION' })
})

test('resuming cleanup rejects foreign and preexisting resources in a manifest', async () => {
  const root = await mkdtemp(join(tmpdir(), 'email05-manifest-'))
  try {
    const file = join(root, 'manifest.json'), projectId = 'bw_email03_12345'
    const before = { containers: [], volumes: ['supabase_db_bw_email03_12345'], networks: [] }
    for (const name of ['unrelated_shared_volume', 'supabase_db_bw_email03_12345']) {
      await writeFile(file, JSON.stringify({ projectId, before, resources: { containers: [], volumes: [name], networks: [] } }))
      await assert.rejects(resumeDisposableResources(file), /REFUSE_UNOWNED_MANIFEST_RESOURCE/)
    }
  } finally {
    assert.ok(resolve(root).startsWith(resolve(tmpdir()) + sep + 'email05-manifest-'))
    await rm(root, { recursive: true, force: true })
  }
})
