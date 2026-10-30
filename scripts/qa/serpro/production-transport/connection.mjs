import assert from 'node:assert/strict'
import {existsSync} from 'node:fs'
import {checkServerIdentity} from 'node:tls'
import pg from 'pg'
import {assertConnectionPlan,isReadOnlyPlan,hash,timeoutPolicy} from './contract.mjs'
import {identitySql,stateSql,catalogSql,readOnlyBeginSql} from './inspection-queries.mjs'

const factories=new WeakMap()
const handles=new WeakMap()

export function clientConfiguration(plan,credentials) {
  assertConnectionPlan(plan)
  assert.deepEqual(Object.keys(credentials).sort(),['ca','password'])
  // Existing credentials are authenticated by Postgres, not enrolled here.
  // Do not trim, normalize or impose an application password creation policy.
  assert.equal(typeof credentials.password,'string');assert.ok(credentials.password.length>0,'R53_NONEMPTY_CREDENTIAL_REQUIRED')
  assert.ok(Buffer.isBuffer(credentials.ca));assert.equal(hash(credentials.ca),plan.caSha256,'R48_PINNED_CA_MISMATCH')
  return {
    host:plan.endpoint.host,port:plan.endpoint.port,database:plan.endpoint.database,user:plan.sessionUser,
    password:credentials.password,client_encoding:'UTF8',application_name:'r48-'+plan.runId,
    options:'-c client_encoding=UTF8'+(isReadOnlyPlan(plan)?' -c default_transaction_read_only=on':''),fallback_application_name:'r48-'+plan.runId,keepAlive:true,enableChannelBinding:true,
    connectionTimeoutMillis:timeoutPolicy.processMs,statement_timeout:timeoutPolicy.statementMs,
    lock_timeout:timeoutPolicy.lockMs,idle_in_transaction_session_timeout:timeoutPolicy.idleTransactionMs,
    sslnegotiation:'postgres',ssl:{ca:Buffer.from(credentials.ca),minVersion:'TLSv1.2',rejectUnauthorized:true,
      servername:plan.endpoint.serverName,checkServerIdentity:(_name,cert)=>checkServerIdentity(plan.endpoint.serverName,cert)},
  }
}

/** Only versioned metadata SELECTs, with the bound cutoff, cross this boundary.
 * No caller SQL, transaction control, config object, callback or driver options. */
export function assertReadOnlyQuery(plan,args) {
  assertConnectionPlan(plan);assert.ok(isReadOnlyPlan(plan),'R53_READ_ONLY_PLAN_REQUIRED')
  assert.ok(args.length>=1&&args.length<=2,'R53_READ_ONLY_QUERY_NOT_ALLOWED')
  const [text,values]=args
  assert.ok(typeof text==='string'&&[identitySql,stateSql,catalogSql].includes(text),'R53_READ_ONLY_QUERY_NOT_ALLOWED')
  if(text===stateSql)assert.deepEqual(values,[plan.evidence.cutoff],'R53_READ_ONLY_BOUND_CUTOFF_REQUIRED')
  else assert.equal(values,undefined,'R53_READ_ONLY_QUERY_OPTIONS_REFUSED')
}

export function readOnlyQueryArguments(plan,args) {
  assertReadOnlyQuery(plan,args)
  // pg may queue a query. Never retain the caller's mutable values array.
  return args[0]===stateSql?[stateSql,[plan.evidence.cutoff]]:[args[0]]
}

/** Constructs connections only on explicit connect(); imports perform no I/O.
 * Credentials are explicit parameters, never read from env, disk or platform.
 */
export function createConnectionFactory(plan,credentials) {
  const config=clientConfiguration(plan,credentials)
  if(['LOCAL_CERTIFICATION','LOCAL_READ_ONLY_PREFLIGHT'].includes(plan.kind))assert.ok(existsSync('/.dockerenv'),'R48_LOCAL_CONNECTION_REQUIRES_CONTAINED_RUNNER')
  const factory={async connect(){
    assertConnectionPlan(plan)
    const readOnly=isReadOnlyPlan(plan)
    const client=new pg.Client(config)
    let deadline
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
      if(readOnly){
        deadline=setTimeout(()=>stream.destroy(),timeoutPolicy.processMs)
        await client.query(readOnlyBeginSql)
      }
      const handle={query:(...args)=>client.query(...(readOnly?readOnlyQueryArguments(plan,args):args)),abort:()=>{clearTimeout(deadline);stream.destroy()},
        async close(){clearTimeout(deadline);let timer;const end=(async()=>{if(readOnly){try{await client.query('ROLLBACK')}catch{stream.destroy()}}await client.end()})();try{await Promise.race([end,new Promise((_,reject)=>{timer=setTimeout(()=>{stream.destroy();reject(new Error('R48_CLOSE_TIMEOUT'))},timeoutPolicy.processMs)})])}finally{clearTimeout(timer)}},
        tls:Object.freeze({version:stream.getProtocol(),authorized:true,certificateSha256:hash(peer.raw)}),
      }
      handles.set(handle,{plan:plan.digest,client});return Object.freeze(handle)
    }catch(error){clearTimeout(deadline);try{client.connection?.stream?.destroy()}catch{/* no retry */}throw error}
  }}
  Object.freeze(factory);factories.set(factory,plan.digest);return factory
}

export function assertFactory(factory,plan){assertConnectionPlan(plan);assert.equal(factories.get(factory),plan.digest,'R48_FACTORY_PLAN_MISMATCH')}
export function assertConnection(handle,plan){assert.equal(handles.get(handle)?.plan,plan.digest,'R48_UNVERIFIED_CONNECTION')}
