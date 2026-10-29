import assert from 'node:assert/strict'
import {openSync,closeSync,writeSync,fsyncSync,readFileSync,fstatSync} from 'node:fs'
import {hash} from './policy.mjs'

const transitions={
  PREPARED:['IN_PROGRESS','FAILED'],
  IN_PROGRESS:['IN_PROGRESS','COMMIT_CONFIRMED','COMMIT_OUTCOME_UNKNOWN','ROLLED_BACK','FAILED'],
}
const fields=new Set(['state','version','transportVersion','sourceSha256','sqlSha256','commitSha256','fixture','database','actor','phase','reason','sqlstate','observationSha256','settings','errorKind','pid'])
export function verifyJournal(text) {
  let previous='0'.repeat(64)
  const states=new Map(),records=[]
  for(const line of text.trim().split('\n').filter(Boolean)) {
    const row=JSON.parse(line),{digest,...unsigned}=row
    assert.equal(row.previous,previous,'JOURNAL_CHAIN_BROKEN')
    assert.equal(digest,hash(JSON.stringify(unsigned)),'JOURNAL_DIGEST_INVALID')
    const old=states.get(row.version)
    assert.ok(old?transitions[old]?.includes(row.state):row.state==='PREPARED','JOURNAL_STATE_TRANSITION_INVALID')
    assert.equal(row.sequence,records.length+1,'JOURNAL_SEQUENCE_INVALID')
    states.set(row.version,row.state);previous=digest;records.push(row)
  }
  return {records,states,tail:previous}
}

export class Journal {
  constructor(path) {
    // Exclusive creation, no resume/retry entrypoint. OS ACL must protect parent.
    this.fd=openSync(path,'wx',0o600)
    this.path=path
    this.closed=false
    this.previous='0'.repeat(64)
    this.states=new Map()
    this.sequence=0
    if(process.platform!=='win32') assert.equal(fstatSync(this.fd).mode&0o077,0,'JOURNAL_PRIVATE_MODE_REQUIRED')
  }
  append(event) {
    assert.equal(this.closed,false,'JOURNAL_CLOSED')
    assert.ok(Object.keys(event).every(key=>fields.has(key)),'JOURNAL_UNSAFE_FIELD')
    const old=this.states.get(event.version)
    assert.ok(old?transitions[old]?.includes(event.state):event.state==='PREPARED','JOURNAL_STATE_TRANSITION_INVALID')
    assert.match(event.version,/^20261028[0-9]{6}$/)
    if(event.reason) assert.match(event.reason,/^[A-Z0-9_]{1,100}$/)
    if(event.sqlstate) assert.match(event.sqlstate,/^[A-Z0-9]{5}$/)
    const unsigned={sequence:this.sequence+1,observedAt:new Date().toISOString(),previous:this.previous,...event}
    const row={...unsigned,digest:hash(JSON.stringify(unsigned))}
    writeSync(this.fd,JSON.stringify(row)+'\n')
    fsyncSync(this.fd)
    this.previous=row.digest;this.sequence=row.sequence;this.states.set(event.version,event.state)
    return row
  }
  snapshot() { return verifyJournal(readFileSync(this.path,'utf8')) }
  close() { if(!this.closed){closeSync(this.fd);this.closed=true} }
}
