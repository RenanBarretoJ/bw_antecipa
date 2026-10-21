import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

const sha = value => createHash('sha256').update(value).digest('hex')

// Focused SQL authorization/projection contract. Existing native-stock rehearsal separately
// certifies native table constraints and ingestion. No hosted Auth/Storage E2E is claimed here.
export async function runReportOperationalChecks({ db, user, worker, as, admin, ordinary, cross, unbound, fund, otherFund, version, check, migration }) {
  await db.query(`alter table profiles add column role text not null default 'cedente';
    alter table usuario_fundos add column perfil_no_fundo text not null default 'gestor';
    alter table fundos add column nome text not null default 'Synthetic QA';
    alter table fundos add column cnpj text not null default '00000000000000';
    alter table integracao_fundo_versoes add column versao integer not null default 1;
    alter table integracao_fundo_versoes add column vigente_ate timestamptz;
    create table public.importacoes_financeiras(id uuid primary key,fundo_id uuid not null references fundos(id),status text not null,publicada_em timestamptz);
    create table public.vortx_posicao_ativos(id uuid primary key,importacao_id uuid not null references importacoes_financeiras(id),fundo_id uuid not null references fundos(id));
    create table public.vortx_posicao_parcelas(id uuid primary key,importacao_id uuid not null references importacoes_financeiras(id),fundo_id uuid not null references fundos(id));
    alter table public.importacoes_financeiras enable row level security;
    alter table public.vortx_posicao_ativos enable row level security;
    alter table public.vortx_posicao_parcelas enable row level security;
    revoke all on public.importacoes_financeiras,public.vortx_posicao_ativos,public.vortx_posicao_parcelas from public,anon,authenticated,service_role;`)
  // The actual immutable native ledger DDL, not a permissive substitute.
  const stock = readFileSync(new URL('../../../supabase/migrations/20261020192527_vortx_stock_callback_processing.sql', import.meta.url), 'utf8')
  const ledger = stock.slice(stock.indexOf('CREATE TABLE private.vortx_estoque_processamentos'), stock.indexOf('-- Definer is necessary'))
  assert(ledger.startsWith('CREATE TABLE') && ledger.includes('ENABLE ROW LEVEL SECURITY'))
  await db.query(ledger)
  const history = (await db.query('select to_jsonb(s) row from vortx_relatorio_solicitacoes s order by id')).rows
  const events = (await db.query('select to_jsonb(e) row from vortx_relatorio_eventos e order by id')).rows
  const changed = ['vortx_relatorio_reservar_revisao','vortx_relatorio_transicionar','admin_listar_relatorios_vortx']
  const guards = (await db.query("select oid,proname,pg_get_functiondef(oid) definition,proacl::text from pg_proc where pronamespace in ('auth'::regnamespace,'private'::regnamespace,'public'::regnamespace) and not(proname=ANY($1::text[])) order by oid", [changed])).rows
  const nonceBefore = (await db.query('select * from autorizacoes_acoes_sensiveis order by id')).rows
  await db.query(migration)
  assert.deepEqual((await db.query("select to_jsonb(s)-'origem'-'data_operacional' row from vortx_relatorio_solicitacoes s order by id")).rows, history)
  assert.deepEqual((await db.query('select to_jsonb(e) row from vortx_relatorio_eventos e order by id')).rows, events)
  assert.deepEqual((await db.query('select oid,proname,pg_get_functiondef(oid) definition,proacl::text from pg_proc where oid=ANY($1::oid[]) order by oid', [guards.map(f => f.oid)])).rows, guards)
  check('operational_preserves_history_callback_admin_auth_mfa_guards_and_all_unrelated_function_acls')
  await db.query("update profiles set role='gestor' where id=$1", [ordinary.id])
  const reserveSql = 'select vortx_solicitar_relatorio($1,$2,$3,$4,$5,$6,2,$7,$8) r'
  const args = (type = 'Inclusao', parent = null) => [fund,version,type,'2020-03-01','2020-03-02','2020-03-02',sha('a'.repeat(64)),parent]
  const first = (await user(reserveSql,args(),ordinary)).rows[0].r
  assert.equal(first.criada,true); assert.equal(first.solicitacao.origem,'MANUAL')
  assert(!('lease_hash' in first.solicitacao)); assert(!('session_id' in first.solicitacao))
  assert.deepEqual((await db.query('select * from autorizacoes_acoes_sensiveis order by id')).rows,nonceBefore)
  check('own_fund_gestor_requests_without_sensitive_totp_nonce_and_preserves_all_nonces')
  assert.equal((await user('select count(*)::int n from vortx_relatorio_solicitacoes',[],ordinary)).rows[0].n>0,true)
  assert.equal((await user(reserveSql,args(),ordinary)).rows[0].r.criada,false)
  await user('select admin_transicionar_relatorio_vortx($1,$2,$3)',[first.solicitacao.id,'a'.repeat(64),'enviando'],ordinary)
  await user('select admin_transicionar_relatorio_vortx($1,$2,$3,$4,200)',[first.solicitacao.id,'a'.repeat(64),'aceita',randomUUID()],ordinary)
  const repeat = (await user(reserveSql,args('Inclusao',first.solicitacao.id),ordinary)).rows[0].r
  assert.equal(repeat.solicitacao.revisao,2);assert.equal(repeat.criada,true)
  assert.equal((await user(reserveSql,args('Inclusao',first.solicitacao.id),ordinary)).rows[0].r.criada,false)
  check('manual_and_explicit_revision_are_idempotent_without_extra_totp')
  await db.query("update usuario_fundos set perfil_no_fundo='LEITOR' where usuario_id=$1",[ordinary.id])
  assert.equal((await user('select vortx_contexto_relatorios($1) r',[fund],ordinary)).rows[0].r.podeSolicitar,false)
  assert((await user('select admin_listar_relatorios_vortx($1,1) r',[fund],ordinary)).rows[0].r.total>0)
  await assert.rejects(user(reserveSql,args('Exclusao'),ordinary),{code:'42501'})
  await db.query("update usuario_fundos set perfil_no_fundo='gestor' where usuario_id=$1",[ordinary.id])
  check('leitor_can_read_but_cannot_request_even_without_extra_totp')
  for (const role of ['cedente','consultor','sacado']) {
    await db.query('update profiles set role=$1 where id=$2',[role,ordinary.id])
    await assert.rejects(user(reserveSql,args('Exclusao'),ordinary),{code:'42501'})
    assert.equal((await user('select id from vortx_relatorio_solicitacoes',[],ordinary)).rowCount,0)
  }
  await db.query("update profiles set role='gestor' where id=$1",[ordinary.id])
  for (const actor of [cross,unbound]) {
    await assert.rejects(user(reserveSql,args('Exclusao'),actor),{code:'42501'})
    await assert.rejects(user('select admin_listar_relatorios_vortx($1,1)',[fund],actor),{code:'42501'})
  }
  for (const claims of [{aal:'aal1'},{session_id:null}]) await assert.rejects(user(reserveSql,args('Exclusao'),ordinary,claims),{code:'42501'})
  await db.query('update sessoes_elevadas set revogada_em=now() where user_id=$1',[ordinary.id])
  await assert.rejects(user(reserveSql,args('Exclusao'),ordinary),{code:'42501'})
  await db.query('update sessoes_elevadas set revogada_em=null where user_id=$1',[ordinary.id])
  check('non_gestor_cross_fund_unbound_aal1_missing_or_revoked_platform_session_denied')
  await db.query("update profiles set role='cedente' where id=$1",[ordinary.id])
  await db.query("insert into usuario_papeis values($1,'gestor',true)",[ordinary.id])
  assert.equal((await user('select vortx_contexto_relatorios($1) r',[fund],ordinary)).rows[0].r.podeSolicitar,true)
  await db.query("delete from usuario_papeis where usuario_id=$1 and papel='gestor'",[ordinary.id])
  await db.query("update profiles set role='gestor' where id=$1",[ordinary.id])
  check('canonical_delegated_gestor_role_supported_without_super_admin')
  assert.equal((await user('select private.vortx_relatorio_pode_acessar($1) allowed',[fund],ordinary)).rows[0].allowed,false)
  await assert.rejects(user('select admin_vortx_callback_status($1,$2)',[fund,version],ordinary),{code:'42501'})
  check('report_gestor_access_does_not_broaden_callback_administration')
  const machineSql='select vortx_rotina_reservar($1,$2,$3,$4,$5,$6,$7) r'
  const machineArgs=args('PosicaoAtivo').slice(0,7)
  const scheduled=(await worker(machineSql,machineArgs)).rows[0].r
  assert.equal(scheduled.criada,true);assert.equal(scheduled.solicitacao.origem,'CRON')
  assert.equal(scheduled.solicitacao.solicitada_por,null)
  assert.match(scheduled.solicitacao.data_operacional,/^\d{4}-\d{2}-\d{2}$/)
  assert.equal((await worker(machineSql,machineArgs)).rows[0].r.criada,false)
  for(const role of ['anon','authenticated']) await assert.rejects(as(role,machineSql,machineArgs,admin),{code:'42501'})
  await assert.rejects(user('select private.vortx_relatorio_reservar_operacional($1,$2,$3,$4,$5,$6,2,$7,null,true)',machineArgs,ordinary),{code:'42501'})
  await assert.rejects(worker('select vortx_rotina_transicionar($1,$2,$3)',[repeat.solicitacao.id,'a'.repeat(64),'enviando']),{code:'42501'})
  await assert.rejects(user('select admin_transicionar_relatorio_vortx($1,$2,$3)',[scheduled.solicitacao.id,'a'.repeat(64),'enviando'],ordinary),{code:'42501'})
  await worker('select vortx_rotina_transicionar($1,$2,$3)',[scheduled.solicitacao.id,'a'.repeat(64),'enviando'])
  check('machine_has_real_cron_origin_no_fake_user_no_cross_channel_transition_or_duplicate')
  const ctx=(await user('select vortx_contexto_relatorios($1) r',[fund],ordinary)).rows[0].r
  assert.deepEqual(Object.keys(ctx).sort(),['fundo','podeSolicitar','versoes'])
  assert.deepEqual(Object.keys(ctx.versoes[0]).sort(),['ambiente','capabilities','carteira','id','versao'])
  const hist=(await user('select admin_listar_relatorios_vortx($1,1) r',[fund],ordinary)).rows[0].r
  assert(hist.solicitacoes.length<=20)
  assert(!JSON.stringify(hist).match(/lease_hash|session_id|payload_criptografado|metadados|urlRelatorio/))
  assert(hist.solicitacoes.every(s=>s.fundo_id===fund))
  check('minimal_context_and_paginated_progress_expose_no_credentials_raw_json_urls_or_other_fund')
  const [a,p]=(await db.query("select id from vortx_relatorio_eventos where solicitacao_id is not null and fundo_id=$1 order by id limit 2",[fund])).rows
  assert(a&&p)
  const importId=randomUUID(),job=randomUUID(),lease=randomUUID()
  await db.query("insert into importacoes_financeiras values($1,$2,'REVISAO',null)",[importId,fund])
  await db.query(`insert into private.vortx_estoque_processamentos(id,fundo_id,ambiente,codigo_carteira,data_referencia,versao_id,ativo_evento_id,parcela_evento_id,estado,lease,lease_ate)
    values($1,$2,'producao','synthetic','2020-03-02',$3,$4,$5,'PROCESSANDO',$6,now()+interval '5 minutes')`,[job,fund,version,a.id,p.id,lease])
  await assert.rejects(user('select vortx_marcar_download_estoque($1,$2)',[job,lease],ordinary),{code:'42501'})
  await assert.rejects(worker('select vortx_marcar_download_estoque($1,$2)',[job,randomUUID()]),{code:'42501'})
  await worker('select vortx_marcar_download_estoque($1,$2)',[job,lease])
  const marked=(await db.query('select download_concluido_em from private.vortx_estoque_processamentos where id=$1',[job])).rows[0]
  assert(marked.download_concluido_em)
  await worker('select vortx_marcar_download_estoque($1,$2)',[job,lease])
  assert.deepEqual((await db.query('select download_concluido_em from private.vortx_estoque_processamentos where id=$1',[job])).rows[0],marked)
  await db.query("update private.vortx_estoque_processamentos set estado='REVISAO',lease=null,lease_ate=null,importacao_id=$1,manifestos=$2 where id=$3",[importId,JSON.stringify([{payload:{id:importId}}]),job])
  await db.query('insert into vortx_posicao_ativos values($1,$2,$3)',[randomUUID(),importId,fund])
  const progress=(await user('select admin_listar_relatorios_vortx($1,1) r',[fund],admin)).rows[0].r.solicitacoes.find(s=>s.acompanhamento.processamento==='REVISAO')?.acompanhamento
  assert(progress);assert.equal(progress.ativos,1);assert.equal(progress.publicadoEm,null);assert.equal(progress.duplicada,false);assert(progress.downloadEm&&progress.processadoEm)
  check('download_checkpoint_fenced_idempotent_and_persisted_review_never_shown_as_published')
  assert.equal((await db.query("select count(*)::int n from seguranca_eventos where ator_tipo='cron' and origem='vortx_relatorios'")).rows[0].n,2)
  assert.equal((await db.query("select count(*)::int n from importacoes_financeiras where status='PUBLICADA'")).rows[0].n,0)
  check('scheduled_audit_uses_cron_actor_no_implicit_financial_publication')
  // Other-Fund and inactive/current-version cases are tested on fresh request identities.
  await assert.rejects(user(reserveSql,[otherFund,...args('Exclusao').slice(1)],ordinary),{code:'42501'})
  await db.query('update integracao_fundo_versoes set vigente_ate=now() where id=$1',[version])
  await assert.rejects(worker(machineSql,args('Exclusao').slice(0,7)),{code:'42501'})
  await db.query('update integracao_fundo_versoes set vigente_ate=null where id=$1',[version])
  await db.query('update fundos set ativo=false where id=$1',[fund])
  await assert.rejects(worker(machineSql,args('Exclusao').slice(0,7)),{code:'42501'})
  await db.query('update fundos set ativo=true where id=$1',[fund])
  check('machine_and_operator_recheck_active_fund_current_version_and_exact_scope')
}
