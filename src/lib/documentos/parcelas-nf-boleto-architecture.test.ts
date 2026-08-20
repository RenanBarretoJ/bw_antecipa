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
