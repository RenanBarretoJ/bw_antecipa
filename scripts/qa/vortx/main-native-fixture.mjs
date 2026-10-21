import assert from 'node:assert/strict'

export function assertCanonicalProfile(profiles, user, email) {
  assert.equal(profiles.rowCount, 1, 'EXACTLY_ONE_CANONICAL_PROFILE_REQUIRED')
  assert.deepEqual(profiles.rows[0], { id: user, email, role: 'cedente', status: 'ativo', nome_completo: email }, 'UNEXPECTED_CANONICAL_PROFILE_ATTRIBUTE')
}

// Only synthetic records in the runner's new, empty database. Canonical Auth
// creates the profile; this fixture never inserts or deletes a profile.
export async function seedNativeFixture(db) {
  const user = '21000000-0000-4000-8000-000000000003'
  const fund = '22000000-0000-4000-8000-000000000003'
  const cedente = '23000000-0000-4000-8000-000000000003'
  const link = '24000000-0000-4000-8000-000000000003'
  const policy = '26000000-0000-4000-8000-000000000003'
  const version = '27000000-0000-4000-8000-000000000003'
  const consultoria = '29000000-0000-4000-8000-000000000001'
  const email = 'native-fixture@example.invalid'
  await db.query('BEGIN')
  try {
    await db.query(`INSERT INTO auth.users(id,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
      VALUES($1,$2,'{}','{}',now(),now())`, [user, email])
    const profiles = await db.query('SELECT id,email,role::text,status::text,nome_completo FROM public.profiles WHERE id=$1', [user])
    assertCanonicalProfile(profiles, user, email)
    // A gestor publishes the synthetic policy. Explicit test-only state change.
    await db.query("UPDATE public.profiles SET role='gestor' WHERE id=$1 AND role='cedente'", [user])
    await db.query(`INSERT INTO public.fundos(id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo)
      VALUES($1,'QA NATIVE CONTRACT','98000000000196','QA','98000000000277','QA','98000000000358',true)`, [fund])
    await db.query("INSERT INTO public.usuario_fundos(usuario_id,fundo_id,status) VALUES($1,$2,'ativo')", [user, fund])
    await db.query(`INSERT INTO public.cedentes(id,user_id,cnpj,razao_social,status,fundo_id)
      VALUES($1,$2,'98300000000101','QA SYNTHETIC ISSUER','ativo',$3)`, [cedente, user, fund])
    await db.query("INSERT INTO public.cedente_fundos(id,cedente_id,fundo_id,status) VALUES($1,$2,$3,'ativo')", [link, cedente, fund])
    await db.query(`INSERT INTO public.documento_tipos(codigo,nome,dominio,cardinalidade,mime_types_aceitos,extensoes_aceitas)
      VALUES('nf_xml','QA XML','nf','por_nf',ARRAY['application/xml','text/xml'],ARRAY['xml']),
      ('boleto','QA BOLETO','nf','por_parcela',ARRAY['application/pdf'],ARRAY['pdf'])`)
    await db.query(`INSERT INTO public.politicas_operacionais(id,codigo,nome,status,created_by,fundo_id,padrao)
      VALUES($1,'QA_NATIVE','QA Native','ativa',$2,$3,true)`, [policy, user, fund])
    await db.query(`INSERT INTO public.politica_operacional_versoes(id,politica_operacional_id,versao,vigente_desde,
      conteudo_hash,fundo_id,status,configuracao,metodo_calculo_financeiro)
      VALUES($1,$2,1,now()-interval '1 day',repeat('a',64),$3,'rascunho',
      '{"calculo_financeiro":{"metodo":"TRINTA_360","versao_motor":1}}','TRINTA_360')`, [version, policy, fund])
    await db.query(`INSERT INTO public.politica_requisitos_documentais(politica_operacional_id,politica_operacional_versao_id,
      codigo,escopo,categoria,momento_obrigatorio,tipo_documento_codigo,formatos_aceitos,responsavel_upload,responsavel_aprovacao,fundo_id)
      VALUES($1,$2,'QA_XML','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','nf_xml',ARRAY['xml'],'cedente','gestor',$3),
      ($1,$2,'QA_BOLETO','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','boleto',ARRAY['pdf'],'cedente','gestor',$3)`, [policy, version, fund])
    await db.query("UPDATE public.politica_operacional_versoes SET status='publicada',publicada_em=now()-interval '1 hour',publicada_por=$2 WHERE id=$1", [version, user])
    await db.query(`INSERT INTO public.cedente_fundo_politicas(cedente_fundo_id,politica_operacional_id,status,vigente_desde,atribuido_por)
      VALUES($1,$2,'ativa',now()-interval '1 day',$3)`, [link, policy, user])
    await db.query(`INSERT INTO public.consultores(id,cnpj,razao_social,status,created_by)
      VALUES($1,'98200010000175','QA NATIVE CONSULTORIA','ativo',$2)`, [consultoria, user])
    await db.query("INSERT INTO public.consultor_fundos(consultor_id,fundo_id,status,concedido_por) VALUES($1,$2,'ativo',$3)", [consultoria, fund, user])
    await db.query("INSERT INTO public.consultor_cedentes(consultor_id,cedente_id,status,vinculado_por) VALUES($1,$2,'ativo',$3)", [consultoria, cedente, user])
    await db.query(`INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      VALUES('notas-fiscais','notas-fiscais',false,20971520,ARRAY['application/xml','text/xml','application/pdf']),
      ('documentos-v2','documentos-v2',false,20971520,ARRAY['application/xml','text/xml','application/pdf'])`)
    await db.query('COMMIT')
    return { canonicalProfile: profiles.rows[0], testRole: 'gestor', syntheticOnly: true }
  } catch (error) { await db.query('ROLLBACK'); throw error }
}
