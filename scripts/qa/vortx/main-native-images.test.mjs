import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nativeImages, prepareNativeImages } from './main-native-images.mjs'

function fixture({ wrongDigest = false, wrongAlias = false } = {}) {
  let current
  const commands = []
  return { commands, run: async args => {
    commands.push(args)
    if (args[0] === 'pull') { current = nativeImages.find(image => image.source === args[1]); assert(current); return '' }
    if (args[0] === 'tag') { assert.equal(args[1], current.source); assert.equal(args[2], current.alias); return '' }
    assert.deepEqual(args.slice(0, 2), ['image', 'inspect'])
    return JSON.stringify([{ Id: wrongAlias && args[2] === current.alias ? 'wrong' : 'sha256:synthetic',
      RepoDigests: [`mirror@${wrongDigest ? 'sha256:wrong' : current.digest}`] }])
  } }
}

test('official mirror content is immutable and aliases retain historical versions', async () => {
  const f = fixture(), result = await prepareNativeImages(f.run)
  assert.equal(result.length, 4)
  for (const image of nativeImages) {
    assert.match(image.source, /^docker\.io\/(supabase\/(postgres|gotrue|storage-api)|postgrest\/postgrest)@sha256:[a-f0-9]{64}$/)
    assert.match(image.alias, /^public\.ecr\.aws\/supabase\//)
    assert(Object.isFrozen(image))
  }
  assert(f.commands.every(args => ['pull', 'tag', 'image'].includes(args[0])))
})
test('wrong digest fails before tagging or starting tests', async () => {
  const f = fixture({ wrongDigest: true })
  await assert.rejects(prepareNativeImages(f.run), /OFFICIAL_IMAGE_DIGEST_MISMATCH/)
  assert(!f.commands.some(args => args[0] === 'tag'))
})
test('runtime alias content mismatch is not accepted', async () => {
  await assert.rejects(prepareNativeImages(fixture({ wrongAlias: true }).run), /RUNTIME_ALIAS_CONTENT_MISMATCH/)
})
