import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  assertHomologEnvironment,
  assertMutation,
  connectDb,
  createAdminClient,
  loadHomologEnv,
  mutationConfirmation,
  parseArgs,
} from '../rlx-golden/helpers.mjs'

export function initializeMutation(action) {
  loadHomologEnv()
  const args = parseArgs()
  const env = assertHomologEnvironment(args)
  const execute = assertMutation(args, action, env.projectRef)
  return { args, env, execute, confirmation: mutationConfirmation(action, env.projectRef) }
}

export function runtimeManifestPath() {
  const root = resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa', 'homologacao', 'rlx-golden-v2')
  mkdirSync(root, { recursive: true })
  return resolve(root, 'runtime.json')
}

export function writeRuntimeManifest(value) {
  writeFileSync(runtimeManifestPath(), `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

export { connectDb, createAdminClient }
