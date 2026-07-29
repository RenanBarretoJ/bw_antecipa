import { AuthorizationError, requireOperationAccess } from '@/lib/auth/authorization'
import { createClient } from '@/lib/supabase/server'
import {
  montarDetalheOperacaoCedente,
  type EntregaCedenteRaw,
  type NotaFiscalCedenteRaw,
  type OperacaoCedenteDetalhe,
  type OperacaoCedenteRaw,
  type RequisitoCedenteRaw,
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

  const requisitos: RequisitoCedenteRaw[] = []
  if (notaFiscalIds.length > 0) {
    const { data } = await supabase
      .from('documento_requisito_instancias')
      .select('id, tipo_documento_codigo_snapshot, escopo_snapshot, nota_fiscal_id, nota_fiscal_entrega_id, operacao_id, status, versao_aprovada_id, obrigatorio, prazo_limite, responsavel_upload_snapshot')
      .in('nota_fiscal_id', notaFiscalIds)
    requisitos.push(...((data || []) as RequisitoCedenteRaw[]))
  }

  if (entregaIds.length > 0) {
    const { data } = await supabase
      .from('documento_requisito_instancias')
      .select('id, tipo_documento_codigo_snapshot, escopo_snapshot, nota_fiscal_id, nota_fiscal_entrega_id, operacao_id, status, versao_aprovada_id, obrigatorio, prazo_limite, responsavel_upload_snapshot')
      .in('nota_fiscal_entrega_id', entregaIds)
    requisitos.push(...((data || []) as RequisitoCedenteRaw[]))
  }

  const { data: requisitosOperacao } = await supabase
    .from('documento_requisito_instancias')
    .select('id, tipo_documento_codigo_snapshot, escopo_snapshot, nota_fiscal_id, nota_fiscal_entrega_id, operacao_id, status, versao_aprovada_id, obrigatorio, prazo_limite, responsavel_upload_snapshot')
    .eq('operacao_id', operacaoId)
  requisitos.push(...((requisitosOperacao || []) as RequisitoCedenteRaw[]))

  const requisitosUnicos = Array.from(new Map(requisitos.map((requisito) => [requisito.id, requisito])).values())

  return montarDetalheOperacaoCedente({
    operacao: op,
    notasFiscais: (notasFiscais || []) as NotaFiscalCedenteRaw[],
    entregas: (entregas || []) as EntregaCedenteRaw[],
    requisitos: requisitosUnicos,
  })
}
