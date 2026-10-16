import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import cp from 'node:child_process'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const require = createRequire('/deps/qa.cjs')
const ts = require('typescript')
const tar = require('tar-fs')
const mode = process.env.QA_PACK_MODE ?? 'configured'
const variant = process.env.QA_VARIANT ?? 'baseline'
const report = { variant, mode, node: process.version, platform: process.platform, arch: process.arch, pid: process.pid, writers: [], spawns: [], telemetry: [], results: [] }
const assets = '/qa/assets'
await fsp.mkdir(assets, { recursive: true })
const archive = assets + '/configured-chromium-pack.tar'
const pack = mode === 'bundled' ? '/deps/node_modules/@sparticuz/chromium/bin' : '/tmp/configured-pack'
if (mode !== 'bundled' && !fs.existsSync(archive)) {
  throw new Error('Configured Chromium archive cache missing')
}
if (mode !== 'bundled') report.packSha256 = createHash('sha256').update(await fsp.readFile(archive)).digest('hex')
if (!fs.existsSync(pack)) await pipeline(fs.createReadStream(archive), tar.extract(pack))
console.log(JSON.stringify({ phase: 'PACK_READY', mode, node: process.version }))
report.packageVersions = { chromium: JSON.parse(fs.readFileSync('/deps/node_modules/@sparticuz/chromium/package.json')).version, puppeteer: JSON.parse(fs.readFileSync('/deps/node_modules/puppeteer-core/package.json')).version }

let resolveOpen
const writeOpened = new Promise(resolve => { resolveOpen = resolve })
const active = new Map()
const nativeWriteStream = fs.createWriteStream
fs.createWriteStream = function (file, ...args) {
  const stream = nativeWriteStream.call(this, file, ...args)
  if (String(file) === path.join(os.tmpdir(), 'chromium')) {
    stream.once('open', fd => {
      const record = { pid: process.pid, fd, path: fs.readlinkSync('/proc/self/fd/' + fd), fdinfo: fs.readFileSync('/proc/self/fdinfo/' + fd, 'utf8').split('\n').filter(line => /^(flags|mnt_id|ino):/.test(line)), openedAt: performance.now(), closedAt: null }
      active.set(fd, record)
      report.writers.push(record)
      resolveOpen(record)
    })
    stream.once('close', () => {
      for (const [fd, record] of active) {
        record.closedAt = performance.now()
        active.delete(fd)
      }
    })
  }
  return stream
}
const nativeSpawn = cp.spawn
cp.spawn = function (file, ...args) {
  const record = { executable: String(file), at: performance.now(), activeWriterFds: [...active.keys()], nativeError: null }
  report.spawns.push(record)
  const capture = error => { record.nativeError = { code: error.code ?? null, errno: error.errno ?? null, syscall: error.syscall ?? null, path: error.path ?? null } }
  try {
    const child = nativeSpawn.call(this, file, ...args)
    child.once('error', capture)
    return child
  } catch (error) { capture(error); throw error }
}
syncBuiltinESMExports()
const chromium = (await import(pathToFileURL(require.resolve('@sparticuz/chromium')))).default
const puppeteer = (await import(pathToFileURL(require.resolve('puppeteer-core')))).default
// Same configured archive, extracted once as transport setup. The library's
// executable materialization and all launch calls below remain unmodified.
process.env.CHROMIUM_BINARY_URL = pack

function loadTsModule(source, fileName) {
  const js = ts.transpileModule(source, { fileName, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  const mod = { exports: {} }
  const scopedRequire = id => id === '@sparticuz/chromium' ? { __esModule: true, default: chromium } : require(id)
  new Function('require', 'module', 'exports', js)(scopedRequire, mod, mod.exports)
  return mod.exports
}
const telemetrySource = fs.readFileSync(variant === 'baseline' ? '/qa/baseline-telemetry.ts' : '/source/src/lib/pdf/pdf-telemetry.ts', 'utf8')
const { createPdfTelemetry } = loadTsModule(telemetrySource, 'pdf-telemetry.ts')
const source = fs.readFileSync(variant === 'baseline' ? '/qa/baseline-generator.ts' : '/source/src/lib/pdf/gerarContrato.ts', 'utf8')
report.generatorSourceSha256 = createHash('sha256').update(source).digest('hex')
const ast = ts.createSourceFile('gerarContrato.ts', source, ts.ScriptTarget.Latest, true)
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'htmlParaPdf')
if (!declaration) throw new Error('Shared htmlParaPdf function missing')
const functionJs = ts.transpileModule(declaration.getText(ast), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const exports = {}
const resolver = variant === 'fixed' ? loadTsModule(fs.readFileSync('/source/src/lib/pdf/chromium-executable.ts', 'utf8'), 'chromium-executable.ts').resolverExecutavelChromium : undefined
const htmlParaPdf = new Function('chromium', 'puppeteer', 'createPdfTelemetry', 'Buffer', 'exports', 'resolverExecutavelChromium', functionJs + '\nreturn htmlParaPdf;')(chromium, puppeteer, createPdfTelemetry, Buffer, exports, resolver)
const pdfParse = Number(process.versions.node.split('.')[0]) === 22 ? require('pdf-parse/lib/pdf-parse.js') : null
await fsp.mkdir('/qa/pdfs', { recursive: true })
async function generate(label) {
  const started = performance.now()
  let phase = 'GENERATE'
  try {
    const html = '<!doctype html><html><head><style>@page{size:A4;margin:20mm}.next{break-before:page}</style></head><body>' + [1, 2, 3].map((n, i) => '<section' + (i ? ' class="next"' : '') + '><h1>QA PDF PAGE ' + n + '</h1><p>BW Antecipa synthetic runtime check ' + label + '</p></section>').join('') + '</body></html>'
    const pdf = await htmlParaPdf(html, createPdfTelemetry('pdf', event => report.telemetry.push(event)))
    await fsp.writeFile('/qa/pdfs/' + variant + '-' + mode + '-' + process.version + '-' + label + '.pdf', pdf)
    phase = 'VALIDATE'
    const parsed = pdfParse ? await pdfParse(pdf) : null
    if (parsed && (parsed.numpages !== 3 || ![1, 2, 3].every(n => parsed.text.includes('QA PDF PAGE ' + n)))) throw new Error('PDF completeness check failed')
    const result = { label, status: parsed ? 'PASS' : 'RENDERED_PENDING_INDEPENDENT_VALIDATION', bytes: pdf.length, pages: parsed?.numpages ?? null, durationMs: performance.now() - started }
    report.results.push(result)
    return result
  } catch (error) {
    const result = { label, status: 'FAIL', phase, errorName: error.name, validationMessage: phase === 'VALIDATE' && /^[a-zA-Z0-9 .:()_-]{1,150}$/.test(error.message) ? error.message : undefined, code: error.code ?? null, errno: error.errno ?? null, path: error.path ?? null, mentionsEtxtbsy: String(error.message).includes('ETXTBSY'), durationMs: performance.now() - started }
    report.results.push(result)
    return result
  }
}

try {
  const first = generate('cold-first')
  await writeOpened
  const duringWrite = generate('cold-during-write')
  await Promise.all([first, duringWrite])
  for (let i = 0; i < 3; i++) await generate('warm-' + i)
  const metadata = async () => {
    const file = path.join(os.tmpdir(), 'chromium'), stat = await fsp.stat(file)
    return { path: file, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, sha256: createHash('sha256').update(await fsp.readFile(file)).digest('hex') }
  }
  report.executableBeforeConcurrency = await metadata()
  await Promise.all(Array.from({length:4}, (_, i) => generate('parallel-' + i)))
  report.executableAfterConcurrency = await metadata()
  report.executableUnchanged = JSON.stringify(report.executableBeforeConcurrency) === JSON.stringify(report.executableAfterConcurrency)
  const version = cp.spawnSync(path.join(os.tmpdir(), 'chromium'), ['--version'], { encoding: 'utf8' })
  report.browserVersion = version.status === 0 ? version.stdout.trim() : 'VERSION_QUERY_FAILED'
  report.activeWriterCountAtEnd = active.size
  await fsp.writeFile('/qa/' + variant + '-' + mode + '-' + process.versions.node.split('.')[0] + '.json', JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ node: report.node, browserVersion: report.browserVersion, results: report.results, nativeErrors: report.spawns.filter(s => s.nativeError), writerCount: report.writers.length, activeWriterCountAtEnd: active.size }))
} catch (error) {
  console.error(JSON.stringify({ fatal: true, name: error.name, code: error.code ?? null, message: 'Diagnostic failed; inspect private evidence without publishing URL or document data.' }))
  await fsp.writeFile('/qa/baseline-fatal-' + process.versions.node.split('.')[0] + '.json', JSON.stringify(report, null, 2))
  process.exitCode = 1
}
