import assert from 'node:assert/strict'
import { hash } from './r1-4-restorer.mjs'
import { redactCommandOutput } from '../../perf9e/clean-room-lib.mjs'
export function storageTrace(correlationId,intent,onTrace=()=>{}){
  return async function step(name,expected,action){
    const record={stage:name,started_at:new Date().toISOString(),completed_at:null,correlation_id:correlationId,
      synthetic_object_path_sha256:hash(intent.path),expected_outcome:expected.reject?'REJECT':'ALLOW',
      expected_sqlstate:expected.code??null,actual_outcome:null,sqlstate:null,status:null,sanitized_error:null,result:'IN_PROGRESS'}
    onTrace(record)
    let value,error
    try{value=await action()}catch(e){error=e}
    record.completed_at=new Date().toISOString();record.actual_outcome=error?'REJECTED':'ALLOWED'
    if(error){record.sqlstate=/^[0-9A-Z]{5}$/.test(error.code??'')?error.code:null;record.status=error.status??null;record.sanitized_error=redactCommandOutput(error.message).slice(0,500)}
    try{
      if(expected.reject){
        assert(error,`${name}:EXPECTED_REJECTION_BUT_ALLOWED`)
        assert.match(error.message,expected.reject,`${name}:UNEXPECTED_REJECTION`)
        if(expected.code)assert.equal(error.code,expected.code,`${name}:UNEXPECTED_SQLSTATE`)
      }else if(error){throw error}
      record.result='PASS'
      return value
    }catch(e){record.result='FAIL';e.storageStage=name;throw e}
  }
}
