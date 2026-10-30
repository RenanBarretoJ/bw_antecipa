import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {checkServerIdentity} from 'node:tls'
import pg from 'pg'
import {assertPlan,hash,timeoutPolicy} from './contract.mjs'

const factories=new WeakMap()
const handles=new WeakMap()

export function clientConfiguration(plan,credentials) {
  assertPlan(plan)
  assert.deepEqual(Object.keys(credentials).sort(),['ca','password'])
  assert.equal(typeof credentials.password,'string');assert.ok(credentials.password.length>=16)
  assert.ok(Buffer.isBuffer(credentials.ca));assert.equal(hash(credentials.ca),plan.caSha256,'R48_PINNED_CA_MISMATCH')
  return {
    host:plan.endpoint.host,port:plan.endpoint.port,database:plan.endpoint.database,user:plan.sessionUser,
    password:credentials.password,client_encoding:'UTF8',application_name:'r48-'+plan.runId,
    options:'-c client_encoding=UTF8',fallback_application_name:'r48-'+plan.runId,keepAlive:true,enableChannelBinding:true,
    connectionTimeoutMillis:timeoutPolicy.processMs,statement_timeout:timeoutPolicy.statementMs,
    lock_timeout:timeoutPolicy.lockMs,idle_in_transaction_session_timeout:timeoutPolicy.idleTransactionMs,
    sslnegotiation:'postgres',ssl:{ca:Buffer.from(credentials.ca),minVersion:'TLSv1.2',rejectUnauthorized:true,
      servername:plan.endpoint.serverName,checkServerIdentity:(_name,cert)=>checkServerIdentity(plan.endpoint.serverName,cert)},
  }
}

/** Constructs connections only on explicit connect(); imports perform no I/O.
 * Credentials are explicit parameters, never read from env, disk or platform.
 */
export function createConnectionFactory(plan,credentials) {
  const config=clientConfiguration(plan,credentials)
  if(plan.kind==='LOCAL_CERTIFICATION')assert.ok(existsSync('/.dockerenv'),'R48_LOCAL_CONNECTION_REQUIRES_CONTAINED_RUNNER')
  const factory={async connect(){
    assertPlan(plan)
    const client=new pg.Client(config)
    // pg emits connection errors outside pending queries as well. No raw errors
    // or connection options may be logged; query failures still propagate.
    client.on('error',()=>{})
    try {
      await client.connect()
      const stream=client.connection.stream
      assert.ok(stream.encrypted&&stream.authorized,'R48_VERIFIED_TLS_REQUIRED')
      assert.ok(['TLSv1.2','TLSv1.3'].includes(stream.getProtocol()),'R48_TLS_VERSION_REQUIRED')
      assert.equal(checkServerIdentity(plan.endpoint.serverName,stream.getPeerCertificate()),undefined,'R48_TLS_HOSTNAME_MISMATCH')
      const peer=stream.getPeerCertificate()
      const handle={query:(...args)=>client.query(...args),abort:()=>stream.destroy(),
        async close(){const end=client.end();let timer;try{await Promise.race([end,new Promise((_,reject)=>{timer=setTimeout(()=>{stream.destroy();reject(new Error('R48_CLOSE_TIMEOUT'))},timeoutPolicy.processMs)})])}finally{clearTimeout(timer)}},
        tls:Object.freeze({version:stream.getProtocol(),authorized:true,certificateSha256:hash(peer.raw)}),
      }
      handles.set(handle,{plan:plan.digest,client});return Object.freeze(handle)
    }catch(error){try{client.connection?.stream?.destroy()}catch{/* no retry */}throw error}
  }}
  Object.freeze(factory);factories.set(factory,plan.digest);return factory
}

export function assertFactory(factory,plan){assertPlan(plan);assert.equal(factories.get(factory),plan.digest,'R48_FACTORY_PLAN_MISMATCH')}
export function assertConnection(handle,plan){assert.equal(handles.get(handle)?.plan,plan.digest,'R48_UNVERIFIED_CONNECTION')}
