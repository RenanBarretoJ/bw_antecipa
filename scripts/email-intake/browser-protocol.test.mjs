import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createProtocolTrace,protocolError} from './browser-protocol.mjs'

test('protocol classes preserve timeout and invalid ID causes without raw errors',()=>{
  assert.equal(protocolError({originalMessage:'',message:'Fetch.getResponseBody timed out. Increase protocolTimeout SENSITIVE'}).errorClass,'COMMAND_TIMEOUT')
  assert.equal(protocolError({message:'Protocol error: Invalid InterceptionId SENSITIVE'}).errorClass,'INVALID_INTERCEPTION_ID')
  assert.equal(protocolError({message:'unknown SENSITIVE'}).errorClass,'OTHER_PROTOCOL_ERROR')
})

test('protocol trace persists only aliased IDs and closed outcomes, never arguments or results',async()=>{
  const cdp={send:async name=>name==='Browser.getVersion'?{product:'Chrome/test',protocolVersion:'1.3'}: {body:'SENSITIVE_BODY'}}
  const trace=await createProtocolTrace(cdp)
  trace.record('Fetch.requestPaused','SENSITIVE_NETWORK','SENSITIVE_FETCH')
  const body=await trace.command('Fetch.getResponseBody',{requestId:'SENSITIVE_FETCH',privateArgument:'SENSITIVE_ARGUMENT'},{networkId:'SENSITIVE_NETWORK',lifecycle:'RESPONSE_PAUSED'})
  assert.equal(body.body,'SENSITIVE_BODY')
  assert.equal(trace.timeline[0].networkId,trace.timeline[1].networkId)
  assert.equal(trace.timeline[0].fetchId,trace.timeline[2].fetchId)
  assert.equal(JSON.stringify(trace.timeline).includes('SENSITIVE'),false)
})
