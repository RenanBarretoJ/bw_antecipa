import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { assertR110Connection,assertLocalApi } from './r1-10-stack-guard.mjs'

export function localStorageFixture(local, projectId, freshConnection=null) {
  const r17=/^bw_email03_r1(?:[789]|10|12)(?:prod|homolog|clean)_\d+$/.test(projectId)
  if(freshConnection){const spec=assertR110Connection(freshConnection,'operational');assert.equal(spec.projectId,projectId);assertLocalApi(local.API_URL,spec)}
  else assert.equal(new URL(local.API_URL).origin, r17?'http://127.0.0.1:57941':'http://127.0.0.1:57841')
  // R1.4 reuses the same physical Storage proof in the two owned full-upgrade stacks.
  assert(freshConnection||r17||/^bw_email03_(?:r12|r1full_(?:prod|homolog|cleanroom))_\d+$/.test(projectId),'OWNED_LOCAL_PROJECT_REQUIRED')
  const api = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}})
  const bytes = Buffer.alloc(100,32)
  bytes.write('%PDF-1.4\n% Synthetic storage-only fixture\n%%EOF\n')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  const physicalCount = id => new Promise((done,reject) => {
    assert.match(id,/^[0-9a-f-]{36}$/)
    const child=spawn('docker',['exec','-i',`supabase_storage_${projectId}`,'node','-',id],{windowsHide:true})
    let output=''; child.stdout.on('data',b=>{output+=b}); child.on('error',reject)
    child.on('exit',code=>code===0&&/^\d+$/.test(output.trim())?done(Number(output.trim())):reject(new Error('PHYSICAL_STORAGE_INSPECTION_FAILED')))
    child.stdin.end(`const fs=require('node:fs'),path=require('node:path');const root=process.env.FILE_STORAGE_BACKEND_PATH;if(!root||!fs.existsSync(root))process.exit(2);let n=0;function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,e.name);if(e.isDirectory())walk(p);else if(e.isFile()&&p.includes(process.argv[2]))n++}}walk(root);process.stdout.write(String(n));`)
  })
  return {sha256, physicalCount,
    async put(intent) {
      const result=await api.storage.from(intent.bucket).upload(intent.path,bytes,{contentType:intent.path.endsWith('.xml')?'application/xml':'application/pdf',upsert:false})
      if(result.error){const error=new Error(`LOCAL_STORAGE_UPLOAD:${result.error.statusCode}:${result.error.message}`);error.status=result.error.statusCode;throw error}
    },
    async remove(intent) {
      const result=await api.storage.from(intent.bucket).remove([intent.path])
      assert(!result.error, 'LOCAL_STORAGE_DELETE_FAILED')
    },
    async verify(intent) {
      const result=await api.storage.from(intent.bucket).download(intent.path)
      assert(!result.error&&result.data,'LOCAL_STORAGE_ORIGINAL_MISSING')
      assert.equal(createHash('sha256').update(Buffer.from(await result.data.arrayBuffer())).digest('hex'),sha256)
    },
  }
}
