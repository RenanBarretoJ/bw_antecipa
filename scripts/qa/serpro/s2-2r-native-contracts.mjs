import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// Called only by the contained provisioner AFTER pre/post-start inspections.
// Materialized test sources originate in /work, a read-only repository mount.
export async function runContainedNative({ docker, names, envArgs, password, anon, service, root, phase, qualityLinux = false }) {
  await phase('NATIVE_INTERNAL_SERVICES_READINESS')
  await docker(['exec', names.runner, 'node', '-e', `
    const fs=require('node:fs');fs.mkdirSync('/qa');fs.mkdirSync('/reports');
    for(const name of ['src','scripts','supabase','docs','.github','public','.gitattributes','.gitignore','AGENTS.md','CLAUDE.md','DOCUMENTACAO.md','README.md','components.json','eslint.config.mjs','next.config.ts','postcss.config.mjs','vercel.json','package.json','package-lock.json','tsconfig.json','vitest.config.ts']){
      if(fs.existsSync('/work/'+name))fs.cpSync('/work/'+name,'/qa/'+name,{recursive:true});
    }`])
  // Dependencies already live in an owned Linux volume, mounted READ ONLY.
  // Link in constant time; never stream the Windows dependency tree via Docker.
  await phase('MATERIALIZE_LOCK_VERIFIED_LINUX_DEPENDENCIES')
  await docker(['exec', names.runner, 'node', '-e', `const fs=require('node:fs'),crypto=require('node:crypto');
    const proof=JSON.parse(fs.readFileSync('/linux-deps/dependency-proof.json'));
    const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p,'utf8').replace(/\\r\\n/g,'\\n')).digest('hex');
    if(hash('/work/package-lock.json')!==proof.lockSha256||hash('/work/package.json')!==proof.packageSha256)throw Error('DEPENDENCY_LOCK_DRIFT');
    fs.symlinkSync('/linux-deps/node_modules','/qa/node_modules');`])
  const gateway = `const http=require('node:http'),net=require('node:net');
    const targets=[['/auth/v1','s22-auth',9999],['/rest/v1','s22-rest',3000],['/storage/v1','s22-storage',5000]];
    http.createServer((req,res)=>{const route=targets.find(([prefix])=>req.url===prefix||req.url.startsWith(prefix+'/'));
    if(!route){res.writeHead(404);res.end();return}
    const upstream=http.request({host:route[1],port:route[2],path:req.url.slice(route[0].length)||'/',method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res)});
    upstream.on('error',()=>{res.writeHead(502);res.end()});req.pipe(upstream)}).listen(57861,'127.0.0.1');
    net.createServer(socket=>{const upstream=net.connect(5432,'s22-db');socket.pipe(upstream);upstream.pipe(socket);upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy())}).listen(57862,'127.0.0.1');`
  await docker(['exec', '-d', names.runner, 'node', '-e', gateway])
  await docker(['exec', names.runner, 'node', '-e', `
    (async()=>{for(let i=0;i<120;i++){try{const results=await Promise.all(['http://s22-auth:9999/health','http://s22-rest:3000/','http://s22-storage:5000/status'].map(url=>fetch(url)));if(results.every(r=>r.ok))return}catch{}await new Promise(done=>setTimeout(done,500))}throw Error('NATIVE_SERVICES_NOT_READY')})()`])
  const env = { EMAIL_INTAKE_DISPOSABLE_SMOKE: 'true', EMAIL03_LOCAL_CONTRACT_REPORT: '/reports/contracts', LOCAL_QA_PG_PASSWORD: password,
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:57861', NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, SUPABASE_SERVICE_ROLE_KEY: service,
    SERPRO_NFE_ENABLED: 'false', SERPRO_NFE_WORKER_ENABLED: 'false', SERPRO_NFE_QUERY_ENABLED: 'false',
    SERPRO_NFE_CONTRACT_VERIFIED: 'false', SERPRO_NFE_CONSUMPTION_MODE: 'OFF_ZERO_BUDGET' }
  const exec = (args, timeout = 1200000, override = {}) => docker(['exec', '-w', '/qa', ...envArgs({ ...env, ...override }), names.runner, 'node', ...args], undefined, timeout)
  await phase('CI_NODE_CONTRACTS_NODE22_LINUX')
  const infra = await exec(['--test', 'scripts/qa/serpro/s2-2s-ci.test.mjs', 'scripts/qa/serpro/s2-2sr-linux-dependencies.test.mjs',
    'scripts/qa/vortx/main-native-images.test.mjs', 'scripts/qa/vortx/main-native-fixture.test.mjs', 'scripts/qa/vortx/main-native-snapshot.test.mjs'])
  await writeFile(resolve(root, 'ci-node-linux.tap'), infra)
  await phase('CANONICAL_SYNTHETIC_FIXTURE_NATIVE')
  const fixture = JSON.parse(await exec(['--input-type=module', '-e', `import {Client} from 'pg';import {seedNativeFixture} from './scripts/qa/vortx/main-native-fixture.mjs';
    const db=new Client({host:'127.0.0.1',port:57862,user:'postgres',password:process.env.LOCAL_QA_PG_PASSWORD,database:'postgres'});
    await db.connect();try{console.log(JSON.stringify(await seedNativeFixture(db)))}finally{await db.end()}`]))
  await phase('UNCHANGED_EMAIL03_NATIVE_CONTRACTS')
  try {
    await exec(['node_modules/vitest/vitest.mjs', 'run', 'src/lib/documentos/parcelas-nf-boleto-architecture.test.ts',
      'src/lib/notas-fiscais/c4-consultor-notas-fiscais.test.ts', 'src/test/s2-2r-gestor-native.test.ts', '--pool=threads', '--maxWorkers=1', '--no-file-parallelism',
      '--reporter=json', '--outputFile=/reports/native-vitest.json'])
  } finally { await docker(['cp', `${names.runner}:/reports/.`, root]) }
  const native = JSON.parse(await readFile(resolve(root, 'native-vitest.json'), 'utf8'))
  assert.equal(native.numFailedTests, 0, 'NATIVE_CONTRACT_FAILURE')
  const contracts = await Promise.all((await readdir(resolve(root, 'contracts'))).filter(name=>name.endsWith('.json'))
    .map(async name=>JSON.parse(await readFile(resolve(root, 'contracts', name), 'utf8'))))
  assert.deepEqual(contracts.map(item=>item.mode).sort(), ['ATOMIC_ROLLBACK', 'GESTOR_XML', 'INVALID_SUM', 'ISSUER_SCOPE', 'NO_DUP', 'ORDER_FANOUT'])
  assert.ok(contracts.every(item=>item.status==='PASS' && item.nativeAuth===true && item.checks.includes('NATIVE_PASSWORD_TOTP_CANONICAL_SESSION')))
  await phase('FULL_SUITE_NODE22_LINUX_NATIVE_QA')
  try {
    await exec(['node_modules/vitest/vitest.mjs', 'run', '--pool=threads', '--maxWorkers=1', '--no-file-parallelism',
      '--reporter=json', '--outputFile=/reports/full-vitest.json'])
  } finally { await docker(['cp', `${names.runner}:/reports/.`, root]) }
  const full = JSON.parse(await readFile(resolve(root, 'full-vitest.json'), 'utf8'))
  assert.equal(full.success, true, 'FULL_SUITE_UNSUCCESSFUL')
  assert.equal(full.numFailedTestSuites, 0, 'FULL_SUITE_COLLECTION_FAILURE')
  assert.equal(full.numFailedTests, 0, 'FULL_SUITE_FAILURE')
  assert.ok(full.numTotalTests>=4007, 'FULL_SUITE_INCOMPLETE')
  const quality = []
  if (qualityLinux) {
    const configuration = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:1', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'ci-synthetic-anon',
      SUPABASE_SERVICE_ROLE_KEY: 'ci-synthetic-service', NEXT_TELEMETRY_DISABLED: '1' }
    for (const [stage, args] of [ ['typescript-linux', ['node_modules/typescript/bin/tsc', '--noEmit']],
      ['lint-linux', ['node_modules/eslint/bin/eslint.js', '.']] ]) {
      await phase(stage)
      const start = Date.now(), output = await exec(args, 600000, configuration)
      await writeFile(resolve(root, `${stage}.log`), output)
      quality.push({ stage, status: 'PASS', elapsedMs: Date.now() - start })
    }
  }
  return { fixture, contracts, qualityLinux: quality, native: { passed:native.numPassedTests,failed:native.numFailedTests,skipped:native.numPendingTests },
    full: { total:full.numTotalTests,passed:full.numPassedTests,failed:full.numFailedTests,skipped:full.numPendingTests,
      pending: full.testResults.flatMap(file => file.assertionResults.filter(test => test.status === 'pending').map(test => ({file:file.name, name:test.fullName}))) },
    runtime:'NODE22_LINUX',portsPublished:false,externalProviderCalls:0 }
}
