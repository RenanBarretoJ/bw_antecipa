// Synthetic, disposable Linux reproduction. Never deploys the fixture route.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawn } from 'node:child_process'

assert.equal(process.argv[2], '--local-only')
assert(['--expect-pass', '--expect-missing-assets'].includes(process.argv[3]))
assert.equal(process.argv.length, 4)
const baseline = process.argv[3] === '--expect-missing-assets'
const root = process.cwd()
const output = await mkdtemp(join(process.env.LOCALAPPDATA || tmpdir(), 'bw-pdf-turbopack-'))
const fixture = join(output, 'fixture')
await mkdir(join(fixture, 'app/api/contratos/gerar-termo'), { recursive: true })
for (const file of ['package.json', 'package-lock.json']) await copyFile(resolve(root, file), join(fixture, file))
const config = await readFile(resolve(root, 'next.config.ts'), 'utf8')
const tracingAssets = "['./node_modules/@sparticuz/chromium/bin/**/*']"
assert.equal(config.split(tracingAssets).length - 1, 4, 'ASSET_TRACING_RULE_CHANGED')
const fixtureConfig = (baseline ? config.replaceAll(tracingAssets, '[]') : config)
  .replace('logging: false,', "logging: false,\n  output: 'standalone',")
await writeFile(join(fixture, 'next.config.ts'), fixtureConfig)
// Exercise the exact shared renderer without bringing database/auth modules or
// any application data into this synthetic standalone fixture.
const generator = await readFile(resolve(root, 'src/lib/pdf/gerarContrato.ts'), 'utf8')
const start = generator.indexOf('export async function htmlParaPdf(')
const end = generator.indexOf('\nasync function salvarPdfStorage(', start)
assert(start >= 0 && end > start, 'RENDERER_BOUNDARY_CHANGED')
const renderer = generator.slice(start, end)
await writeFile(join(fixture, 'renderer.ts'), `import chromium from '@sparticuz/chromium'\nimport puppeteer from 'puppeteer-core'\nimport {createPdfTelemetry, type PdfTelemetry} from './pdf-telemetry'\n${renderer}`)
await copyFile(resolve(root, 'src/lib/pdf/pdf-telemetry.ts'), join(fixture, 'pdf-telemetry.ts'))
await writeFile(join(fixture, 'app/api/contratos/gerar-termo/route.ts'), `
import {htmlParaPdf} from '../../../../renderer'
import {createPdfTelemetry, type PdfLogEvent} from '../../../../pdf-telemetry'
export const runtime = 'nodejs'
export async function GET() {
  const events: PdfLogEvent[] = []
  try {
    const pdf = await htmlParaPdf('<html><body>BW synthetic PDF runtime</body></html>', createPdfTelemetry('pdf', event => events.push(event)))
    return Response.json({ok: true, bytes: pdf.length, magic: pdf.subarray(0, 5).toString(), events})
  } catch (error) {
    // Local synthetic fixture only: no credentials, documents, or external requests.
    return Response.json({ok: false, stage: events.at(-1)?.stage, message: error instanceof Error ? error.message : String(error), events}, {status: 500})
  }
}
`)
const name = `bw-pdf-turbopack-${Date.now()}`
let created = false
const report = { output, name, baseline, sourceConfigSha256: createHash('sha256').update(config).digest('hex'),
  rendererSha256: createHash('sha256').update(renderer).digest('hex'), result: 'IN_PROGRESS', stages: [] }
const save = () => writeFile(join(output, 'REPORT.json'), JSON.stringify(report, null, 2))
async function command(stage, args) {
  console.log(JSON.stringify({ stage, status: 'START' }))
  const started = Date.now()
  const result = await new Promise((done, reject) => {
    const child = spawn('docker', args, { windowsHide: true })
    let log = ''
    child.stdout.on('data', b => { log += b })
    child.stderr.on('data', b => { log += b })
    child.on('error', reject)
    child.on('close', code => done({ code, log }))
  })
  await writeFile(join(output, `${stage}.log`), result.log)
  report.stages.push({ stage, code: result.code, durationMs: Date.now() - started })
  await save()
  console.log(JSON.stringify(report.stages.at(-1)))
  assert.equal(result.code, 0, `${stage}: ${result.log.slice(-3000)}`)
  return result.log
}
try {
  await command('create', ['run', '-d', '--name', name, '--label', 'bw.qa=pdf-turbopack', '--init',
    '--mount', `type=bind,source=${fixture},target=/input,readonly`, '-w', '/app',
    '-e', 'NEXT_TELEMETRY_DISABLED=1', '-e', 'NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co',
    '-e', 'VERCEL=1',
    'node:22-bookworm', 'sleep', 'infinity'])
  created = true
  report.imageId = (await command('image', ['image', 'inspect', 'node:22-bookworm', '--format', '{{.Id}}'])).trim()
  await command('copy', ['exec', name, 'node', '--input-type=module', '-e',
    "import {cp} from 'node:fs/promises'; await cp('/input','/app',{recursive:true});"])
  await command('npm-ci', ['exec', name, 'npm', 'ci', '--no-audit', '--no-fund'])
  await command('build', ['exec', name, 'node', 'node_modules/next/dist/bin/next', 'build'])
  report.assets = JSON.parse(await command('assets', ['exec', name, 'node', '--input-type=module', '-e', `
    import {readFile,readdir} from 'node:fs/promises';
    import {createHash} from 'node:crypto';
    const path='/app/.next/standalone/node_modules/@sparticuz/chromium/bin';
    let files=[];try{files=await readdir(path)}catch(e){if(e.code!=='ENOENT')throw e}
    console.log(JSON.stringify(await Promise.all(files.sort().map(async name=>{
      const bytes=await readFile(path+'/'+name);return {name,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
    }))));
  `]))
  await command('isolate', ['network', 'disconnect', 'bridge', name])
  report.runtime = JSON.parse(await command('runtime', ['exec', name, 'node', '--input-type=module', '-e', `
    import {spawn} from 'node:child_process';
    import {setTimeout} from 'node:timers/promises';
    const server=spawn(process.execPath,['server.js'],{cwd:'/app/.next/standalone',env:{...process.env,HOSTNAME:'127.0.0.1',PORT:'3100'},stdio:['ignore','ignore','inherit']});
    try {
      let response;
      for(let i=0;i<60;i++){try{response=await fetch('http://127.0.0.1:3100/api/contratos/gerar-termo');break}catch{await setTimeout(500)}}
      if(!response)throw new Error('LOCAL_SERVER_NOT_READY');
      console.log(JSON.stringify({status:response.status,body:await response.json()}));
    } finally {server.kill('SIGTERM')}
  `]))
  await save()
  console.log(JSON.stringify({ output, status: report.runtime.status, stage: report.runtime.body.stage, bytes: report.runtime.body.bytes }))
  if (!baseline) {
    assert.equal(report.assets.length, 4, 'CHROMIUM_PACKAGING_INCOMPLETE')
    assert.equal(report.runtime.status, 200, 'PDF_RUNTIME_FAILED')
    assert.equal(report.runtime.body.magic, '%PDF-')
    assert(report.runtime.body.bytes > 1000)
    assert(report.runtime.body.events.some(event => event.event === 'PDF_BROWSER_CLOSE_SUCCESS'))
  } else {
    assert.equal(report.assets.length, 0, 'BASELINE_CONTAINS_ASSETS')
    assert.equal(report.runtime.status, 500, 'BASELINE_FAILURE_NOT_REPRODUCED')
    assert.equal(report.runtime.body.stage, 'RESOLVE_CHROMIUM')
    assert.match(report.runtime.body.message, /The input directory .*chromium\/bin.*does not exist/)
  }
  report.result = 'PASS'
} catch (error) {
  report.result = 'FAIL'
  report.failure = error.message
  process.exitCode = 1
} finally {
  if (created) {
    await command('cleanup', ['rm', '-f', name])
    const remaining = await command('verify-cleanup', ['ps', '-aq', '--filter', `name=^/${name}$`])
    assert.equal(remaining.trim(), '', 'CREATED_CONTAINER_REMAINS')
    report.DOCKER_TEST_ENV_CLEANUP = 'PASS'
  } else report.DOCKER_TEST_ENV_CLEANUP = 'NO_RESOURCE_CREATED'
  await save()
}
console.log(JSON.stringify({ output, result: report.result, cleanup: report.DOCKER_TEST_ENV_CLEANUP }))
