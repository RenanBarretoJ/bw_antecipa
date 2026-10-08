import assert from 'node:assert/strict'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { homedir } from 'node:os'
import { createHash } from 'node:crypto'
import pg from 'pg'

export const ref = 'yynlrtonrqxoatmuclrt'
export const base = 'https://bw-antecipa-git-hotfix-sacado-multi-cnpj-renanbarretoj.vercel.app'
export const manifest = JSON.parse(readFileSync('scripts/qa/sacado/preview-manifest.json','utf8'))
assert.equal(manifest.projectRef, ref)
assert.equal(manifest.mode, 'MANUAL_EXPLICIT_LIST')
assert.equal(manifest.gitBranch, 'hotfix/sacado-multi-cnpj')
const git = spawnSync('git',['branch','--show-current'],{encoding:'utf8',windowsHide:true})
assert.equal(git.stdout.trim(),manifest.gitBranch)
const config = readFileSync('supabase/config.toml','utf8')
for(const section of ['db.migrations','db.seed']) assert(config.includes(`[remotes."hotfix/sacado-multi-cnpj".${section}]\nenabled = false`) || config.includes(`[remotes."hotfix/sacado-multi-cnpj".${section}]\r\nenabled = false`))

export function migration() {
  assert.equal(manifest.migrations.length,1)
  const entry=manifest.migrations[0]
  assert.equal(entry.version,'20261005154435')
  assert.equal(entry.file,`supabase/migrations/${entry.version}_sacado_multi_cnpj_acessos.sql`)
  const source=readFileSync(entry.file,'utf8').replaceAll('\r\n','\n')
  assert.equal(createHash('sha256').update(source).digest('hex'),entry.sha256,'MIGRATION_HASH_MISMATCH')
  return {...entry,source}
}

export function details() {
  const r=spawnSync(process.execPath,[resolve('node_modules/supabase/dist/supabase.js'),'branches','get',manifest.branchId,'--project-ref',manifest.parentProjectRef,'-o','json'],{encoding:'utf8',windowsHide:true,timeout:60000})
  assert.equal(r.status,0,'PREVIEW_CREDENTIAL_LOOKUP_FAILED')
  const d=JSON.parse(r.stdout)
  assert.equal(new URL(d.SUPABASE_URL).hostname,`${ref}.supabase.co`)
  const url=new URL(d.POSTGRES_URL)
  assert(url.hostname===`db.${ref}.supabase.co` || decodeURIComponent(url.username).endsWith(`.${ref}`))
  return d
}
export async function connect(d) {
  const db=new pg.Client({connectionString:d.POSTGRES_URL,ssl:{rejectUnauthorized:false},connectionTimeoutMillis:20000})
  await db.connect()
  assert.equal(Number((await db.query("select count(*) n from supabase_migrations.schema_migrations where version='20260929193129'")).rows[0].n),0,'ORIGINAL_A6_PRESENT')
  return db
}
// QA-only secrets encrypted with Windows DPAPI, outside repository and memory files.
const directory=join(homedir(),'.codex','tmp','sacado-r2')
const file=join(directory,'qa-credentials.dpapi')
function powershell(command,input) {
  const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{input,encoding:'utf8',windowsHide:true})
  assert.equal(r.status,0,'QA_SECRET_DPAPI_FAILED')
  return r.stdout.trim()
}
export function saveCredentials(value) {
  mkdirSync(directory,{recursive:true})
  const encrypted=powershell('$v=[Console]::In.ReadToEnd(); ConvertTo-SecureString -String $v -AsPlainText -Force | ConvertFrom-SecureString',JSON.stringify(value))
  writeFileSync(file,encrypted)
}
export function loadCredentials() {
  const plain=powershell('$s=ConvertTo-SecureString ([Console]::In.ReadToEnd()); $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Console]::Write([Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }',readFileSync(file,'utf8'))
  const value=JSON.parse(plain)
  assert.equal(value.ref,ref)
  return value
}
