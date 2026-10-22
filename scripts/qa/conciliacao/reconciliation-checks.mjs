import assert from 'node:assert/strict'
import { randomUUID,createHash } from 'node:crypto'
import pg from 'pg'
const sha=value=>createHash('sha256').update(value).digest('hex')
export async function checkReconciliation({db,asRole,stack,config}) {
  const fund=randomUUID(),otherFund=randomUUID(),actor=randomUUID(),cross=randomUUID()
  for(const [id,doc] of [[fund,'98992300000280'],[otherFund,'98992300000360']])await db.query(`insert into fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj) values($1,'QA',$2,'QA',$2,'QA',$2)`,[id,doc])
  for(const [id,f] of [[actor,fund],[cross,otherFund]]) {
    await db.query("insert into profiles(id,role,nome_completo,email,status) values($1,'gestor','QA',$2,'ativo')",[id,`${id}@example.invalid`])
    await db.query('insert into usuario_fundos(usuario_id,fundo_id) values($1,$2)',[id,f])
  }
  const internal=(sql,params=[])=>asRole('service_role',sql,params)
  const diagnostic=(d2,d1,user=actor)=>asRole('authenticated','select diagnosticar_variacao_estoques($1,$2,$3) r',[fund,d2,d1],user).then(r=>r.rows[0].r)
  async function header(type,date,rows=[]) {
    const id=randomUUID()
    // Synthetic publication lifecycle: retain old snapshots and honor the real one-published-per-family constraint.
    await db.query("update importacoes_financeiras set status='RETIFICADA' where fundo_id=$1 and tipo_base=$2 and data_referencia=$3 and status='PUBLICADA'",[fund,type,date])
    await db.query(`insert into importacoes_financeiras(id,fundo_id,provedor,tipo_base,data_referencia,versao_layout,layout_nome,status,completude,hash_conteudo,nome_arquivo,mime_type,tamanho_bytes,storage_path,encoding_detectado,linhas_publicadas,publicada_em)
      values($1,$2,'FROMTIS',$3,$4,'QA','QA','PUBLICADA',$5,$6,'qa.csv','text/csv',100,'qa-only','utf-8',$7,now())`,[id,fund,type,date,rows.length?'COMPLETO_COM_DADOS':'COMPLETO_VAZIO',sha(id),rows.length])
    if(type==='ESTOQUE')for(const [i,row] of rows.entries()) {
      const line=(await db.query("insert into importacao_linhas(importacao_id,fundo_id,numero_linha,status,dados_brutos) values($1,$2,$3,'VALIDA','{}') returning id",[id,fund,i+2])).rows[0].id
      await db.query(`insert into estoque_posicoes(importacao_id,linha_id,fundo_id,provedor,data_referencia,id_recebivel,external_title_key,cedente_documento,valor_nominal,valor_aquisicao,valor_presente,valor_pdd)
        values($1,$2,$3,'FROMTIS',$4,$5,$5,$6,$7,90,$8,$9)`,[id,line,fund,date,row.key,row.cedente||'98992300000280',row.principal,row.vp||'91',row.pdd||'1'])
    }
    return id
  }
  async function payload(d2,d1,aq=null,liq=null) {
    const stocks=(await db.query('select distinct provedor,cedente_documento,id_recebivel from estoque_fontes_leitura where importacao_id=any($1)',[[d2,d1]])).rows
    return {fundo_id:fund,data_referencia:(await db.query('select data_referencia::text d from importacoes_financeiras where id=$1',[d1])).rows[0].d,
      regra_versao:'FIN_RECON_V2',input_import_ids:[d2,d1,aq,liq].filter(Boolean),assinatura_execucao:sha(randomUUID()),correlation_id:randomUUID(),criado_por:actor,
      estoque_d2_importacao_id:d2,estoque_d1_importacao_id:d1,aquisicoes_d1_importacao_id:aq,liquidacoes_d1_importacao_id:liq,status:'CONCLUIDA',detalhes:{integral:true},contagens:{FORJADA:999},
      resultados:stocks.map(s=>({identidade_externa:JSON.stringify([s.provedor,s.cedente_documento,s.id_recebivel]),provedor:s.provedor,status:'MANTIDO_CORRETO',detalhes:{}}))}
  }
  const persist=body=>internal('select persistir_conciliacao_execucao($1) id',[body]).then(r=>r.rows[0].id)
  const d2=await header('ESTOQUE','2026-10-20',[{key:'T1',principal:'100'}])
  const d1=await header('ESTOQUE','2026-10-21',[{key:'T1',principal:'100',vp:'92',pdd:'2'}])
  const same=await diagnostic(d2,d1)
  assert.equal(same.estoquesEquivalentes,true);assert.equal(same.exigeAquisicoes,false);assert.equal(same.exigeLiquidacoes,false)
  stack.tests.push('same_principal_vp_pdd_changes_do_not_require_movements')
  const body=await payload(d2,d1),id=await persist(body)
  const saved=(await db.query('select * from conciliacao_execucoes where id=$1',[id])).rows[0]
  assert.equal(saved.status,'CONCLUIDA');assert.equal(saved.aquisicoes_d1_importacao_id,null);assert.equal(saved.liquidacoes_d1_importacao_id,null)
  assert.deepEqual(saved.contagens,{MANTIDO_CORRETO:1});assert.equal(saved.detalhes.diagnostico_estoques.estoquesEquivalentes,true)
  assert.equal(await persist(body),id)
  assert.equal((await db.query('select count(*)::int n from conciliacao_resultados where execucao_id=$1',[id])).rows[0].n,1)
  stack.tests.push('integral_without_fabricated_imports_server_counts_audit_and_idempotency')
  await assert.rejects(asRole('authenticated','select persistir_conciliacao_execucao($1)',[body],actor),{code:'42501'})
  await assert.rejects(asRole('anon','select diagnosticar_variacao_estoques($1,$2,$3)',[fund,d2,d1]),{code:'42501'})
  await assert.rejects(diagnostic(d2,d1,cross),{code:'42501'})
  stack.tests.push('authenticated_cannot_write_anon_denied_other_fund_rls_denied')
  await assert.rejects(persist({...body,assinatura_execucao:sha('no-results'),resultados:[]}),{code:'22023'})
  await assert.rejects(persist({...body,assinatura_execucao:sha('extra-input'),input_import_ids:[d2,d1,randomUUID()]}),{code:'22023'})
  await assert.rejects(persist({...body,assinatura_execucao:sha('v1'),regra_versao:'RLX_RECON_V1'}),{code:'22023'})
  await assert.rejects(persist({...body,assinatura_execucao:sha('fake-bootstrap'),bootstrap:true}),{code:'22023'})
  stack.tests.push('missing_coverage_extra_input_v1_waiver_and_fake_bootstrap_denied')
  for(const [label,rows,expected] of [
    ['entrada',[{key:'T1',principal:'100'},{key:'T2',principal:'50'}],{entradas:1,exigeAquisicoes:true}],
    ['saida',[],{saidas:1,exigeLiquidacoes:true}],
    ['parcial',[{key:'T1',principal:'60'}],{reducoes:1,exigeLiquidacoes:true}],
    ['aumento',[{key:'T1',principal:'120'}],{aumentos:1,exigeAquisicoes:true}],
    ['troca_mesmos_totais',[{key:'T2',principal:'100'}],{entradas:1,saidas:1,exigeAquisicoes:true,exigeLiquidacoes:true}],
  ]) {
    const next=await header('ESTOQUE','2026-10-21',rows),result=await diagnostic(d2,next)
    for(const [key,value] of Object.entries(expected))assert.equal(result[key],value,label)
    await assert.rejects(persist(await payload(d2,next)),{code:'22023'})
    stack.tests.push(`${label}_requires_correct_movement_base_even_with_forged_metadata`)
  }
  const entry=await header('ESTOQUE','2026-10-21',[{key:'T1',principal:'100'},{key:'T2',principal:'50'}])
  const aq=await header('AQUISICOES','2026-10-21')
  const withAq=await payload(d2,entry,aq);withAq.resultados[1].status='ENTRADA_SEM_AQUISICAO'
  const withAqId=await persist(withAq)
  assert.equal((await db.query('select detalhes from conciliacao_execucoes where id=$1',[withAqId])).rows[0].detalhes.integral,false)
  stack.tests.push('required_empty_report_is_not_proof_of_acquisition_integral_false')
  const wrongDate=await header('AQUISICOES','2026-10-20')
  await assert.rejects(persist(await payload(d2,entry,wrongDate)),{code:'22023'})
  await assert.rejects(persist(await payload(d2,entry,null,aq)),{code:'22023'})
  stack.tests.push('wrong_date_or_family_denied')
  const old=await header('ESTOQUE','2026-10-19',[{key:'T1',principal:'100'}])
  await assert.rejects(persist(await payload(old,entry,aq)),{code:'22023',message:'Estoque D-2 fora do dia util anterior'})
  const friday=await header('ESTOQUE','2026-10-09',[{key:'T1',principal:'100'}]),tuesday=await header('ESTOQUE','2026-10-13',[{key:'T1',principal:'100'}])
  await persist(await payload(friday,tuesday))
  stack.tests.push('wrong_d2_denied_canonical_weekend_and_anbima_holiday_accepted')
  await db.query("update importacoes_financeiras set status='RETIFICADA' where id=$1",[entry])
  await assert.rejects(persist({...withAq,assinatura_execucao:sha('stale')}),{code:'22023'})
  await db.query("update importacoes_financeiras set status='PUBLICADA' where id=$1",[entry])
  stack.tests.push('snapshot_retified_between_read_and_write_denied')
  const other=new pg.Client(config);await other.connect()
  try {
    await db.query('begin');await db.query('set local role service_role');await db.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',true)")
    await db.query('select persistir_conciliacao_execucao($1)',[{...withAq,assinatura_execucao:sha('locks')}])
    await other.query("set lock_timeout='250ms'")
    await assert.rejects(other.query("update importacoes_financeiras set status='RETIFICADA' where id=$1",[entry]),{code:'55P03'})
  }finally{await db.query('rollback');await other.end()}
  stack.tests.push('source_share_locks_prevent_concurrent_retification_until_commit')
  // The target provider is exercised through its official staging/publication RPCs, not a legacy-table copy.
  const integration=randomUUID(),version=randomUUID()
  await db.query(`insert into integracoes_fundo(id,fundo_id,provedor,nome,status,created_by,provider_key,system_name) values($1,$2,'VORTX','QA','ativa',$3,'VORTX','VRS 2.0')`,[integration,fund,actor])
  await db.query(`insert into integracao_fundo_versoes(id,integracao_fundo_id,versao,ambiente,status,identificador_cliente,endpoint_base,credential_ref,publicada_por,publicada_em,adapter_key,configuracao_nao_sensivel)
    values($1,$2,1,'homologacao','publicada','QA','https://example.invalid','qa-reference',$3,now(),'vortx_vrs','{"codigo_carteira":"QA-CARTEIRA"}')`,[version,integration,actor])
  await db.query(`insert into integracao_fundo_versao_capacidades(integracao_fundo_versao_id,fundo_id,ambiente,capability,disponivel_desde) values($1,$2,'homologacao','ESTOQUE',now()-interval '1 day')`,[version,fund])
  async function native(date,secondPrincipal='100') {
    const id=randomUUID(),ativos=[],parcelas=[]
    for(const [i,doc] of ['98992300000280','98992300000441'].entries()) {
      const amount=i===1?secondPrincipal:'100'
      const common={identidade_ativo:sha(doc),codigo_carteira:'QA-CARTEIRA',chave_ativo:'A1',cedente_documento:doc,cedente_nome:'QA',
        sacado_documento:'98992300000360',sacado_nome:'QA',tipo_recebivel:'DUPLICATA',valor_nominal:amount,valor_aquisicao:'90',valor_presente:'91',valor_pdd:'2',
        data_aquisicao:'2026-10-15',data_emissao:'2026-10-01',data_vencimento:'2026-11-20',data_vencimento_original:'2026-11-20',status_entrada_provedor:'EM_TRANSITO'}
      ativos.push({numero_linha:i+2,dados_brutos:{},dados_normalizados:common})
      parcelas.push({numero_linha:i+2,dados_brutos:{},dados_normalizados:{...common,chave_parcela:'P1',external_title_key:sha(`${doc}:P1`)}})
    }
    const p={id,correlation_id:randomUUID(),fundo_id:fund,integracao_fundo_versao_id:version,ambiente:'homologacao',codigo_carteira:'QA-CARTEIRA',data_referencia:date,
      hash_conteudo:sha(id),arquivos:[1,2].map(ordem=>({id:randomUUID(),ordem,nome_arquivo:`${ordem}.csv`,tamanho_bytes:100,hash_conteudo:sha(`${id}:${ordem}`),storage_bucket:'financeiro-importacoes',storage_path:`${fund}/vortx/${id}/${ordem}.csv`})),ativos,parcelas}
    const staged=(await internal('select persistir_estoque_vortx($1) r',[p])).rows[0].r;assert.equal(staged.reconciliado,true)
    await internal('select publicar_estoque_vortx($1)',[id]);return id
  }
  const nativeD2=await native('2026-10-20'),nativeD1=await native('2026-10-21')
  const nativeDiagnostic=await diagnostic(nativeD2,nativeD1)
  assert.equal(nativeDiagnostic.estoquesEquivalentes,true);assert.equal(nativeDiagnostic.invalidas,0)
  const nativeBody=await payload(nativeD2,nativeD1),nativeId=await persist(nativeBody)
  assert.equal((await db.query('select count(*)::int n from conciliacao_resultados where execucao_id=$1',[nativeId])).rows[0].n,2)
  stack.tests.push('native_vortx_two_cedentes_same_keys_stock_only_integral_without_legacy_copy')
  const partialNative=await native('2026-10-21','60'),partialDiagnostic=await diagnostic(nativeD2,partialNative)
  assert.equal(partialDiagnostic.reducoes,1);assert.equal(partialDiagnostic.exigeLiquidacoes,true)
  await assert.rejects(persist(await payload(nativeD2,partialNative)),{code:'22023'})
  await assert.rejects(diagnostic(d2,partialNative),{code:'22023'})
  stack.tests.push('native_partial_requires_liquidation_and_mixed_provider_snapshots_denied')
}
