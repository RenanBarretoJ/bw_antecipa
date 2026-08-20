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
