import assert from 'node:assert/strict'
import { readFile, writeFile, access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { canonicalHash } from './s2-2s-manifest.mjs'

export const dependencyLimits = Object.freeze({ bytes: 2 * 1024 ** 3, files: 100000, installMs: 540000, transportMs: 600000 })

// Public build dependencies must not put Auth/Database/Storage tests on an
// internet-capable network. This container receives code, not QA credentials.
export async function runLinuxProductionBuild({ docker, id, image, owned, phase, root, volume }) {
  const name = `${id}-build`, network = `${id}-build-net`, start = Date.now()
  const sources = []
  for (const path of ['src','scripts','supabase','docs','.github','public','.gitattributes','.gitignore','AGENTS.md','CLAUDE.md',
    'DOCUMENTACAO.md','README.md','components.json','eslint.config.mjs','next.config.ts','postcss.config.mjs','vercel.json',
    'package.json','package-lock.json','tsconfig.json','vitest.config.ts']) {
    try { await access(path); sources.push(path) } catch { /* optional versioned config */ }
  }
  await phase('LINUX_WEBPACK_BUILD_PUBLIC_FONT_DEPENDENCIES_ONLY')
  await docker(['network','create','--label',`bw.qa.s22r=${id}`,network]); owned.push(['network',network])
  const script = `const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
    if(!process.version.startsWith('v22.'))throw Error('NODE22_REQUIRED');
    fs.mkdirSync('/build');for(const path of ${JSON.stringify(sources)})fs.cpSync('/inputs/'+path,'/build/'+path,{recursive:true});
    const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p,'utf8').replace(/\\r\\n/g,'\\n')).digest('hex');
    const proof=JSON.parse(fs.readFileSync('/linux-deps/dependency-proof.json'));
    if(hash('/build/package-lock.json')!==proof.lockSha256||hash('/build/package.json')!==proof.packageSha256)throw Error('BUILD_LOCK_DRIFT');
    fs.symlinkSync('/linux-deps/node_modules','/build/node_modules');
    const buildStartedAt=Date.now();
    const result=cp.spawnSync(process.execPath,['node_modules/next/dist/bin/next','build','--webpack'],{cwd:'/build',stdio:'inherit',timeout:540000});
    console.log(JSON.stringify({event:'LINUX_WEBPACK_BUILD_PROCESS_EXIT',elapsedMs:Date.now()-buildStartedAt,
      status:result.status??null,signal:result.signal??null,errorCode:result.error?.code??null}));
    if(result.error||result.status!==0)throw Error('LINUX_WEBPACK_BUILD_FAILED');`
  const environment = { NEXT_TELEMETRY_DISABLED:'1', NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:1',
    NEXT_PUBLIC_SUPABASE_ANON_KEY:'ci-synthetic-anon', SUPABASE_SERVICE_ROLE_KEY:'ci-synthetic-service', PORTAL_FIDC_CREDENTIALS_JSON:'{}',
    SERPRO_NFE_WORKER_ENABLED:'false', SERPRO_NFE_QUERY_ENABLED:'false', SERPRO_NFE_CONTRACT_VERIFIED:'false',
    SERPRO_NFE_CONSUMPTION_MODE:'OFF_ZERO_BUDGET', SERPRO_NFE_CONSUMER_KEY:'', SERPRO_NFE_CONSUMER_SECRET:'' }
  await docker(['create','--name',name,'--label',`bw.qa.s22r=${id}`,'--network',network,
    '--mount',`type=volume,source=${volume},target=/linux-deps,readonly`,
    ...sources.flatMap(path=>['--mount',`type=bind,source=${resolve(path)},target=/inputs/${path},readonly`]),
    ...Object.entries(environment).flatMap(([k,v])=>['-e',`${k}=${v}`]),image,'node','-e',script]); owned.push(['container',name])
  const inspect = JSON.parse(await docker(['inspect',name]))[0]
  assert.equal(inspect.Config.Labels['bw.qa.s22r'],id)
  assert.deepEqual(inspect.HostConfig.PortBindings??{},{})
  assert.equal(inspect.HostConfig.PublishAllPorts,false)
  assert.deepEqual(Object.keys(inspect.NetworkSettings.Networks),[network])
  assert.ok(inspect.Mounts.every(m=>!m.RW),'READ_ONLY_BUILD_INPUTS_REQUIRED')
  assert.equal(inspect.State.Running,false)
  const output = await docker(['start','-a',name],undefined,600000)
  await writeFile(resolve(root,'build-linux-webpack.log'),output)
  assert.equal(JSON.parse(await docker(['inspect',name]))[0].State.ExitCode,0)
  return { status:'PASS',runtime:'LINUX_NODE22',bundler:'webpack',elapsedMs:Date.now()-start,
    hostPorts:[],network,qaNetworkAttached:false,dataOrAuthMaterialMounted:false,realCredentials:false,
    publicDependencies:['fonts.googleapis.com','fonts.gstatic.com'],sourceMountsReadOnly:true }
}
export function verifyDependencyLock(text) {
  const lock = JSON.parse(text)
  assert.equal(lock.lockfileVersion, 3, 'LOCK_V3_REQUIRED')
  for (const [path, item] of Object.entries(lock.packages)) {
    if (!path) continue
    assert.ok(!item.link, 'LINKED_DEPENDENCY_REFUSED')
    const url = new URL(item.resolved)
    assert.equal(url.origin, 'https://registry.npmjs.org', 'PUBLIC_NPM_REGISTRY_ONLY')
    assert.ok(!url.username && !url.password && !url.search, 'REGISTRY_CREDENTIALS_REFUSED')
    assert.match(item.integrity, /^sha512-/, 'LOCK_INTEGRITY_REQUIRED')
  }
  return canonicalHash(text)
}
export function verifyBuilderInspection(container, network, id) {
  assert.equal(container.Config.Labels['bw.qa.s22r'], id, 'BUILDER_OWNERSHIP')
  assert.equal(network.Labels['bw.qa.s22r'], id, 'BUILDER_NETWORK_OWNERSHIP')
  assert.equal(network.Internal, false, 'REGISTRY_NETWORK_ONLY_DURING_PREPARATION')
  assert.deepEqual(container.HostConfig.PortBindings ?? {}, {}, 'BUILDER_NO_HOST_BINDINGS')
  assert.equal(container.HostConfig.PublishAllPorts, false)
  assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [`${id}-npm-net`])
  assert.ok(container.Mounts.filter(m => m.Type === 'bind').every(m => !m.RW), 'BUILDER_INPUTS_READ_ONLY')
  assert.deepEqual(container.Mounts.filter(m => m.Type === 'bind').map(m => m.Destination).sort(), ['/inputs/package-lock.json', '/inputs/package.json'])
  assert.equal(container.Mounts.filter(m => m.Type === 'volume' && m.Name === `${id}-deps` && m.Destination === '/deps').length, 1, 'OWN_DEPENDENCY_VOLUME_REQUIRED')
  return { name: container.Name, running: container.State.Running, ports: [], network: `${id}-npm-net`,
    repositoryMounted: false, productionMaterial: false, image: container.Image }
}

// Registry access exists only in this short-lived dependency builder. It sees
// two public dependency manifests, no repository, npmrc, environment or secrets.
// The QA stack is created afterwards on a DIFFERENT internal-only network.
export async function prepareLinuxDependencyVolume({ docker, id, image, owned, phase, root }) {
  assert.match(id, /^bw-s22r-\d+-\d+$/)
  const started = Date.now(), volume = `${id}-deps`, builder = `${id}-npm`, network = `${id}-npm-net`
  const packageText = await readFile('package.json', 'utf8')
  const lockText = await readFile('package-lock.json', 'utf8')
  const hashes = { package: canonicalHash(packageText), lock: verifyDependencyLock(lockText) }
  await phase('PREPARE_LOCKED_DEPENDENCIES_IN_OWN_LINUX_VOLUME')
  await docker(['volume', 'create', '--label', `bw.qa.s22r=${id}`, volume]); owned.push(['volume', volume])
  await docker(['network', 'create', '--label', `bw.qa.s22r=${id}`, network]); owned.push(['network', network])
  const script = `const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto');
    if(!process.version.startsWith('v22.'))throw Error('NODE22_REQUIRED');
    const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p,'utf8').replace(/\\r\\n/g,'\\n')).digest('hex');
    fs.copyFileSync('/inputs/package.json','/deps/package.json');fs.copyFileSync('/inputs/package-lock.json','/deps/package-lock.json');
    if(hash('/deps/package.json')!=='${hashes.package}'||hash('/deps/package-lock.json')!=='${hashes.lock}')throw Error('INPUT_HASH_DRIFT');
    const npm=cp.spawnSync('npm',['ci','--ignore-scripts','--include=optional','--no-audit','--no-fund','--fetch-retries=0','--registry=https://registry.npmjs.org'],
      {cwd:'/deps',stdio:'inherit',timeout:${dependencyLimits.installMs}});
    if(npm.error||npm.status!==0)throw Error('LOCKED_NPM_CI_FAILED');
    if(hash('/deps/package.json')!=='${hashes.package}'||hash('/deps/package-lock.json')!=='${hashes.lock}')throw Error('LOCK_MODIFIED');
    let files=0,bytes=0;for(const e of fs.readdirSync('/deps/node_modules',{recursive:true,withFileTypes:true})){
      if(e.isFile()){files++;bytes+=fs.statSync(require('node:path').join(e.parentPath,e.name)).size}}
    if(files>${dependencyLimits.files}||bytes>${dependencyLimits.bytes})throw Error('DEPENDENCY_VOLUME_LIMIT');
    fs.writeFileSync('/deps/dependency-proof.json',JSON.stringify({node:process.version,lockSha256:'${hashes.lock}',packageSha256:'${hashes.package}',files,bytes,installScripts:false,registry:'https://registry.npmjs.org'}));`
  await docker(['create', '--name', builder, '--label', `bw.qa.s22r=${id}`, '--network', network,
    '--mount', `type=volume,source=${volume},target=/deps`,
    ...['package.json', 'package-lock.json'].flatMap(file => ['--mount', `type=bind,source=${resolve(file)},target=/inputs/${file},readonly`]),
    '-e', 'NPM_CONFIG_USERCONFIG=/dev/null', '-e', 'NPM_CONFIG_CACHE=/tmp/npm-cache',
    '-w', '/deps', image, 'node', '-e', script])
  owned.push(['container', builder])
  const inspect = () => docker(['inspect', builder]).then(text => JSON.parse(text)[0])
  const networkInfo = JSON.parse(await docker(['network', 'inspect', network]))[0]
  const before = verifyBuilderInspection(await inspect(), networkInfo, id)
  assert.equal(before.running, false, 'BUILDER_INSPECT_BEFORE_START')
  const output = await docker(['start', '-a', builder], undefined, dependencyLimits.transportMs)
  await writeFile(resolve(root, 'dependency-install.log'), output)
  const after = await inspect()
  verifyBuilderInspection(after, networkInfo, id)
  assert.equal(after.Image, before.image, 'BUILDER_IMAGE_DRIFT')
  assert.equal(after.State.ExitCode, 0, 'BUILDER_INSTALL_FAILED')
  // Remove registry connectivity before any synthetic Auth fixture is created.
  await docker(['rm', '-v', builder]); owned.splice(owned.findIndex(([k, n]) => k === 'container' && n === builder), 1)
  await docker(['network', 'rm', network]); owned.splice(owned.findIndex(([k, n]) => k === 'network' && n === network), 1)
  return { method: 'NPM_CI_IN_OWN_LINUX_VOLUME', volume, hashes, limits: dependencyLimits,
    elapsedMs: Date.now() - started, builderInspection: before, registryBuilderRemoved: true,
    installScripts: false, hostDependencyTreeTransferred: false }
}
