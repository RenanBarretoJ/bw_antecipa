#!/usr/bin/env node
// UI/Operacional -- parcelas na NF e na Operacao (Claude_UI_Parcelas_NF_e_Operacao.txt).
// Cobre os testes obrigatorios 1-16 do ticket ao vivo em homologacao
// (transacao revertida, nada fica no banco).

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const EXPECTED_PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const checks = []

loadEnv(resolve('.env.homolog'))
const apiRef = new URL(required('NEXT_PUBLIC_SUPABASE_URL')).hostname.split('.')[0]
const productionRef = required('SUPABASE_PRODUCTION_PROJECT_REF')
const databaseUrl = new URL(required('SUPABASE_DB_URL'))
databaseUrl.password = required('SUPABASE_PASSWORD')

if (apiRef !== EXPECTED_PROJECT_REF) throw new Error(`Projeto de homologacao inesperado: ${apiRef}`)
if (apiRef === productionRef) throw new Error('Projeto de producao bloqueado.')

const db = new pg.Client({ connectionString: databaseUrl.toString(), ssl: { rejectUnauthorized: false } })
await db.connect()

try {
  await db.query('BEGIN')

  const actorCedente = randomUUID()
  const actorCedente2 = randomUUID()
  const actorGestor = randomUUID()
  const fundo = randomUUID()

  await createAuthUser(actorCedente, 'cedente')
  await createAuthUser(actorCedente2, 'cedente')
  await createAuthUser(actorGestor, 'gestor')

  await db.query(`insert into public.fundos
    (id,nome,cnpj,administradora_nome,administradora_cnpj,gestora_nome,gestora_cnpj,ativo,created_by)
    values ($1,'QA UI Parcelas Fundo',$2,'QA Admin',$3,'QA Gestora',$4,true,$5)`, [
    fundo, makeCnpj('980000010001'), makeCnpj('980000010002'), makeCnpj('980000010003'), actorGestor,
  ])
  await db.query(`insert into public.usuario_fundos (usuario_id,fundo_id,perfil_no_fundo,status,principal) values ($1,$2,'gestor','ativo',true)`, [actorGestor, fundo])

  const cedente = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente UI Parcelas','ativo') returning id`, [actorCedente, makeCnpj('980000020001')])).rows[0].id
  const cedente2 = (await db.query(`insert into public.cedentes
    (user_id,cnpj,razao_social,status) values ($1,$2,'QA Cedente 2 UI Parcelas','ativo') returning id`, [actorCedente2, makeCnpj('980000030001')])).rows[0].id
  const cedenteFundoId = (await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo') returning id`, [cedente, fundo])).rows[0].id
  const cedenteFundoId2 = (await db.query(`insert into public.cedente_fundos (cedente_id,fundo_id,status) values ($1,$2,'ativo') returning id`, [cedente2, fundo])).rows[0].id
  await db.query(`insert into public.taxas_cedente (cedente_id, prazo_min, prazo_max, taxa_percentual) values ($1, 1, 400, 2.5)`, [cedente])
  await db.query(`insert into public.contas_escrow (cedente_id, identificador, status) values ($1,'QA-ESCROW-UI-PARCELAS','ativa')`, [cedente])
  const matriz = (await db.query(`select id from public.cedente_estabelecimentos where cedente_id=$1 and tipo='matriz'`, [cedente])).rows[0].id

  // ---- Politica COM boleto por parcela (XML/DANFE/CTE por_nf + BOLETO por_parcela) ----
  const politica = (await db.query(`insert into public.politicas_operacionais
    (fundo_id, codigo, nome, status, created_by) values ($1,'QA-UI-PARCELAS','QA Politica UI Parcelas','ativa',$2) returning id`, [fundo, actorGestor])).rows[0].id
  const politicaVersao = (await db.query(`insert into public.politica_operacional_versoes
    (politica_operacional_id, cedente_fundo_id, fundo_id, versao, vigente_desde, conteudo_hash, metodo_calculo_financeiro)
    values ($1,$2,$3,1,now(),'qa-hash-ui-parcelas','DIAS_UTEIS_252') returning id`, [politica, cedenteFundoId, fundo])).rows[0].id
  await db.query(`insert into public.politica_requisitos_documentais
    (politica_operacional_versao_id, politica_operacional_id, cedente_fundo_id, codigo, escopo, momento_obrigatorio, categoria, tipo_documento_codigo, obrigatorio, bloqueia_fluxo, responsavel_upload, responsavel_aprovacao) values
    ($1,$2,$3,'XML_NF','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','nf_xml',true,true,'cedente','gestor'),
    ($1,$2,$3,'DANFE','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','nf_danfe_pdf',true,true,'cedente','gestor'),
    ($1,$2,$3,'CTE','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','cte',true,true,'cedente','gestor'),
    ($1,$2,$3,'BOLETO_PARCELA','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','boleto',true,true,'cedente','gestor')`, [politicaVersao, politica, cedenteFundoId])
  await db.query(`update public.politica_operacional_versoes set publicada_por=$1, publicada_em=now() where id=$2`, [actorGestor, politicaVersao])
  await db.query(`insert into public.cedente_fundo_politicas (cedente_fundo_id, politica_operacional_id, status, atribuido_por)
    values ($1,$2,'ativa',$3)`, [cedenteFundoId, politica, actorGestor])

  // ---- Politica SEM boleto (teste 7: parcelas aparecem mesmo sem requisito de boleto) ----
  const politicaSemBoleto = (await db.query(`insert into public.politicas_operacionais
    (fundo_id, codigo, nome, status, created_by) values ($1,'QA-UI-PARCELAS-SEM-BOLETO','QA Politica UI Parcelas Sem Boleto','ativa',$2) returning id`, [fundo, actorGestor])).rows[0].id
  const politicaVersaoSemBoleto = (await db.query(`insert into public.politica_operacional_versoes
    (politica_operacional_id, cedente_fundo_id, fundo_id, versao, vigente_desde, conteudo_hash, metodo_calculo_financeiro)
    values ($1,$2,$3,1,now(),'qa-hash-ui-parcelas-sem-boleto','DIAS_UTEIS_252') returning id`, [politicaSemBoleto, cedenteFundoId2, fundo])).rows[0].id
  await db.query(`insert into public.politica_requisitos_documentais
    (politica_operacional_versao_id, politica_operacional_id, cedente_fundo_id, codigo, escopo, momento_obrigatorio, categoria, tipo_documento_codigo, obrigatorio, bloqueia_fluxo, responsavel_upload, responsavel_aprovacao) values
    ($1,$2,$3,'XML_NF','nf_pre_cessao','nf_pre_cessao','nf_pre_cessao','nf_xml',true,true,'cedente','gestor')`, [politicaVersaoSemBoleto, politicaSemBoleto, cedenteFundoId2])
  await db.query(`update public.politica_operacional_versoes set publicada_por=$1, publicada_em=now() where id=$2`, [actorGestor, politicaVersaoSemBoleto])
  await db.query(`insert into public.cedente_fundo_politicas (cedente_fundo_id, politica_operacional_id, status, atribuido_por)
    values ($1,$2,'ativa',$3)`, [cedenteFundoId2, politicaSemBoleto, actorGestor])

  const tipos = (await db.query(`select codigo, id from public.documento_tipos where codigo in ('nf_xml','nf_danfe_pdf','cte_xml','boleto')`)).rows
  const tipoId = Object.fromEntries(tipos.map((row) => [row.codigo, row.id]))

  async function criarNfTotalmenteSatisfeita(numero, valorBruto, dataVencimento, parcelas) {
    const nfId = (await db.query(`insert into public.notas_fiscais
      (cedente_id, cedente_fundo_id, fundo_id, numero_nf, serie, data_emissao, data_vencimento,
       cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, status)
      values ($1,$2,$3,$4,'1','2026-09-10',$5,$6,'QA Emitente','12345678000199','QA Sacado',$7,'rascunho')
      returning id`, [cedente, cedenteFundoId, fundo, numero, dataVencimento, makeCnpj('980000020001'), valorBruto])).rows[0].id
    await asActor(actorCedente)
    if (parcelas.length) await db.query(`select public.registrar_parcelas_nota_fiscal($1, $2::jsonb) resultado`, [nfId, JSON.stringify(parcelas)])
    await db.query(`select public.instanciar_requisitos_nota($1,$2,$3) resultado`, [nfId, politica, politicaVersao])

    for (const [codigo, tipoCodigo] of [['nf_xml', 'nf_xml'], ['nf_danfe_pdf', 'nf_danfe_pdf'], ['cte', 'cte_xml']]) {
      const requisito = (await db.query(`select id from public.documento_requisito_instancias where nota_fiscal_id=$1 and tipo_documento_codigo_snapshot=$2`, [nfId, codigo])).rows[0]
      await asActor(actorCedente)
      const upload = (await db.query(`select public.registrar_documento_upload(
        $1,$2,$3,$4,'application/octet-stream',2048,$5,'documentos-v2',$6,$7) resultado`,
        [nfId, requisito.id, tipoId[tipoCodigo], `${codigo}.dat`, sha(), path(), actorCedente])).rows[0].resultado
      await asActor(actorGestor)
      await db.query(`select public.analisar_documento_versao($1,'aprovado',null)`, [upload.versao_id])
    }

    if (parcelas.length) {
      const requisitosBoleto = (await db.query(`select dri.id, nfp.numero_parcela
        from public.documento_requisito_instancias dri
        join public.nota_fiscal_parcelas nfp on nfp.id = dri.parcela_id
        where dri.nota_fiscal_id=$1 and dri.tipo_documento_codigo_snapshot='boleto' order by nfp.numero_parcela`, [nfId])).rows
      for (const requisito of requisitosBoleto) {
        await asActor(actorCedente)
        const upload = (await db.query(`select public.registrar_documento_boleto_parcela(
          $1,$2,$3,$4,'boleto.pdf','application/pdf',1000,$5,'documentos-v2',$6,$7,null) resultado`,
          [nfId, requisito.id, tipoId.boleto, matriz, sha(), path(), actorCedente])).rows[0].resultado
        await asActor(actorGestor)
        await db.query(`select public.analisar_documento_boleto_gestor($1,'aprovado',null)`, [upload.versao_id])
      }
    }

    await db.query('RESET ROLE')
    await db.query(`update public.notas_fiscais set status='aprovada' where id=$1`, [nfId])
    return nfId
  }

  const PARCELAS_78 = [
    { numero_parcela: 1, valor_nominal: 27540.00, data_vencimento: '2026-10-11' },
    { numero_parcela: 2, valor_nominal: 27540.00, data_vencimento: '2026-10-26' },
    { numero_parcela: 3, valor_nominal: 27540.00, data_vencimento: '2026-11-10' },
    { numero_parcela: 4, valor_nominal: 27540.00, data_vencimento: '2026-11-25' },
  ]
  const PARCELAS_56 = [
    { numero_parcela: 1, valor_nominal: 4465.33, data_vencimento: '2026-08-31' },
    { numero_parcela: 2, valor_nominal: 4465.33, data_vencimento: '2026-09-21' },
    { numero_parcela: 3, valor_nominal: 4465.34, data_vencimento: '2026-10-19' },
  ]

  const nf78 = await criarNfTotalmenteSatisfeita('78-UIP', 110160.00, '2026-11-25', PARCELAS_78)
  const nf56 = await criarNfTotalmenteSatisfeita('56-UIP', 13396.00, '2026-10-19', PARCELAS_56)
  const nfLegado = await criarNfTotalmenteSatisfeita('LEGADO-UIP', 5000.00, '2026-11-30', [])

  // ---- Testes 1 e 2: contagem de parcelas por NF ----
  const parcelas78 = (await db.query(`select id, numero_parcela from public.nota_fiscal_parcelas where nota_fiscal_id=$1 order by numero_parcela`, [nf78])).rows
  const parcelas56 = (await db.query(`select id from public.nota_fiscal_parcelas where nota_fiscal_id=$1`, [nf56])).rows
  ok('NF-78 (real): fonte de dados tem exatamente 4 parcelas', parcelas78.length === 4)
  ok('NF-56 (real): fonte de dados tem exatamente 3 parcelas', parcelas56.length === 3)

  // ---- Teste 3-5: operacao parcial (2 de 4 parcelas da NF-78) ----
  await asActor(actorCedente)
  const duasSelecionadas = parcelas78.slice(0, 2)
  const solicitacao = (await db.query(`select public.solicitar_operacao_antecipacao_atomica(
    $1,$2,$3,$4,1,'{"calculo_financeiro":{"metodo":"DIAS_UTEIS_252"}}'::jsonb,$5,false,'dispensado',$6,$7,2.5,30,$7,$8,$9,$10) resultado`, [
    cedente, cedenteFundoId, politica, politicaVersao, 'a'.repeat(64),
    [nf78], 55080.00, '2026-10-26', randomUUID(), duasSelecionadas.map((p) => p.id),
  ])).rows[0].resultado
  ok('Operacao parcial (2/4 parcelas da NF-78) solicitada com sucesso', Boolean(solicitacao.operacao_id))

  await asActor(actorGestor)
  await db.query('RESET ROLE')
  const aprovacao = (await db.query(`select public.aprovar_operacao_atomica_financeiro_v1($1,$2) resultado`, [solicitacao.operacao_id, 2.5])).rows[0].resultado
  ok('Aprovacao da operacao parcial tem sucesso', aprovacao.status === 'aprovada')

  const opNfParcelas = (await db.query(`select nfp.parcela_id, nf_p.numero_parcela from public.operacoes_nf_parcelas nfp
    join public.nota_fiscal_parcelas nf_p on nf_p.id = nfp.parcela_id
    where nfp.operacao_id=$1 and nfp.nota_fiscal_id=$2`, [solicitacao.operacao_id, nf78])).rows
  ok('Teste 3: operacoes_nf_parcelas mostra exatamente 2 parcelas cedidas (nao as 4 da NF)', opNfParcelas.length === 2)

  const somaCedidas = (await db.query(`select sum(valor_nominal)::numeric s from public.nota_fiscal_parcelas where id = ANY($1)`, [opNfParcelas.map((r) => r.parcela_id)])).rows[0].s
  ok('Teste 4: soma nominal das 2 parcelas cedidas = R$ 55.080,00 (nao os R$ 110.160,00 da NF inteira)', Number(somaCedidas) === 55080)

  const calculoParcelas = (await db.query(`select parcela_id, valor_presente, desconto, dias_aplicados from public.operacao_calculo_nfs where operacao_id=$1 and nota_fiscal_id=$2`, [solicitacao.operacao_id, nf78])).rows
  ok('Teste 5: memoria financeira (operacao_calculo_nfs) tem exatamente 2 linhas por parcela, com VP/desconto/prazo calculados (nao recalculado na UI)', (
    calculoParcelas.length === 2 && calculoParcelas.every((row) => row.parcela_id && row.valor_presente !== null && row.desconto !== null && row.dias_aplicados !== null)
  ))

  // ---- Teste 6: NF sem parcelas -- legado intacto ----
  await asActor(actorCedente)
  const opLegadoSolic = (await db.query(`select public.solicitar_operacao_antecipacao_atomica(
    $1,$2,$3,$4,1,'{"calculo_financeiro":{"metodo":"DIAS_UTEIS_252"}}'::jsonb,$5,false,'dispensado',$6,$7,2.5,30,$7,$8,$9,null) resultado`, [
    cedente, cedenteFundoId, politica, politicaVersao, 'a'.repeat(64),
    [nfLegado], 5000.00, '2026-11-30', randomUUID(),
  ])).rows[0].resultado
  await asActor(actorGestor)
  await db.query('RESET ROLE')
  await db.query(`select public.aprovar_operacao_atomica_financeiro_v1($1,$2) resultado`, [opLegadoSolic.operacao_id, 2.5])
  const opNfParcelasLegado = (await db.query(`select count(*)::int c from public.operacoes_nf_parcelas where operacao_id=$1`, [opLegadoSolic.operacao_id])).rows[0].c
  const calcLegado = (await db.query(`select parcela_id, valor_nominal from public.operacao_calculo_nfs where operacao_id=$1`, [opLegadoSolic.operacao_id])).rows
  ok('Teste 6: NF sem parcelas -- nenhuma linha em operacoes_nf_parcelas (legado intacto)', opNfParcelasLegado === 0)
  ok('Teste 6: NF sem parcelas -- 1 linha de memoria (parcela_id null), valor = NF inteira', (
    calcLegado.length === 1 && calcLegado[0].parcela_id === null && Number(calcLegado[0].valor_nominal) === 5000
  ))

  // ---- Teste 7: parcelas aparecem mesmo com politica sem boleto ----
  await asActor(actorCedente2)
  const nfSemBoleto = (await db.query(`insert into public.notas_fiscais
    (cedente_id, cedente_fundo_id, fundo_id, numero_nf, serie, data_emissao, data_vencimento,
     cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, status)
    values ($1,$2,$3,'SEMBOLETO-UIP','1','2026-09-10','2026-11-30',$4,'QA Emitente','12345678000199','QA Sacado',6000.00,'rascunho')
    returning id`, [cedente2, cedenteFundoId2, fundo, makeCnpj('980000030001')])).rows[0].id
  await db.query(`select public.registrar_parcelas_nota_fiscal($1, $2::jsonb) resultado`, [nfSemBoleto, JSON.stringify([
    { numero_parcela: 1, valor_nominal: 3000.00, data_vencimento: '2026-10-15' },
    { numero_parcela: 2, valor_nominal: 3000.00, data_vencimento: '2026-11-30' },
  ])])
  await db.query(`select public.instanciar_requisitos_nota($1,$2,$3) resultado`, [nfSemBoleto, politicaSemBoleto, politicaVersaoSemBoleto])
  const parcelasSemBoleto = (await db.query(`select count(*)::int c from public.nota_fiscal_parcelas where nota_fiscal_id=$1`, [nfSemBoleto])).rows[0].c
  const requisitosBoletoSemBoleto = (await db.query(`select count(*)::int c from public.documento_requisito_instancias where nota_fiscal_id=$1 and tipo_documento_codigo_snapshot='boleto'`, [nfSemBoleto])).rows[0].c
  ok('Teste 7: NF com parcelas mas politica SEM boleto -- nota_fiscal_parcelas continua com as 2 parcelas (fonte de listarParcelasDaNota, independente de boleto)', parcelasSemBoleto === 2)
  ok('Teste 7 (complemento): nenhum requisito de boleto instanciado para esta politica (confirma que a secao nova nao depende dele)', requisitosBoletoSemBoleto === 0)

  // ---- Testes 8-11, 14: edicao de parcelas pelo Cedente em rascunho ----
  await asActor(actorCedente)
  const nfEdicao = (await db.query(`insert into public.notas_fiscais
    (cedente_id, cedente_fundo_id, fundo_id, numero_nf, serie, data_emissao, data_vencimento,
     cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, valor_bruto, status)
    values ($1,$2,$3,'EDICAO-UIP','1','2026-09-10','2026-11-10',$4,'QA Emitente','12345678000199','QA Sacado',300.00,'rascunho')
    returning id`, [cedente, cedenteFundoId, fundo, makeCnpj('980000020001')])).rows[0].id
  await asActor(actorCedente)
  await db.query(`select public.registrar_parcelas_nota_fiscal($1, $2::jsonb) resultado`, [nfEdicao, JSON.stringify([
    { numero_parcela: 1, valor_nominal: 100.00, data_vencimento: '2026-10-10' },
    { numero_parcela: 2, valor_nominal: 100.00, data_vencimento: '2026-10-25' },
    { numero_parcela: 3, valor_nominal: 100.00, data_vencimento: '2026-11-10' },
  ])])
  const parcelasEdicao = (await db.query(`select id, numero_parcela, valor_nominal, data_vencimento from public.nota_fiscal_parcelas where nota_fiscal_id=$1 order by numero_parcela`, [nfEdicao])).rows

  async function editar(parcelasPayload) {
    return (await db.query(`select public.editar_parcelas_nota_fiscal($1, $2::jsonb) resultado`, [nfEdicao, JSON.stringify(parcelasPayload)])).rows[0].resultado
  }
  const payloadBase = () => parcelasEdicao.map((p) => ({ id: p.id, valor_nominal: Number(p.valor_nominal), data_vencimento: p.data_vencimento.toISOString().slice(0, 10) }))

  // Teste 8: cedente edita vencimento -> salva/reload preserva
  const payloadVencimento = payloadBase()
  payloadVencimento[2].data_vencimento = '2026-12-05'
  const resultadoVencimento = await editar(payloadVencimento)
  ok('Teste 8: editar vencimento de uma parcela tem sucesso', resultadoVencimento.parcelas_atualizadas === 3)
  const parcela3Depois = (await db.query(`select data_vencimento from public.nota_fiscal_parcelas where id=$1`, [parcelasEdicao[2].id])).rows[0]
  ok('Teste 8 (reload): vencimento editado persiste no banco', parcela3Depois.data_vencimento.toISOString().slice(0, 10) === '2026-12-05')

  // Teste 14: vencimento agregado da NF = MAX apos edicao
  const nfAposEdicaoVencimento = (await db.query(`select data_vencimento from public.notas_fiscais where id=$1`, [nfEdicao])).rows[0]
  ok('Teste 14: vencimento agregado da NF passa a ser o novo MAX (2026-12-05)', nfAposEdicaoVencimento.data_vencimento.toISOString().slice(0, 10) === '2026-12-05')

  // Teste 9: cedente edita valores mantendo soma correta -> ALLOW
  const payloadValores = payloadVencimento.map((p) => ({ ...p }))
  payloadValores[0].valor_nominal = 90.00
  payloadValores[1].valor_nominal = 110.00
  const resultadoValores = await editar(payloadValores)
  ok('Teste 9: editar valores mantendo a soma (=300,00) tem sucesso', Number(resultadoValores.soma) === 300)

  // Teste 10: soma divergente -> DENY
  await expectError('Teste 10: editar valor quebrando a soma vs valor_bruto = DENY', async () => {
    const payloadDivergente = payloadValores.map((p) => ({ ...p }))
    payloadDivergente[0].valor_nominal = 500.00
    await editar(payloadDivergente)
  }, /nao corresponde ao valor bruto/)

  // Teste 11: NF submetida -> edicao DENY
  await db.query(`update public.notas_fiscais set status='submetida' where id=$1`, [nfEdicao])
  await expectError('Teste 11: NF submetida (fora de rascunho) -- editar_parcelas_nota_fiscal = DENY', async () => {
    await editar(payloadValores)
  }, /rascunho/)
  await db.query(`update public.notas_fiscais set status='rascunho' where id=$1`, [nfEdicao])

  // Teste 12: outro cedente -> DENY
  await asActor(actorCedente2)
  await expectError('Teste 12: outro cedente tentando editar parcela de NF que nao e sua = DENY', async () => {
    await editar(payloadValores)
  }, /fora do cedente autenticado/)
  await asActor(actorCedente)

  // ---- Teste 13: Gestor ve parcelas em leitura (RLS SELECT) ----
  await asActor(actorGestor)
  const leituraGestor = (await db.query(`select count(*)::int c from public.nota_fiscal_parcelas where nota_fiscal_id=$1`, [nfEdicao])).rows[0].c
  ok('Teste 13: Gestor consegue ler as parcelas da NF (RLS de leitura, mesma politica de nota_fiscal_parcelas)', leituraGestor === 3)
  await db.query('SAVEPOINT gestor_write_attempt')
  let gestorEscritaBloqueada = false
  try {
    await editar(payloadValores)
  } catch (error) {
    gestorEscritaBloqueada = /Somente o cedente/.test(error.message)
    await db.query('ROLLBACK TO SAVEPOINT gestor_write_attempt')
  }
  ok('Teste 13 (complemento): Gestor NAO pode editar parcelas (somente leitura)', gestorEscritaBloqueada)
  await asActor(actorCedente)

  // ---- Testes 15-16: guarda de documento dependente (boleto aprovado) ----
  const requisitosBoletoEdicao = (await db.query(`select dri.id, dri.parcela_id, nfp.numero_parcela
    from public.documento_requisito_instancias dri
    join public.nota_fiscal_parcelas nfp on nfp.id = dri.parcela_id
    where dri.nota_fiscal_id=$1 and dri.tipo_documento_codigo_snapshot='boleto' order by nfp.numero_parcela`, [nfEdicao])).rows
  ok('Fixture do guard: nenhum boleto instanciado ainda para NF-EDICAO (politica sem boleto e' + ' esperado -- confirma pre-condicao)', requisitosBoletoEdicao.length === 0)

  // Reaplica a politica COM boleto a esta NF para o teste do guard (instancia os requisitos de boleto sem afetar XML/DANFE/CTE, que nao existem ainda -- ok, o guard so depende do boleto).
  await db.query(`select public.instanciar_requisitos_nota($1,$2,$3) resultado`, [nfEdicao, politica, politicaVersao])
  const requisitosBoletoEdicao2 = (await db.query(`select dri.id, dri.parcela_id, nfp.numero_parcela
    from public.documento_requisito_instancias dri
    join public.nota_fiscal_parcelas nfp on nfp.id = dri.parcela_id
    where dri.nota_fiscal_id=$1 and dri.tipo_documento_codigo_snapshot='boleto' order by nfp.numero_parcela`, [nfEdicao])).rows
  const requisitoBoletoParcela1 = requisitosBoletoEdicao2.find((r) => r.numero_parcela === 1)

  const uploadBoletoP1 = (await db.query(`select public.registrar_documento_boleto_parcela(
    $1,$2,$3,$4,'boleto-p1.pdf','application/pdf',1000,$5,'documentos-v2',$6,$7,null) resultado`,
    [nfEdicao, requisitoBoletoParcela1.id, tipoId.boleto, matriz, sha(), path(), actorCedente])).rows[0].resultado
  await asActor(actorGestor)
  await db.query(`select public.analisar_documento_boleto_gestor($1,'aprovado',null)`, [uploadBoletoP1.versao_id])
  await asActor(actorCedente)

  const parcelasAntesDoGuard = (await db.query(`select id, numero_parcela, valor_nominal, data_vencimento from public.nota_fiscal_parcelas where nota_fiscal_id=$1 order by numero_parcela`, [nfEdicao])).rows
  const payloadAtual = () => parcelasAntesDoGuard.map((p) => ({ id: p.id, valor_nominal: Number(p.valor_nominal), data_vencimento: p.data_vencimento.toISOString().slice(0, 10) }))

  const payloadMudaParcela1 = payloadAtual()
  payloadMudaParcela1[0].valor_nominal = payloadMudaParcela1[0].valor_nominal + 5
  payloadMudaParcela1[1].valor_nominal = payloadMudaParcela1[1].valor_nominal - 5
  await expectError('Teste 15: editar parcela 001 (boleto ja aprovado, valor de fato mudando) = DENY', async () => {
    await editar(payloadMudaParcela1)
  }, /ja tem boleto aprovado/)

  const boletoP1Depois = (await db.query(`select status from public.documento_requisito_instancias where id=$1`, [requisitoBoletoParcela1.id])).rows[0]
  const versaoBoletoP1Depois = (await db.query(`select status from public.documento_versoes where id=$1`, [uploadBoletoP1.versao_id])).rows[0]
  ok('Teste 16: apos a tentativa negada, o boleto aprovado (requisito e versao) permanece intacto -- historico preservado', (
    boletoP1Depois.status === 'satisfeito' && versaoBoletoP1Depois.status === 'aprovado'
  ))

  // Editar SO a parcela 2 (parcela 1, com boleto aprovado, e reenviada SEM
  // alteracao apenas para completar o payload obrigatorio) deve continuar
  // permitido -- o guard e por parcela que de fato muda, nao por NF inteira.
  const payloadSoParcela2 = payloadAtual()
  payloadSoParcela2[1].valor_nominal = payloadSoParcela2[1].valor_nominal + 5
  payloadSoParcela2[2].valor_nominal = payloadSoParcela2[2].valor_nominal - 5
  const resultadoParcial = await editar(payloadSoParcela2)
  ok('Teste 15 (complemento): editar as demais parcelas (parcela 1 reenviada sem mudanca) continua permitido -- guard e por parcela que muda, nao por NF', resultadoParcial.parcelas_atualizadas === 3)

  await db.query('RESET ROLE')
  await db.query('ROLLBACK')
  console.log(JSON.stringify({
    project_ref: apiRef,
    transaction: 'ROLLED_BACK',
    passed: checks.filter((item) => item.status === 'PASS').length,
    failed: checks.filter((item) => item.status === 'FAIL').length,
    checks,
  }, null, 2))
} catch (error) {
  await db.query('ROLLBACK').catch(() => undefined)
  console.error(JSON.stringify({ project_ref: apiRef, transaction: 'ROLLED_BACK', error: error instanceof Error ? error.message : String(error), checks }, null, 2))
  process.exitCode = 1
} finally {
  await db.end()
}

async function expectError(name, callback, pattern) {
  const savepoint = `sp_${checks.length}`
  await db.query(`SAVEPOINT ${savepoint}`)
  try {
    await callback()
    await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    ok(name, false, 'A operacao deveria ter sido bloqueada')
  } catch (error) {
    await db.query(`ROLLBACK TO SAVEPOINT ${savepoint}`)
    ok(name, pattern.test(error instanceof Error ? error.message : String(error)), error instanceof Error ? error.message : String(error))
  }
}

async function createAuthUser(id, role) {
  await db.query(`insert into auth.users (
    id,aud,role,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at
  ) values ($1,'authenticated','authenticated',$2,now(),'{}'::jsonb,$3::jsonb,now(),now())`, [
    id, `qa-ui-parcelas-${id}@example.invalid`, JSON.stringify({ role, nome_completo: `QA ${role}` }),
  ])
}

async function asActor(userId) {
  await db.query('RESET ROLE')
  const claims = { sub: userId, role: 'authenticated', aal: 'aal2', session_id: randomUUID() }
  await db.query(`select set_config('request.jwt.claims',$1,true)`, [JSON.stringify(claims)])
  await db.query(`select set_config('request.jwt.claim.sub',$1,true)`, [userId])
  await db.query(`select set_config('request.jwt.claim.role','authenticated',true)`)
  await db.query('SET LOCAL ROLE authenticated')
}

function ok(name, condition, evidence = null) {
  checks.push({ name, status: condition ? 'PASS' : 'FAIL', ...(evidence ? { evidence } : {}) })
  if (!condition) throw new Error(`Falha E2E: ${name}${evidence ? ` (${evidence})` : ''}`)
}

function sha() {
  return randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64)
}
function path() {
  return `qa/ui-parcelas-nf-operacao/${randomUUID()}.dat`
}
function makeCnpj(base12) {
  const digits = base12.replace(/\D/g, '').padStart(12, '0').slice(-12).split('').map(Number)
  const digit = (values, weights) => {
    const rest = values.reduce((sum, value, index) => sum + value * weights[index], 0) % 11
    return rest < 2 ? 0 : 11 - rest
  }
  const d1 = digit(digits, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = digit([...digits, d1], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return `${digits.join('')}${d1}${d2}`
}
function required(key) {
  const value = process.env[key]
  if (!value) throw new Error(`${key} ausente em .env.homolog.`)
  return value
}
function loadEnv(path) {
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    let value = line.slice(separator + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) value = value.slice(1, -1)
    if (!(key in process.env)) process.env[key] = value
  }
}
