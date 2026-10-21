import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

// Official mirrors, verified identical OCI indexes to the historical ECR images.
// Keep original runtime aliases and immutable content; never choose a new version.
export const nativeImages = Object.freeze([
  ['supabase/postgres', '17.6.1.156', 'ca7871b587ca2c401ac0f325df6249c9aa0d25647ded34631158efc51176767f'],
  ['supabase/gotrue', 'v2.194.0', '2b352c02adf11a2025cd5993c246ef85db73743553c39194d2b1862d1cc4d1fd'],
  ['postgrest/postgrest', 'v14.15', '2f8e7b656f09db697a8875177694b417b35cb76c21370de07fc54e711e902326'],
  ['supabase/storage-api', 'v1.67.20', 'a4846b3329f3afd52cd2ae31b89a0c1ae841221e9d3a22d55db65f9dca2a72b6'],
].map(([repository, version, digest]) => Object.freeze({
  source: `docker.io/${repository}@sha256:${digest}`,
  alias: `public.ecr.aws/supabase/${repository.split('/')[1]}:${version}`,
  digest: `sha256:${digest}`,
})))

const execute = promisify(execFile)
const docker = async args => (await execute('docker', args, { windowsHide: true,
  timeout: 300000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim()

export async function prepareNativeImages(run = docker) {
  const evidence = []
  for (const image of nativeImages) {
    // Digest pinning validates the manifest against the expected historical bytes.
    await run(['pull', image.source])
    const [pulled] = JSON.parse(await run(['image', 'inspect', image.source]))
    assert(pulled.RepoDigests.some(value => value.endsWith(`@${image.digest}`)), 'OFFICIAL_IMAGE_DIGEST_MISMATCH')
    await run(['tag', image.source, image.alias])
    const [aliased] = JSON.parse(await run(['image', 'inspect', image.alias]))
    assert.equal(aliased.Id, pulled.Id, 'RUNTIME_ALIAS_CONTENT_MISMATCH')
    evidence.push({ ...image, imageId: pulled.Id, result: 'EXACT_HISTORICAL_CONTENT' })
  }
  return evidence
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.deepEqual(process.argv.slice(2), ['--local-only'])
  assert(!process.env.DOCKER_HOST || /^(npipe:|unix:)/.test(process.env.DOCKER_HOST), 'REMOTE_DOCKER_REFUSED')
  assert.match(await docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']), /^(npipe:|unix:)/)
  console.log(JSON.stringify({ result: 'PASS', images: await prepareNativeImages() }))
}
