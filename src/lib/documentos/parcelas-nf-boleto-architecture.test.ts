import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migracaoParcelas = readFileSync('supabase/migrations/20260819210000_fase1_parcelas_nf_boleto_por_parcela.sql', 'utf8')
const migracaoBoleto = readFileSync('supabase/migrations/20260819220000_fase1_boleto_por_parcela.sql', 'utf8')
const parser = readFileSync('src/lib/nf-parser.ts', 'utf8')
const documentoV2 = readFileSync('src/lib/actions/documento-v2.ts', 'utf8')
const notaFiscalAction = readFileSync('src/lib/actions/nota-fiscal.ts', 'utf8')
const parcelasNfAction = readFileSync('src/lib/actions/parcelas-nf.ts', 'utf8')
const checklistCedente = readFileSync('src/components/documentos-v2/ChecklistCedente.tsx', 'utf8')
const paginaCedenteNf = readFileSync('src/app/cedente/notas-fiscais/[id]/page.tsx', 'utf8')
const paginaGestorNf = readFileSync('src/app/gestor/notas-fiscais/[id]/page.tsx', 'utf8')
const parcelasBoletosNota = readFileSync('src/components/documentos-v2/ParcelasBoletosNota.tsx', 'utf8')
const evidenciasLogisticas = readFileSync('src/lib/logistica/evidencias-logisticas.ts', 'utf8')
const novaSolicitacaoServer = readFileSync('src/lib/operacoes/nova-solicitacao.server.ts', 'utf8')
const novaSolicitacaoClient = readFileSync('src/app/cedente/operacoes/nova/nova-solicitacao-client.tsx', 'utf8')
const editarParcelasMigration = readFileSync('supabase/migrations/20260820120000_ui_parcelas_nf_operacao_editar_parcelas.sql', 'utf8')
const parcelasDaNota = readFileSync('src/components/notas-fiscais/ParcelasDaNota.tsx', 'utf8')
const operacaoDetalheGestorClient = readFileSync('src/app/gestor/operacoes/[id]/OperacaoDetalheGestorClient.tsx', 'utf8')
const operacaoAction = readFileSync('src/lib/actions/operacao.ts', 'utf8')
const liberarParcelasMigration = readFileSync('supabase/migrations/20260820130000_liberar_parcelas_operacao_rejeitada_cancelada.sql', 'utf8')
const cedenteCancelarMigration = readFileSync('supabase/migrations/20260820140000_permitir_cedente_cancelar_propria_operacao.sql', 'utf8')

describe('Fase 1 (Parcelas de NF): modelo canonico + parser + tolerancia', () => {
  it('cria nota_fiscal_parcelas com as garantias exigidas (unique, valor>0, vencimento obrigatorio)', () => {
    expect(migracaoParcelas).toContain('CONSTRAINT nota_fiscal_parcelas_unique UNIQUE (nota_fiscal_id, numero_parcela)')
    expect(migracaoParcelas).toContain('CONSTRAINT nota_fiscal_parcelas_valor_check CHECK (valor_nominal > 0)')
    expect(migracaoParcelas).toContain('data_vencimento date NOT NULL')
  })

  it('valida a soma das parcelas contra o valor bruto da NF com tolerancia monetaria segura', () => {
    expect(migracaoParcelas).toContain("v_tolerancia := greatest(v_inseridas * 0.01, 0.01)")
    expect(migracaoParcelas).toContain('IF abs(v_soma - v_nf.valor_bruto) > v_tolerancia THEN')
  })

  it('nao reaproveita o modulo "duplicatas" (conceito adjacente, mas distinto) nem duplica arquitetura', () => {
    expect(migracaoParcelas).not.toContain('public.duplicatas')
    expect(migracaoParcelas).toContain('CREATE TABLE public.nota_fiscal_parcelas')
  })

  it('parser extrai todas as <dup> (nDup/dVenc/vDup), nao so a ultima', () => {
    expect(parser).toContain('const parcelas: NfParsedParcela[] = dupBlocks.map((dup, index) => {')
    expect(parser).toContain("getTagValue(dup, 'nDup')")
    expect(parser).toContain("getTagValue(dup, 'vDup')")
  })

  it('vencimento agregado da NF continua vindo da ultima <dup> (compatibilidade preservada)', () => {
    expect(parser).toContain('const lastDup = dupBlocks[dupBlocks.length - 1]')
  })

  it('NF sem <dup> nao aciona registrar_parcelas_nota_fiscal (comportamento legado preservado)', () => {
    expect(notaFiscalAction).toContain('if (parsed.parcelas.length > 0) {')
    expect(notaFiscalAction).toContain("supabase.rpc('registrar_parcelas_nota_fiscal'")
  })

  it('falha na validacao de parcelas aborta e limpa a NF parcial (nao aceita XML com parcelas inconsistentes)', () => {
    const bloco = notaFiscalAction.slice(notaFiscalAction.indexOf('if (parsed.parcelas.length > 0) {'), notaFiscalAction.indexOf('return { ok: true, id: nfData.id, isRascunho: true }'))
    expect(bloco).toContain('removerNotaFiscalParcial')
    expect(bloco).toContain('return { ok: false')
  })
})

describe('Fase 1 (Boleto por parcela): catalogo, cardinalidade e motor reaproveitado', () => {
  it('cataloga boleto com cardinalidade por_parcela (fecha o bug "Tipo ainda nao catalogado")', () => {
    expect(migracaoBoleto).toContain("'boleto', 'Boleto da Parcela', 'nf', 'por_parcela'")
    expect(migracaoBoleto).toContain("CHECK (cardinalidade IN ('por_nf', 'por_parcela'))")
  })

  it('instanciar_requisitos_nota preserva a logica canonica atual (cedente_fundo_politicas, publicada_em) e so adiciona o fan-out por_parcela', () => {
    expect(migracaoBoleto).toContain('JOIN public.cedente_fundo_politicas cfp')
    expect(migracaoBoleto).toContain('pov.publicada_em IS NOT NULL')
    expect(migracaoBoleto).toContain("public.reconciliar_documentos_base_nf(p_nota_fiscal_id)")
    expect(migracaoBoleto).toContain("WHERE c.cardinalidade = 'por_parcela'")
  })

  it('requisito por_parcela e unico por (requisito, nf, parcela), nao apenas por (requisito, nf)', () => {
    expect(migracaoBoleto).toContain('UNIQUE NULLS NOT DISTINCT (politica_requisito_id, nota_fiscal_id, parcela_id)')
  })

  it('nao reaproveita analisar_documento_versao sem escopo -- cria wrapper com checagem multifundo real', () => {
    expect(migracaoBoleto).toContain('CREATE OR REPLACE FUNCTION public.analisar_documento_boleto_gestor(')
    expect(migracaoBoleto).toContain('private.gestor_tem_acesso_cedente(v_vinculo.cedente_id)')
    expect(migracaoBoleto).toContain('RETURN public.analisar_documento_versao(p_documento_versao_id, p_resultado, p_observacoes')
  })

  it('upload de boleto reaproveita registrar_documento_upload sem duplicar a logica de versionamento', () => {
    expect(migracaoBoleto).toContain('v_resultado := public.registrar_documento_upload(')
  })

  it('valida beneficiario como Matriz ou Estabelecimento aprovado do mesmo Cedente', () => {
    expect(migracaoBoleto).toContain("v_beneficiario.cedente_id <> v_nf_cedente OR v_beneficiario.status <> 'aprovado'")
  })

  it('checklist geral (nao por parcela) exclui requisitos com parcela_id, evitando itens sem rotulo de parcela', () => {
    expect(documentoV2).toContain(".is('parcela_id', null)")
  })
})

describe('P0 (correcao): Boleto dentro do card "Documentos pre-cessao", sem card dominante separado', () => {
  it('ParcelasBoletosNota nao e mais renderizado como card independente nas paginas da NF', () => {
    expect(paginaCedenteNf).not.toContain('ParcelasBoletosNota')
    expect(paginaGestorNf).not.toContain('ParcelasBoletosNota')
  })

  it('ChecklistCedente (usado por cedente e gestor) renderiza o item de Boleto dentro do mesmo bloco de "Documentos pre-cessao"', () => {
    const secaoPreCessao = checklistCedente.slice(
      checklistCedente.indexOf('Documentos pré-cessão'),
      checklistCedente.indexOf('logisticaAntecipada.length > 0'),
    )
    expect(secaoPreCessao).toContain('checklist.preCessao.map')
    expect(secaoPreCessao).toContain('<ParcelasBoletosNota')
  })

  it('listarParcelasBoletosDaNota constroi itens a partir das instancias reais de requisito, nao de todas as parcelas da NF', () => {
    expect(parcelasNfAction).not.toContain('parcelasRows.map((parcela) => {')
    expect(parcelasNfAction).toContain('requisitosRows')
    expect(parcelasNfAction).toContain('if (requisitosRows.length === 0) return { success: true, message:')
  })
})

describe('P0 (correcao): requisitos documentais nao carregam -- ordem de criacao da NF', () => {
  const blocoUploadXml = notaFiscalAction.slice(
    notaFiscalAction.indexOf("const nfData = nf as { id: string }"),
    notaFiscalAction.indexOf('} else {', notaFiscalAction.indexOf("const nfData = nf as { id: string }")),
  )

  it('registrar_parcelas_nota_fiscal e chamado ANTES de uploadDocumentoSeRequerido (para o fan-out de boleto por_parcela ja encontrar as parcelas na 1a instanciacao)', () => {
    const indiceParcelas = blocoUploadXml.indexOf("supabase.rpc('registrar_parcelas_nota_fiscal'")
    const indiceUploadXml = blocoUploadXml.indexOf('uploadDocumentoSeRequerido(')
    expect(indiceParcelas).toBeGreaterThan(-1)
    expect(indiceUploadXml).toBeGreaterThan(-1)
    expect(indiceParcelas).toBeLessThan(indiceUploadXml)
  })

  it('removerNotaFiscalParcial remove nota_fiscal_parcelas antes de remover a NF (nota_fiscal_parcelas.nota_fiscal_id e ON DELETE RESTRICT)', () => {
    const funcao = notaFiscalAction.slice(
      notaFiscalAction.indexOf('async function removerNotaFiscalParcial'),
      notaFiscalAction.indexOf('async function recuperarDuplicidadeIncompleta'),
    )
    const indiceDeleteParcelas = funcao.indexOf("from('nota_fiscal_parcelas').delete()")
    const indiceDeleteNf = funcao.indexOf("from('notas_fiscais')")
    expect(indiceDeleteParcelas).toBeGreaterThan(-1)
    expect(indiceDeleteNf).toBeGreaterThan(-1)
    expect(indiceDeleteParcelas).toBeLessThan(indiceDeleteNf)
  })
})

describe('P0 (correcao real): checklist inteiro escondido por politica exigir boleto (por_parcela)', () => {
  // Achado ao vivo: resolverEstadoChecklistDocumental (checklist-state.ts)
  // marca a NF inteira como 'nao_instanciado' -- escondendo XML/DANFE/CT-e
  // e o proprio boleto -- sempre que um requisito "aplicavel" nao tem
  // NENHUMA instancia correspondente na lista passada a ela. Como as
  // instancias de boleto (por_parcela) sao deliberadamente excluidas da
  // query usada para o checklist geral (`.is('parcela_id', null)`, Fase 1),
  // qualquer politica que exija boleto fazia esse requisito aparecer como
  // "aplicavel sem instancia" -- mesmo com XML/DANFE/CT-e e as instancias
  // de boleto todas corretamente instanciadas no banco. Corrigido excluindo
  // requisitos de cardinalidade por_parcela de requisitosDaPolitica (o
  // input passado a resolverEstadoChecklistDocumental), nos dois ramos de
  // construcao dessa lista.
  it('requisitosDaPolitica exclui codigos de cardinalidade por_parcela (boleto) do calculo de estadoChecklist', () => {
    expect(documentoV2).toContain('codigosPorParcela')
    expect(documentoV2).toContain("cardinalidade === 'por_parcela'")
    const trechoRamo1 = documentoV2.slice(documentoV2.indexOf('const requisitosDaPolitica'), documentoV2.indexOf('resolverEstadoChecklistDocumental({'))
    expect(trechoRamo1).toContain('!codigosPorParcela.has(row.tipo_documento_codigo)')
    expect(trechoRamo1).toContain('!codigosPorParcela.has(row.tipo_documento_codigo_snapshot)')
  })

  it('a cardinalidade e resolvida a partir do catalogo documento_tipos, nao hardcoded para "boleto"', () => {
    const trecho = documentoV2.slice(documentoV2.indexOf('policyRequirementCodes'), documentoV2.indexOf('const [{ data: policyVersionData'))
    expect(trecho).toContain("from('documento_tipos')")
    expect(trecho).toContain("select('codigo, cardinalidade')")
    expect(trecho).not.toContain("=== 'boleto'")
  })
})

describe('P0 (correcao): gate logistico submissao vs aprovacao, status real do boleto, card compacto', () => {
  it('submeterNF usa o gate de submissao (vigente), nao mais o de aprovacao (aprovado)', () => {
    expect(notaFiscalAction).toContain('checklist.gateLogisticoPreCessao.permitidoSubmissao')
    expect(notaFiscalAction).not.toContain("checklist.gateLogisticoPreCessao.status === 'INDETERMINADA'")
    expect(notaFiscalAction).toContain('A politica exige o envio de CT-e/DACTE ou Comprovante de Entrega antes da submissao.')
  })

  it('aprovarNF (gestor) continua exigindo evidencia aprovada via avaliar_gate_logistico_pre_cessao_nfs', () => {
    expect(notaFiscalAction).toContain('avaliar_gate_logistico_pre_cessao_nfs')
    expect(notaFiscalAction).toContain('A evidencia logistica obrigatoria ainda nao foi aprovada.')
  })

  it('documento-v2.ts calcula o gate de submissao a partir de avaliarSubmissaoLogisticaPreCessao (evidencia vigente), separado do rotulo de exibicao', () => {
    expect(documentoV2).toContain('avaliarSubmissaoLogisticaPreCessao')
    expect(documentoV2).toContain('permitidoSubmissao: gateLogisticoPermitidoSubmissao.permitido')
  })

  it('avaliarSubmissaoLogisticaPreCessao usa a evidencia mais recente por UPLOAD, nao por analise (rejeicao antiga nao bloqueia apos reenvio)', () => {
    expect(evidenciasLogisticas).toContain('function maisRecentePorUpload')
    expect(evidenciasLogisticas).toContain('criadoEm')
  })

  it('aprovarNF e aprovarNFsLote reconciliam requisitos (instanciarRequisitosDaNota) ANTES de avaliar carregarResumoDocumentalDasNotas', () => {
    const funcaoIndividual = notaFiscalAction.slice(
      notaFiscalAction.indexOf('export async function aprovarNF('),
      notaFiscalAction.indexOf('export async function reprovarNF('),
    )
    const indiceReconciliaIndividual = funcaoIndividual.indexOf('instanciarRequisitosDaNota(nfId, supabase)')
    const indiceResumoIndividual = funcaoIndividual.indexOf('carregarResumoDocumentalDasNotas(supabase, [nfId])')
    expect(indiceReconciliaIndividual).toBeGreaterThan(-1)
    expect(indiceResumoIndividual).toBeGreaterThan(-1)
    expect(indiceReconciliaIndividual).toBeLessThan(indiceResumoIndividual)

    const funcaoLote = notaFiscalAction.slice(notaFiscalAction.indexOf('export async function aprovarNFsLote('))
    const indiceReconciliaLote = funcaoLote.indexOf('instanciarRequisitosDaNota(notaFiscalId, supabase)')
    const indiceResumoLote = funcaoLote.indexOf('carregarResumoDocumentalDasNotas(supabase, idsUnicos)')
    expect(indiceReconciliaLote).toBeGreaterThan(-1)
    expect(indiceResumoLote).toBeGreaterThan(-1)
    expect(indiceReconciliaLote).toBeLessThan(indiceResumoLote)
  })

  it('listarParcelasBoletosDaNota deriva o status exibido da versao/analise real, nao apenas do status estatico da instancia', () => {
    expect(parcelasNfAction).toContain('function derivarStatusBoleto')
    expect(parcelasNfAction).toContain('status: derivarStatusBoleto(requisito.status, versaoAtual, ultimaAnalise)')
    expect(parcelasNfAction).not.toMatch(/status:\s*requisito\.status,/)
  })

  it('avaliacao-checklist-aprovacao.ts agrupa instancias por requisito em lista (nao Map 1:1) para nao colapsar parcelas', () => {
    const avaliacaoAprovacao = readFileSync('src/lib/notas-fiscais/avaliacao-checklist-aprovacao.ts', 'utf8')
    expect(avaliacaoAprovacao).toContain('instanciasPorRequisito')
    expect(avaliacaoAprovacao).not.toContain('new Map(\n    input.instancias')
  })

  it('Boleto permanece dentro de Documentos pre-cessao (sem card independente "Parcelas / Boletos")', () => {
    expect(parcelasBoletosNota).not.toContain('Parcelas / Boletos')
  })

  it('o card de Boleto comeca recolhido e mostra cabecalho com obrigatoriedade, contagem e status agregado', () => {
    expect(parcelasBoletosNota).toContain("useState(false)")
    expect(parcelasBoletosNota).toContain('function statusAgregado')
    expect(parcelasBoletosNota).toContain('aprovados</span>')
  })

  it('recolher/expandir usa CSS (hidden), nao desmontagem condicional -- preserva selecao de formulario ja feita', () => {
    expect(parcelasBoletosNota).toContain("expanded ? 'border-t border-border' : 'hidden'")
    expect(parcelasBoletosNota).not.toContain('{expanded && (')
  })

  it('abre automaticamente quando ha parcela rejeitada ou com ajuste solicitado', () => {
    expect(parcelasBoletosNota).toContain('PENDENCIA_STATUS')
    expect(parcelasBoletosNota).toContain('setExpanded(true)')
  })

  it('layout expandido tem cabecalho de tabela desktop com as colunas pedidas e uma variante mobile empilhada', () => {
    expect(parcelasBoletosNota).toContain('Parcela')
    expect(parcelasBoletosNota).toContain('Vencimento')
    expect(parcelasBoletosNota).toContain('Beneficiário')
    expect(parcelasBoletosNota).toContain('md:hidden')
    expect(parcelasBoletosNota).toContain('md:grid')
  })
})

describe('P0 (correcao): submissao divergia do checklist -- CT-e do fluxo regular nao era reconhecido como evidencia logistica', () => {
  // NF-56 real: CT-e anexado e "Aguardando analise" no checklist normal
  // (documento_requisito_instancias/documento_versoes), mas o gate
  // logistico (display + submissao) so lia evidencias_logisticas_antecipadas
  // -- fonte separada, nunca populada quando o upload usa o fluxo regular.
  it('documento-v2.ts combina evidencias antecipadas com as do checklist regular antes de classificar/avaliar o gate', () => {
    expect(documentoV2).toContain('evidenciasDoChecklistRegular(items)')
    expect(documentoV2).toContain('[...evidenciasAntecipadas, ...evidenciasDoChecklistRegular(items)]')
    const indiceCombinacao = documentoV2.indexOf('const evidenciasLogisticas = [...evidenciasAntecipadas')
    const indiceClassificacao = documentoV2.indexOf('const classificacaoLogistica = classificarStatusLogisticoPreCessao(evidenciasLogisticas)')
    const indiceGate = documentoV2.indexOf('const gateLogisticoPermitidoSubmissao = avaliarSubmissaoLogisticaPreCessao(')
    expect(indiceCombinacao).toBeGreaterThan(-1)
    expect(indiceCombinacao).toBeLessThan(indiceClassificacao)
    expect(indiceClassificacao).toBeLessThan(indiceGate)
  })

  it('evidenciasDoChecklistRegular so considera CT-e/Comprovante com escopo nf_pre_cessao (nao duplica arquivo, nao inventa fonte nova)', () => {
    expect(evidenciasLogisticas).toContain("item.escopo === 'nf_pre_cessao'")
    expect(evidenciasLogisticas).toContain("item.familiaDocumental === 'cte' || item.familiaDocumental === 'comprovante_entrega'")
  })
})

// P0 real: NF-3493 (achada pelo usuario ao vivo no deploy do Vercel) tem
// uma parcela com vencimento individual ja passado, mesmo com o
// vencimento agregado da NF (a ultima parcela) ainda no futuro -- essa NF
// passava pela elegibilidade da listagem, mas selecionar a NF alimentava
// a parcela vencida em calcularAntecipacaoEmLote, que lanca
// CalculoFinanceiroError sem tratamento no render e quebrava a pagina
// inteira ("This page couldn't load"). Confirmado isolando o calculo com
// os numeros reais da NF-3493 antes de corrigir (ver relatorio).
describe('P0 (correcao real): crash ao selecionar NF com parcela vencida em nova-solicitacao', () => {
  it('nova-solicitacao.server.ts exclui parcelas com vencimento individual ja passado do carregamento (mesma regra ja aplicada a NF inteira)', () => {
    const indiceQueryParcelas = novaSolicitacaoServer.indexOf("from('nota_fiscal_parcelas')")
    const indiceOrderParcelas = novaSolicitacaoServer.indexOf("order('numero_parcela', { ascending: true })")
    const indiceFiltroParcelas = novaSolicitacaoServer.indexOf(".gte('data_vencimento', dataBase)", indiceQueryParcelas)
    expect(indiceQueryParcelas).toBeGreaterThan(-1)
    expect(indiceOrderParcelas).toBeGreaterThan(indiceQueryParcelas)
    expect(indiceFiltroParcelas).toBeGreaterThan(indiceQueryParcelas)
    expect(indiceFiltroParcelas).toBeLessThan(indiceOrderParcelas)
  })

  it('nova-solicitacao-client.tsx nunca deixa uma falha de calculo (ex.: parcela vencida) quebrar o render inteiro', () => {
    expect(novaSolicitacaoClient).toContain('CalculoFinanceiroError')
    const indiceTry = novaSolicitacaoClient.indexOf('try {')
    const indiceCalculo = novaSolicitacaoClient.indexOf('calcularAntecipacaoEmLote({')
    const indiceCatch = novaSolicitacaoClient.indexOf('} catch (error) {')
    expect(indiceTry).toBeGreaterThan(-1)
    expect(indiceTry).toBeLessThan(indiceCalculo)
    expect(indiceCalculo).toBeLessThan(indiceCatch)
    expect(novaSolicitacaoClient).toContain('erroCalculo')
  })
})

// UI/Operacional: parcelas na NF e na Operacao (Claude_UI_Parcelas_NF_e_
// Operacao.txt). ParcelasDaNota e uma secao INDEPENDENTE do requisito
// boleto (diferente de ParcelasBoletosNota, testada acima) -- nao pode
// ser confundida/fundida com ela.
describe('UI/Operacional: secao "Parcelas da Nota Fiscal" independente de boleto', () => {
  it('ParcelasDaNota e renderizado nas duas paginas de NF (cedente e gestor), fora do checklist', () => {
    expect(paginaCedenteNf).toContain('<ParcelasDaNota')
    expect(paginaGestorNf).toContain('<ParcelasDaNota')
  })

  it('ParcelasDaNota nao depende de nenhum requisito de boleto -- le nota_fiscal_parcelas diretamente', () => {
    expect(parcelasDaNota).toContain('listarParcelasDaNota')
    expect(parcelasDaNota).not.toContain('documento_requisito_instancias')
    expect(parcelasDaNota).not.toContain("tipo_documento_codigo_snapshot")
  })

  it('listarParcelasDaNota busca de nota_fiscal_parcelas sem filtrar por boleto/politica', () => {
    const indiceFuncao = parcelasNfAction.indexOf('export async function listarParcelasDaNota')
    const indiceProximaFuncao = parcelasNfAction.indexOf('export interface ParcelaEdicaoInput')
    const corpo = parcelasNfAction.slice(indiceFuncao, indiceProximaFuncao)
    expect(indiceFuncao).toBeGreaterThan(-1)
    expect(corpo).toContain("from('nota_fiscal_parcelas')")
    expect(corpo).not.toContain('boleto')
  })

  it('Gestor edita NF: ParcelasDaNota so permite edicao para mode="cedente" (Gestor sempre leitura)', () => {
    expect(parcelasDaNota).toContain("mode === 'cedente' && editavel")
  })
})

describe('UI/Operacional: correcao de parcelas pelo Cedente (RPC editar_parcelas_nota_fiscal)', () => {
  it('a RPC exige NF em rascunho e cedente dono antes de editar (nao repete o gap de salvarDadosNF)', () => {
    expect(editarParcelasMigration).toContain("v_nf.status::text <> 'rascunho'")
    expect(editarParcelasMigration).toContain('v_nf.cedente_id <> (SELECT public.get_user_cedente_id())')
  })

  it('numero da parcela permanece imutavel -- payload so aceita id/valor_nominal/data_vencimento', () => {
    expect(editarParcelasMigration).not.toContain('numero_parcela = ')
  })

  it('guarda de documento dependente (boleto aprovado) so bloqueia quando o valor/vencimento desta parcela de fato muda', () => {
    const indiceGuardaD = editarParcelasMigration.indexOf('Guarda D')
    const indiceCondicao = editarParcelasMigration.indexOf('IS DISTINCT FROM v_existente.valor_nominal', indiceGuardaD)
    const indiceExists = editarParcelasMigration.indexOf('EXISTS (', indiceGuardaD)
    expect(indiceGuardaD).toBeGreaterThan(-1)
    expect(indiceCondicao).toBeGreaterThan(indiceGuardaD)
    expect(indiceCondicao).toBeLessThan(indiceExists)
    expect(editarParcelasMigration).toContain("tipo_documento_codigo_snapshot = 'boleto'")
    expect(editarParcelasMigration).toContain("status = 'satisfeito'")
  })

  it('apos editar, o vencimento agregado da NF e recalculado para o novo MAX -- nao fica desatualizado', () => {
    expect(editarParcelasMigration).toContain('max(data_vencimento) INTO v_max_vencimento')
    expect(editarParcelasMigration).toContain('SET data_vencimento = v_max_vencimento')
  })

  it('tolerancia monetaria da edicao espelha a mesma regra de registrar_parcelas_nota_fiscal', () => {
    expect(editarParcelasMigration).toContain('greatest(v_count_existentes * 0.01, 0.01)')
  })
})

describe('UI/Operacional: detalhe por parcela na Operacao do Gestor (nao mais agregado so por NF)', () => {
  it('carrega operacoes_nf_parcelas e operacao_calculo_nfs.parcela_id (nao apenas nota_fiscal_id)', () => {
    expect(operacaoDetalheGestorClient).toContain("from('operacoes_nf_parcelas')")
    expect(operacaoDetalheGestorClient).toContain('parcela_id, dias_aplicados, vencimento_contratual')
  })

  it('bruto/antecipado exibidos por NF usam as parcelas cedidas nesta operacao quando existirem, nao o valor integral da NF', () => {
    expect(operacaoDetalheGestorClient).toContain('brutoCedido ?? nf.valor_bruto')
    expect(operacaoDetalheGestorClient).toContain('antecipadoMemoria ?? (')
  })

  it('NF sem parcelas (totalParcelas === 0) nao renderiza nenhum bloco extra -- legado intacto', () => {
    expect(operacaoDetalheGestorClient).toContain('totalParcelas > 0 && (')
  })

  it('bloco de parcelas cedidas e expansivel por NF ("X/Y parcelas cedidas")', () => {
    expect(operacaoDetalheGestorClient).toContain('parcelas cedidas')
    expect(operacaoDetalheGestorClient).toContain('toggleNfExpandida')
  })
})

// P0 (correcao real, confirmada ao vivo em homolog): reprovarOperacao/
// cancelarOperacao chamavam liberarParcelasDaOperacao, que fazia UPDATE/
// DELETE diretos em nota_fiscal_parcelas/operacoes_nf_parcelas -- tabelas
// que so tem GRANT SELECT para authenticated (escrita e exclusiva de RPC
// SECURITY DEFINER). O erro "permission denied" era descartado em silencio
// (o codigo nao checava { error }), entao a NF reprovada voltava a aparecer
// em "Nova Solicitacao" com 0 parcelas disponiveis para expandir.
describe('P0 (correcao real): rejeicao/cancelamento nao liberava parcelas (grant/RLS insuficiente para escrita direta)', () => {
  it('liberarParcelasDaOperacao chama a RPC liberar_parcelas_operacao_rejeitada, nao UPDATE/DELETE diretos', () => {
    const indiceFuncao = operacaoAction.indexOf('async function liberarParcelasDaOperacao')
    const indiceFimFuncao = operacaoAction.indexOf('\n}', indiceFuncao)
    const corpo = operacaoAction.slice(indiceFuncao, indiceFimFuncao)
    expect(indiceFuncao).toBeGreaterThan(-1)
    expect(corpo).toContain("supabase.rpc('liberar_parcelas_operacao_rejeitada'")
    expect(corpo).not.toContain("from('nota_fiscal_parcelas').update")
    expect(corpo).not.toContain("from('operacoes_nf_parcelas').delete")
  })

  it('a falha da RPC e logada, nao mais descartada em silencio', () => {
    const indiceFuncao = operacaoAction.indexOf('async function liberarParcelasDaOperacao')
    const indiceFimFuncao = operacaoAction.indexOf('\n}', indiceFuncao)
    const corpo = operacaoAction.slice(indiceFuncao, indiceFimFuncao)
    expect(corpo).toContain('if (error)')
    expect(corpo).toContain('console.error')
  })

  it('reprovarOperacao (gestor) e cancelarOperacao (cedente) usam a mesma funcao de liberacao', () => {
    const indiceReprovar = operacaoAction.indexOf('export async function reprovarOperacao')
    const indiceCancelar = operacaoAction.indexOf('export async function cancelarOperacao')
    const indiceFimCancelar = operacaoAction.indexOf('\n}', operacaoAction.indexOf('return { success: true', indiceCancelar))
    expect(operacaoAction.slice(indiceReprovar, indiceCancelar)).toContain('liberarParcelasDaOperacao(supabase, operacaoId)')
    expect(operacaoAction.slice(indiceCancelar, indiceFimCancelar)).toContain('liberarParcelasDaOperacao(supabase, operacaoId)')
  })

  it('RPC exige operacao ja reprovada/cancelada e autoriza so o gestor do fundo ou o cedente dono', () => {
    expect(liberarParcelasMigration).toContain("op.status NOT IN ('reprovada', 'cancelada')")
    expect(liberarParcelasMigration).toContain('private.gestor_tem_acesso_cedente(op.cedente_id)')
    expect(liberarParcelasMigration).toContain('op.cedente_id <> (SELECT public.get_user_cedente_id())')
  })

  it('RPC libera exatamente as parcelas da operacao e remove so o vinculo operacoes_nf_parcelas daquela operacao (nao toca operacoes_nfs, historico legado preservado)', () => {
    expect(liberarParcelasMigration).toContain("SET status = 'disponivel'")
    expect(liberarParcelasMigration).toContain('DELETE FROM public.operacoes_nf_parcelas WHERE operacao_id = p_operacao_id')
    expect(liberarParcelasMigration).not.toContain('DELETE FROM public.operacoes_nfs')
  })

  it('achado colateral: policy nova permite cedente cancelar (UPDATE) apenas a propria operacao, so enquanto solicitada/em_analise', () => {
    expect(cedenteCancelarMigration).toContain('CREATE POLICY operacoes_cedente_update ON public.operacoes')
    expect(cedenteCancelarMigration).toContain("status IN ('solicitada', 'em_analise')")
    expect(cedenteCancelarMigration).toContain('cedente_id = (SELECT public.get_user_cedente_id())')
  })
})

// P0/UI: ordem das secoes no Detalhe da NF (Claude_Rejeicao_Relibera_
// Parcelas_e_UI_NF.txt) -- Dados da Nota Fiscal -> Emitente -> Destinatario
// -> Valores -> Parcelas da Nota Fiscal. "Data de Vencimento" some do card
// "Dados da Nota Fiscal"/"Dados da NF" quando a NF tem parcelas (o vencimento
// passa a ser por parcela); notas_fiscais.data_vencimento continua sendo
// so o agregado legado (MAX das parcelas), preservado pela RPC de edicao.
describe('P0/UI: "Parcelas da Nota Fiscal" reposicionada logo abaixo de "Valores"; "Data de Vencimento" agregada some quando ha parcelas', () => {
  it('Cedente: ParcelasDaNota renderiza depois do card "Valores" (edicao e somente-leitura) e recebe onTemParcelas', () => {
    const indiceValores = paginaCedenteNf.indexOf('Valores</h2>')
    const indiceParcelas = paginaCedenteNf.indexOf('<ParcelasDaNota')
    expect(indiceValores).toBeGreaterThan(-1)
    expect(indiceParcelas).toBeGreaterThan(indiceValores)
    expect(paginaCedenteNf).toContain('onTemParcelas={setTemParcelas}')
  })

  it('Gestor: ParcelasDaNota renderiza depois do card "Valores"', () => {
    const indiceValores = paginaGestorNf.indexOf('<CardTitle className="text-base">Valores</CardTitle>')
    const indiceParcelas = paginaGestorNf.indexOf('<ParcelasDaNota')
    expect(indiceValores).toBeGreaterThan(-1)
    expect(indiceParcelas).toBeGreaterThan(indiceValores)
    expect(paginaGestorNf).toContain('onTemParcelas={setTemParcelas}')
  })

  it('ParcelasDaNota expoe onTemParcelas com o resultado real do carregamento (nao so um placeholder)', () => {
    expect(parcelasDaNota).toContain('onTemParcelas?.(result.data.itens.length > 0)')
    expect(parcelasDaNota).toContain('onTemParcelas?.(false)')
  })

  it('Cedente: "Data de Vencimento" some do formulario editavel e do modo somente-leitura quando a NF tem parcelas', () => {
    const indiceLabelEditavel = paginaCedenteNf.indexOf('Data de Vencimento *')
    const indiceCondicionalEditavel = paginaCedenteNf.lastIndexOf('{!temParcelas && (', indiceLabelEditavel)
    expect(indiceLabelEditavel).toBeGreaterThan(-1)
    expect(indiceCondicionalEditavel).toBeGreaterThan(-1)
    expect(indiceLabelEditavel - indiceCondicionalEditavel).toBeLessThan(200)
    expect(paginaCedenteNf).toContain("{!temParcelas && <LabelValue label=\"Vencimento\" value={formatDate(nf.data_vencimento)} />}")
  })

  it('Gestor: "Data Vencimento" some do card "Dados da NF" quando a NF tem parcelas', () => {
    const indiceCard = paginaGestorNf.indexOf('Dados da NF')
    const indiceCondicional = paginaGestorNf.indexOf('{!temParcelas && (', indiceCard)
    const indiceLabel = paginaGestorNf.indexOf('Data Vencimento', indiceCard)
    expect(indiceCondicional).toBeGreaterThan(indiceCard)
    expect(indiceLabel).toBeGreaterThan(indiceCondicional)
  })

  it('NF sem parcelas preserva o comportamento legado: temParcelas comeca false e nada e escondido por padrao', () => {
    expect(paginaCedenteNf).toContain('const [temParcelas, setTemParcelas] = useState(false)')
    expect(paginaGestorNf).toContain('const [temParcelas, setTemParcelas] = useState(false)')
  })
})
