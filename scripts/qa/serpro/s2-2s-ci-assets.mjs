import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'
import { nativeImages, prepareNativeImages } from '../vortx/main-native-images.mjs'

export const nodeImage = Object.freeze({
  source: 'docker.io/library/node@sha256:363e1587494626837fa7f9a23bdb453d13b0ff3c67c705c2805cfc69c2d2fad7',
  digest: 'sha256:363e1587494626837fa7f9a23bdb453d13b0ff3c67c705c2805cfc69c2d2fad7',
  alias: 'node:22-bookworm',
})
export async function prepareAssets(run, existingOnly = false) {
  // On an existing workstation, inspection only: no pull, tag or replacement.
  if (!existingOnly) {
    await prepareNativeImages(run)
    await run(['pull', nodeImage.source])
    await run(['tag', nodeImage.source, nodeImage.alias])
  }
  const evidence = []
  for (const image of [...nativeImages, nodeImage]) {
    const [found] = JSON.parse(await run(['image', 'inspect', image.alias]))
    assert.equal(found.Os, 'linux', 'LINUX_IMAGE_REQUIRED')
    assert.equal(found.Architecture, 'amd64', 'AMD64_IMAGE_REQUIRED')
    assert.ok(found.RepoDigests?.some(value => value.endsWith(`@${image.digest}`)), 'IMAGE_DIGEST_MISMATCH')
    evidence.push({ alias: image.alias, digest: image.digest, imageId: found.Id })
  }
  return { status: 'PINNED_IMAGES_VERIFIED', existingOnly, images: evidence }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  assert.ok(args.length === 1 && ['--local-only', '--existing-only'].includes(args[0]))
  assert.ok(!process.env.DOCKER_HOST || /^(npipe:|unix:)/.test(process.env.DOCKER_HOST), 'LOCAL_DOCKER_REQUIRED')
  const execute = promisify(execFile)
  const run = async args => (await execute('docker', args, { windowsHide: true, timeout: 300000, maxBuffer: 4 * 1024 * 1024 })).stdout.trim()
  assert.match(await run(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']), /^(npipe:|unix:)/)
  console.log(JSON.stringify(await prepareAssets(run, args[0] === '--existing-only'), null, 2))
}
