import { parseRuntimeErrors, projectVercelReleaseMetadata } from './release-observability.mjs'

// Offline, bounded stdin adapter for MCP/CLI observations. Never authenticates,
// invokes Vercel, persists raw input, follows URLs or evaluates returned prose.
const mode = process.argv.slice(2)
if (mode.length !== 1 || !['--errors-stdin', '--metadata-stdin'].includes(mode[0])) {
  console.log(JSON.stringify({ status: 'INCONCLUSIVE', reason: 'EXPLICIT_OFFLINE_MODE_REQUIRED' }))
  process.exitCode = 2
} else {
  const chunks = []
  let bytes = 0
  try {
    for await (const chunk of process.stdin) {
      bytes += chunk.length
      if (bytes > 1024 * 1024) throw Error('INPUT_TOO_LARGE')
      chunks.push(Buffer.from(chunk))
    }
    const input = Buffer.concat(chunks).toString('utf8')
    if (mode[0] === '--errors-stdin') {
      const result = parseRuntimeErrors(input)
      console.log(JSON.stringify(result))
      process.exitCode = result.status === 'NO_ERRORS_REPORTED' ? 0 : result.status === 'ERRORS_PRESENT' ? 1 : 2
    } else {
      const result = projectVercelReleaseMetadata(JSON.parse(input))
      console.log(JSON.stringify(result))
      process.exitCode = result.id ? 0 : 2
    }
  } catch {
    console.log(JSON.stringify({ status: 'INCONCLUSIVE', reason: 'UNREADABLE_OR_OVERSIZED_INPUT' }))
    process.exitCode = 2
  }
}
