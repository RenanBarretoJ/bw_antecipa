import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'

const path = 'supabase/migrations/20261021155151_vortx_inclusao_persistence.sql'
const migration = readFileSync(new URL('../../../' + path, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const sha = v => createHash('sha256').update(JSON.stringify(v)).digest('hex')

/** Runs after every historical stock/PDD assertion, in EACH fresh independent stack. */
export async function checkInclusao({ db, config, internal, asRole, fund, otherFund, actor, version, endpoint, stack }) {
  const funcs = (await db.query(`select oid,pg_get_functiondef(oid) def,proacl::text acl from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace)`)).rows
  const tables = (await db.query(`select oid,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where relnamespace in ('public'::regnamespace,'private'::regnamespace)`)).rows
  const stock = async () => (await db.query(`select * from (select to_jsonb(p) r,'ativo' tipo from vortx_posicao_ativos p union all select to_jsonb(p),'parcela' from vortx_posicao_parcelas p union all select to_jsonb(p),'legado' from estoque_posicoes p) s order by tipo,r::text`)).rows
  const beforeStock = sha(await stock())
  await db.query(migration)
  assert.deepEqual((await db.query('select oid,pg_get_functiondef(oid) def,proacl::text acl from pg_proc where oid=ANY($1::oid[])', [funcs.map(f => f.oid)])).rows.sort((a,b)=>a.oid-b.oid), funcs.sort((a,b)=>a.oid-b.oid))
  assert.deepEqual((await db.query('select oid,relacl::text,relrowsecurity,relforcerowsecurity from pg_class where oid=ANY($1::oid[])', [tables.map(t => t.oid)])).rows.sort((a,b)=>a.oid-b.oid), tables.sort((a,b)=>a.oid-b.oid))
  stack.inclusionMigration = { path, sha256: createHash('sha256').update(migration).digest('hex') }
  stack.tests.push('inclusion_forward_preserves_every_existing_function_acl_rls_and_stock_row')
  await db.query(`insert into integracao_fundo_versao_capacidades(integracao_fundo_versao_id,fundo_id,ambiente,capability,disponivel_desde) values($1,$2,'homologacao','AQUISICOES',now()-interval '1 day')`, [version,fund])
  async function event({ start='2026-10-15',end='2026-10-16',reference=end,correlated=true,type='Inclusao' }={}) {
    const request=randomUUID(),id=randomUUID(),protocol=randomUUID()
    await db.query(`insert into vortx_relatorio_solicitacoes(id,fundo_id,integracao_versao_id,ambiente,pedido,hash_pedido,estado,protocolo_externo,codigo_http,solicitada_por,session_id,lease_hash)
      values($1,$2,$3,'homologacao',$4,$5,'aceita',$6,201,$7,$8,$9)`,[request,fund,version,{tipoRelatorio:type,dataInicio:start,dataFim:end,dataReferencia:reference,codigoCarteira:'QA-CARTEIRA',extensaoArquivo:2},sha(id),protocol,actor,randomUUID(),sha(request)])
    await db.query(`insert into vortx_relatorio_eventos(id,endpoint_id,fundo_id,ambiente,solicitacao_id,protocolo_externo,tipo_relatorio,status_relatorio,data_referencia,data_inicio,data_fim,data_expiracao,correlacao,metadados,hash_evento,payload_criptografado,chave_versao)
      values($1,$2,$3,'homologacao',$4,$5,$6,'Disponível',$7,$8,$9,now()+interval '1 day',$10,'{"idCarteira":"QA-CARTEIRA"}',$11,$12,'synthetic')`,[id,endpoint,fund,correlated?request:null,protocol,type,reference,start,end,correlated?'CORRELACIONADO':'PENDENTE',sha(id),'v1:'+'x'.repeat(50)])
    return {id,request}
  }
  const reserve=()=>internal('select vortx_reservar_processamento_inclusao($1) r',[fund]).then(r=>r.rows[0].r)
  const manifest=(j,rows)=>{const id=randomUUID();return {id,fundo_id:fund,versao_id:version,ambiente:'homologacao',codigo_carteira:'QA-CARTEIRA',data_referencia:j.data_referencia,data_inicio:j.data_inicio,data_fim:j.data_fim,hash_conteudo:sha([j.data_referencia,j.data_inicio,j.data_fim,rows]),linhas_total:rows.length,arquivo:{id:randomUUID(),storage_bucket:'financeiro-importacoes',storage_path:`${fund}/vortx/${id}/inclusao.csv`,tamanho_bytes:100,hash_conteudo:sha(rows)}}}
  const row=(j,patch={},number=2)=>({numero_linha:number,dados_brutos:{'Valor de Compra':'90.00'},dados_normalizados:{fundo_id:fund,codigo_carteira:'QA-CARTEIRA',data_referencia:j.data_referencia,cedente_documento:'98992300000280',sacado_documento:'98992300000360',chave_ativo:'A1',chave_parcela:'P1',tipo_recebivel:'DUPLICATA',data_movimento:'2026-10-15',data_vencimento:'2026-11-20',valor_nominal:'100.0000',valor_aquisicao:'90.0000',...patch}})
  const intent=(j,m)=>internal('select vortx_manifesto_inclusao($1,$2,$3) r',[j.id,j.lease,m])
  const block=(j,rows,order=1)=>internal('select vortx_estagiar_inclusao($1,$2,$3,$4) r',[j.id,j.lease,order,JSON.stringify(rows)])
  const finish=j=>internal('select vortx_concluir_inclusao($1,$2) r',[j.id,j.lease]).then(r=>r.rows[0].r)
  const prepare=async(options={})=>{await event(options);const job=await reserve();assert(job);return job}
  await event({correlated:false});await event({type:'Exclusao'})
  assert.equal(await reserve(),null)
  stack.tests.push('inclusion_orphan_and_exclusion_never_reserved_or_adopted')
  await event()
  const concurrent=async()=>{const c=new pg.Client(config);await c.connect();try{await c.query('begin;set local role service_role');await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'service_role'})]);const r=await c.query('select vortx_reservar_processamento_inclusao($1) r',[fund]);await c.query('commit');return r.rows[0].r}finally{await c.end()}}
  const claims=await Promise.all([concurrent(),concurrent()]);assert.equal(claims.filter(Boolean).length,1)
  const j=claims.find(Boolean),rows=[row(j),row(j,{cedente_documento:'98992300000441'},3)],m=manifest(j,rows)
  assert.equal(j.data_inicio,'2026-10-15');assert.equal(j.evento.tipo_relatorio,'Inclusao')
  await assert.rejects(intent({...j,lease:randomUUID()},m),{code:'42501'})
  await assert.rejects(intent(j,{...m,fundo_id:otherFund}),{code:'23514'})
  await assert.rejects(intent(j,{...m,ambiente:'producao'}),{code:'23514'})
  await assert.rejects(intent(j,{...m,codigo_carteira:'OTHER'}),{code:'23514'})
  await assert.rejects(intent(j,{...m,versao_id:randomUUID()}),{code:'23514'})
  await assert.rejects(intent(j,{...m,arquivo:{...m.arquivo,storage_path:'other/path'}}),{code:'23514'})
  stack.tests.push('inclusion_one_worker_and_scope_wallet_environment_version_file_lease_fences')
  await intent(j,m);await block(j,rows);await block(j,rows)
  await assert.rejects(block(j,[row(j,{valor_nominal:'99.0000'})]),{code:'23514'})
  await db.query('update private.vortx_callback_endpoints set ativo=false where id=$1',[endpoint]);await assert.rejects(finish(j),{code:'42501'})
  await db.query('update private.vortx_callback_endpoints set ativo=true where id=$1',[endpoint])
  await db.query("update integracao_fundo_versao_capacidades set disponivel_ate=now() where integracao_fundo_versao_id=$1 and capability='AQUISICOES'",[version]);await assert.rejects(finish(j),{code:'42501'})
  await db.query("update integracao_fundo_versao_capacidades set disponivel_ate=null where integracao_fundo_versao_id=$1 and capability='AQUISICOES'",[version])
  const first=await finish(j);assert.equal(first.estado,'PERSISTIDO');assert.equal(first.inclusoes,2)
  assert.equal((await db.query('select count(*)::int n from vortx_inclusoes')).rows[0].n,2)
  assert.equal((await db.query('select status,publicada_em from importacoes_financeiras where id=$1',[first.id])).rows[0].publicada_em,null)
  await assert.rejects(finish(j),{code:'42501'})
  await assert.rejects(internal('select publicar_importacao_financeira($1)',[first.id]),{code:'23514'})
  await assert.rejects(internal('select publicar_estoque_vortx($1)',[first.id]),{code:'23514'})
  stack.tests.push('inclusion_atomic_complete_original_lineage_different_cedentes_no_financial_publication')
  const duplicate=await prepare(),duprows=[row(duplicate),row(duplicate,{cedente_documento:'98992300000441'},3)]
  await intent(duplicate,manifest(duplicate,duprows));await block(duplicate,duprows)
  const dup=await finish(duplicate);assert.equal(dup.id,first.id);assert.equal(dup.duplicada,true)
  const overlap=await prepare({end:'2026-10-17'}),overlapRows=[row(overlap)]
  await intent(overlap,manifest(overlap,overlapRows));await block(overlap,overlapRows);await finish(overlap)
  assert.equal((await db.query('select count(*)::int n from vortx_inclusoes')).rows[0].n,2)
  stack.tests.push('inclusion_same_file_dedup_and_overlapping_periods_share_canonical_movements')
  const changed=await prepare({end:'2026-10-18'}),changedRows=[row(changed,{valor_aquisicao:'89.0000'})]
  await intent(changed,manifest(changed,changedRows));await block(changed,changedRows)
  assert.equal((await finish(changed)).estado,'REVISAO')
  assert.equal((await db.query("select count(*)::int n from vortx_inclusoes where valor_aquisicao=90")).rows[0].n,2)
  assert.equal((await db.query('select count(*)::int n from vortx_inclusoes')).rows[0].n,3)
  await assert.rejects(db.query("update vortx_inclusoes set valor_aquisicao=1"),{code:'P0001'})
  const recheck=await prepare(),recheckRows=[row(recheck),row(recheck,{cedente_documento:'98992300000441'},3)]
  await intent(recheck,manifest(recheck,recheckRows));await block(recheck,recheckRows)
  const rechecked=await finish(recheck);assert.equal(rechecked.id,first.id);assert.equal(rechecked.duplicada,true);assert.equal(rechecked.estado,'REVISAO')
  stack.tests.push('inclusion_changed_economics_new_immutable_version_review_not_overwrite')
  for(const patch of [{valor_aquisicao:'NaN'},{valor_nominal:'-1.0000'},{codigo_carteira:'OTHER'},{data_movimento:'2026-10-14'},{fundo_id:otherFund}]){
    const bad=await prepare({end:'2026-10-19'}),badRows=[row(bad,patch)],body=manifest(bad,badRows)
    await intent(bad,body);await block(bad,badRows);await assert.rejects(finish(bad),{code:'23514'})
    assert.equal((await db.query('select count(*)::int n from importacoes_financeiras where id=$1',[body.id])).rows[0].n,0)
    await internal('select vortx_falhar_inclusao($1,$2,$3)',[bad.id,bad.lease,'CONTRATO_INVALIDO'])
  }
  stack.tests.push('inclusion_finite_values_line_scope_and_period_validation_roll_back_all_writes')
  const gap=await prepare({end:'2026-10-20'}),gapRows=[row(gap,{},3)]
  await intent(gap,manifest(gap,gapRows));await block(gap,gapRows,2);await assert.rejects(finish(gap),{code:'23514'})
  await internal('select vortx_falhar_inclusao($1,$2,$3)',[gap.id,gap.lease,'CONTRATO_INVALIDO'])
  const repeated=await prepare({end:'2026-10-20'}),repeatedRows=[row(repeated),row(repeated,{},3)]
  await intent(repeated,manifest(repeated,repeatedRows));await block(repeated,repeatedRows);await assert.rejects(finish(repeated),{code:'23514'})
  await internal('select vortx_falhar_inclusao($1,$2,$3)',[repeated.id,repeated.lease,'CONTRATO_INVALIDO'])
  stack.tests.push('inclusion_gaps_and_duplicate_identity_inside_report_never_partially_commit')
  const empty=await prepare({start:'2026-10-21',end:'2026-10-21'})
  await intent(empty,manifest(empty,[]));assert.equal((await finish(empty)).inclusoes,0)
  assert.equal((await db.query('select completude from importacoes_financeiras where id=(select importacao_id from private.vortx_inclusao_processamentos where id=$1)',[empty.id])).rows[0].completude,'COMPLETO_VAZIO')
  const stale=await prepare({end:'2026-10-22'})
  await db.query("update private.vortx_inclusao_processamentos set lease_ate=now()-interval '1 second' where id=$1",[stale.id])
  const resumed=await reserve();assert.equal(resumed.id,stale.id);assert.notEqual(resumed.lease,stale.lease)
  await assert.rejects(intent(stale,manifest(stale,[])),{code:'42501'})
  await internal('select vortx_falhar_inclusao($1,$2,$3)',[resumed.id,resumed.lease,'CONTRATO_INVALIDO'])
  stack.tests.push('inclusion_explicit_empty_report_and_crash_recovery_old_lease_fenced')
  const bulk=await prepare({end:'2026-10-23'}),bulkRows=Array.from({length:5000},(_,index)=>row(bulk,{chave_parcela:`BULK-${index}`},index+2))
  const bulkStart=performance.now();await intent(bulk,manifest(bulk,bulkRows));let chunks=0,maxBytes=0
  for(let offset=0;offset<bulkRows.length;offset+=500){const part=bulkRows.slice(offset,offset+500);maxBytes=Math.max(maxBytes,Buffer.byteLength(JSON.stringify(part)));await block(bulk,part,++chunks)}
  assert.equal((await finish(bulk)).inclusoes,5000);assert(maxBytes<2*1024*1024)
  stack.inclusionBulk={rows:5000,chunks,maxBytes,durationMs:Math.round(performance.now()-bulkStart)}
  stack.tests.push('inclusion_5000_rows_bounded_chunks_measured_atomic_completion')
  for(const role of ['anon','authenticated'])for(const [sql,args] of [
    ['select vortx_reservar_processamento_inclusao($1)',[fund]],['select vortx_manifesto_inclusao($1,$2,$3)',[j.id,j.lease,m]],
    ['select vortx_estagiar_inclusao($1,$2,1,$3)',[j.id,j.lease,JSON.stringify(rows)]],['select vortx_concluir_inclusao($1,$2)',[j.id,j.lease]],
    ['select vortx_falhar_inclusao($1,$2,$3)',[j.id,j.lease,'DOWNLOAD_FALHOU']],['select * from private.vortx_inclusao_processamentos',[]],
    ['select * from private.vortx_inclusao_blocos',[]]])await assert.rejects(asRole(role,sql,args,actor),{code:'42501'})
  const actors=(await db.query('select id,role,status from profiles')).rows
  for(const user of actors){const rows=await asRole('authenticated','select count(*)::int n from vortx_inclusoes',[],user.id)
    const expected=user.id===actor?5003:0;assert.equal(rows.rows[0].n,expected)
    const owned=await asRole('authenticated','select count(*)::int n from vortx_inclusao_linhas',[],user.id);assert.equal(owned.rows[0].n>0,user.id===actor)
  }
  await assert.rejects(asRole('authenticated',"insert into vortx_inclusoes default values",[],actor),{code:'42501'})
  // Complete the read fixture with exact canonical MFA definitions, never a stubbed access predicate.
  const source=name=>readFileSync(new URL('../../../'+name,import.meta.url),'utf8').replace(/\r\n/g,'\n')
  const authSource=source('scripts/qa/vortx/callback-sql-rehearsal.mjs')
  await db.query(authSource.slice(authSource.indexOf('create table auth.sessions'),authSource.indexOf('create table public.autorizacoes_acoes_sensiveis')))
  const authContract=JSON.parse(source('scripts/qa/vortx/__fixtures__/report-auth-canonical.json')).functions.find(f=>f.name==='public.obter_sessao_mfa_atual')
  assert(authContract);await db.query(authContract.definition)
  stack.inclusionMfaContractSha256=createHash('sha256').update(authContract.definition).digest('hex')
  const operational=source('supabase/migrations/20261020212422_vortx_operational_reports.sql')
  await db.query(operational.slice(operational.indexOf('CREATE FUNCTION private.vortx_relatorio_operador'),operational.indexOf('-- Platform login MFA')))
  const revisions=source('supabase/migrations/20261020204704_vortx_report_request_revisions.sql')
  await db.query(revisions.slice(revisions.indexOf('ALTER TABLE public.vortx_relatorio_solicitacoes'),revisions.indexOf('GRANT SELECT')))
  await db.query(`alter table vortx_relatorio_solicitacoes add column origem text not null default 'MANUAL',add column data_operacional date;
    alter table private.vortx_estoque_processamentos add column download_concluido_em timestamptz`)
  const session=randomUUID(),factor=randomUUID()
  await db.query("insert into auth.sessions values($1,$2,'aal2',null)",[session,actor])
  await db.query("insert into auth.mfa_factors values($1,$2,'verified')",[factor,actor])
  await db.query("insert into sessoes_elevadas values($1,$2,now(),now()+interval '1 hour',null,'totp',$3)",[actor,session,factor])
  const history=async(user=actor,fundo=fund,claims={})=>{
    await db.query('begin;set local role authenticated')
    try{await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:'authenticated',sub:user,session_id:session,aal:'aal2',...claims})])
      const r=await db.query("select vortx_central_bases_historico($1,1,'Inclusao',null,null,'2026-10-23') r",[fundo]);await db.query('commit');return r.rows[0].r
    }catch(error){await db.query('rollback');throw error}
  }
  const actualHistory=await history(),saved=actualHistory.solicitacoes.find(r=>r.acompanhamento.inclusoes===5000)
  assert(saved);assert.equal(saved.acompanhamento.processamento,'PERSISTIDO');assert(saved.acompanhamento.downloadEm);assert(saved.acompanhamento.processadoEm)
  assert.equal(saved.acompanhamento.publicadoEm,null)
  assert(!JSON.stringify(actualHistory).match(/storage_path|urlRelatorio|payload_criptografado|lease_hash/))
  await assert.rejects(history(actor,otherFund),{code:'42501'})
  await assert.rejects(history(actor,fund,{aal:'aal1'}),{code:'42501'})
  await db.query('update sessoes_elevadas set revogada_em=now() where user_id=$1',[actor])
  await assert.rejects(history(),{code:'42501'});await db.query('update sessoes_elevadas set revogada_em=null where user_id=$1',[actor])
  await db.query("update usuario_fundos set perfil_no_fundo='auditor' where usuario_id=$1",[actor]);assert((await history()).total>0)
  await db.query("update usuario_fundos set perfil_no_fundo='gestor' where usuario_id=$1",[actor])
  stack.tests.push('inclusion_real_history_projection_counts_timestamps_no_secret_cross_fund_mfa_revocation_and_auditor')
  assert.equal(sha(await stock()),beforeStock)
  stack.tests.push('inclusion_private_worker_only_authenticated_nonowner_fund_rls_and_legacy_stock_preserved')
}
