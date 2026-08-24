import { AuthorizationError, requireOperationAccess } from '@/lib/auth/authorization'
import { createClient } from '@/lib/supabase/server'
import {
  montarDetalheOperacaoCedente,
  type EntregaCedenteRaw,
  type NotaFiscalCedenteRaw,
  type OperacaoCedenteDetalhe,
  type OperacaoCedenteRaw,
  type RequisitoCedenteRaw,
  type ParcelaCedidaOperacaoRaw,
  type MemoriaCalculoParcelaRaw,
  type TotalParcelasNotaRaw,
} from '@/lib/operacoes/cedente-detalhe'

export async function carregarDetalheOperacaoCedente(operacaoId: string): Promise<OperacaoCedenteDetalhe> {
  const access = await requireOperationAccess(operacaoId)
  const supabase = await createClient()

  const { data: operacao, error: operacaoError } = await supabase
    .from('operacoes')
    .select(`
      id,
      cedente_id,
      cedente_fundo_id,
      valor_bruto_total,
      taxa_desconto,
      prazo_dias,
      valor_liquido_desembolso,
      data_vencimento,
      status,
      aceite_sacado_exigido,
      aceite_sacado_status,
      aceite_sacado_em,
      aprovado_em,
      cessao_efetivada_em,
      liquidada_em,
      created_at,
      motivo_reprovacao,
      termo_assinado_url,
      comprovante_pagamento_url,
      quitacao_assinada_url,
      politica_snapshot,
      conta_escrow_id,
      remessa_gerado_em,
      remessa_enviado_em,
      cedentes(razao_social, cnpj)
    `)
    .eq('id', operacaoId)
    .maybeSingle()

  if (operacaoError || !operacao) {
    throw new AuthorizationError('Operação não encontrada.', 'NOT_FOUND')
  }

  const op = operacao as unknown as OperacaoCedenteRaw
  if (op.cedente_id !== access.operacao.cedente_id) {
    throw new AuthorizationError('Operação não pertence ao cedente autenticado.', 'FORBIDDEN')
  }

  if (op.cedente_fundo_id) {
    const { data: vinculo, error: vinculoError } = await supabase
      .from('cedente_fundos')
      .select('id, cedente_id')
      .eq('id', op.cedente_fundo_id)
      .eq('cedente_id', op.cedente_id)
      .maybeSingle()

    if (vinculoError || !vinculo) {
      throw new AuthorizationError('Operação não pertence ao vínculo cedente-fundo autorizado.', 'FORBIDDEN')
    }
  }

  const { data: links } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id')
    .eq('operacao_id', operacaoId)

  const notaFiscalIds = ((links || []) as Array<{ nota_fiscal_id: string }>).map((link) => link.nota_fiscal_id)

  const { data: notasFiscais } = notaFiscalIds.length > 0
    ? await supabase
      .from('notas_fiscais')
      .select('id, numero_nf, cnpj_destinatario, razao_social_destinatario, valor_bruto, valor_liquido, valor_antecipado, data_vencimento, status')
      .in('id', notaFiscalIds)
      .eq('cedente_id', op.cedente_id)
      .order('data_vencimento', { ascending: true })
    : { data: [] }

  const { data: entregas } = await supabase
    .from('nota_fiscal_entregas')
    .select('id, nota_fiscal_id, status_entrega, data_limite_cte, data_limite_canhoto, data_entrega, entrega_confirmada_em, motivo_pendencia')
    .eq('operacao_id', operacaoId)
    .order('created_at', { ascending: true })

  const entregaIds = ((entregas || []) as Array<{ id: string }>).map((entrega) => entrega.id)

  const [totaisParcelasResult, parcelasCedidasResult, memoriasResult] = notaFiscalIds.length > 0
    ? await Promise.all([
        supabase.from('nota_fiscal_parcelas').select('nota_fiscal_id').in('nota_fiscal_id', notaFiscalIds),
        supabase.from('operacoes_nf_parcelas')
          .select('nota_fiscal_id,parcela_id,nota_fiscal_parcelas(numero_parcela,valor_nominal,data_vencimento)')
          .eq('operacao_id', operacaoId),
        supabase.from('operacao_calculo_nfs')
          .select('nota_fiscal_id,parcela_id,dias_aplicados,vencimento_contratual,valor_nominal,valor_presente,desconto')
          .eq('operacao_id', operacaoId)
          .order('vencimento_contratual', { ascending: true }),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        { data: [], error: null },
      ]
  if (totaisParcelasResult.error || parcelasCedidasResult.error || memoriasResult.error) {
    throw new Error(`Não foi possível carregar as parcelas da operação: ${totaisParcelasResult.error?.message || parcelasCedidasResult.error?.message || memoriasResult.error?.message}`)
  }
  const parcelasCedidas = ((parcelasCedidasResult.data || []) as unknown as Array<{
    nota_fiscal_id: string
    parcela_id: string
    nota_fiscal_parcelas: { numero_parcela: number; valor_nominal: number; data_vencimento: string } | Array<{ numero_parcela: number; valor_nominal: number; data_vencimento: string }>
  }>).flatMap((item): ParcelaCedidaOperacaoRaw[] => {
    const parcela = Array.isArray(item.nota_fiscal_parcelas) ? item.nota_fiscal_parcelas[0] : item.nota_fiscal_parcelas
    return parcela ? [{
      nota_fiscal_id: item.nota_fiscal_id,
      parcela_id: item.parcela_id,
      numero_parcela: parcela.numero_parcela,
      valor_nominal: Number(parcela.valor_nominal),
      data_vencimento: parcela.data_vencimento,
    }] : []
  })

  const filtrosRequisitos = [
    `operacao_id.eq.${operacaoId}`,
    notaFiscalIds.length ? `nota_fiscal_id.in.(${notaFiscalIds.join(',')})` : '',
    entregaIds.length ? `nota_fiscal_entrega_id.in.(${entregaIds.join(',')})` : '',
  ].filter(Boolean)
  const { data: requisitosData, error: requisitosError } = await supabase
    .from('documento_requisito_instancias')
    .select('id, tipo_documento_codigo_snapshot, escopo_snapshot, nota_fiscal_id, nota_fiscal_entrega_id, operacao_id, status, versao_aprovada_id, obrigatorio, prazo_limite, responsavel_upload_snapshot')
    .or(filtrosRequisitos.join(','))
  if (requisitosError) throw new Error(`Nao foi possivel carregar os requisitos da operacao: ${requisitosError.message}`)
  const requisitosUnicos = Array.from(new Map(
    ((requisitosData || []) as RequisitoCedenteRaw[]).map((requisito) => [requisito.id, requisito]),
  ).values())

  return montarDetalheOperacaoCedente({
    operacao: op,
    notasFiscais: (notasFiscais || []) as NotaFiscalCedenteRaw[],
    entregas: (entregas || []) as EntregaCedenteRaw[],
    requisitos: requisitosUnicos,
    parcelasCedidas,
    memoriasCalculo: (memoriasResult.data || []) as MemoriaCalculoParcelaRaw[],
    totaisParcelas: (totaisParcelasResult.data || []) as TotalParcelasNotaRaw[],
  })
}
