import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { docker } from '../../email-intake/disposable-resources.mjs'
export const suites=Object.freeze({probea:'pa',probeb:'pb',credential:'cred',inline:'inl',cnab:'cnab',operators:'ops',automation:'auto',operational:'oper',temporal:'tmp'})
export function stackSpec(suite,nonce=Date.now()){
  assert(Object.hasOwn(suites,suite),'UNKNOWN_SUITE');assert.match(String(nonce),/^\d{13}$/)
  const base=58000+Object.keys(suites).indexOf(suite)*10
  const projectId=`bw_email03_r110${suites[suite]}_${nonce}`
  assert(projectId.length<=36)
  return {suite,projectId,apiPort:base+1,dbPort:base+2,shadowPort:base,studioPort:base+3,mailPort:base+4,analyticsPort:base+7,applicationName:`r110_${suites[suite]}_${nonce}`}
}
export function assertR110Connection(connection,suite){
  assert.equal(connection.host,'127.0.0.1');assert.equal(connection.database,'postgres');assert.equal(connection.user,'postgres')
  const match=connection.application_name?.match(/^r110_([a-z]+)_(\d{13})$/);assert(match,'R110_APPLICATION_MARKER_REQUIRED')
  const found=Object.keys(suites).find(k=>suites[k]===match[1]);assert(found,'R110_UNKNOWN_SUITE')
  if(suite)assert.equal(found,suite)
  const spec=stackSpec(found,match[2]);assert.equal(connection.port,spec.dbPort);return spec
}
export async function assertR110OwnedConnection(connection,suite){
  const spec=assertR110Connection(connection,suite),name=`supabase_db_${spec.projectId}`
  const manifest=JSON.parse(await readFile(`rehearsal/reports/${spec.projectId}-resources.json`,'utf8'))
  assert.equal(manifest.projectId,spec.projectId);assert(!manifest.before.containers.includes(name));assert(manifest.resources.containers.includes(name))
  assert.equal(await docker(['inspect','--format','{{index .Config.Labels "com.supabase.cli.project"}}',name]),spec.projectId)
  assert.match(await docker(['port',name,'5432/tcp']),new RegExp(`:${spec.dbPort}(?:\\r?\\n|$)`))
  return spec
}
export function assertLocalApi(url,spec){assert.equal(new URL(url).origin,`http://127.0.0.1:${spec.apiPort}`)}
