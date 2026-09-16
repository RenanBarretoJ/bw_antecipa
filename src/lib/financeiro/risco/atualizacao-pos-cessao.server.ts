import 'server-only'

import { executarGateRisco } from './processor.server'

export async function atualizarRiscoAposCessao(input: {
  fundoId: string
  operacaoId: string
  atorUsuarioId: string
  dataOperacional: string
}): Promise<boolean> {
  try {
    if (!input.fundoId) throw new Error('Fundo da operacao indisponivel apos o desembolso.')
    const risco = await executarGateRisco({
      fundoId: input.fundoId,
      atorUsuarioId: input.atorUsuarioId,
      dataOperacional: input.dataOperacional,
      origem: 'CENTRAL_RISCO',
    })
    if (risco.classification.technicalStatus === 'CONCLUIDA' || risco.classification.technicalStatus === 'NAO_APLICAVEL') return true

    console.error('[desembolsarOperacao][atualizar_risco]', {
      operacao_id: input.operacaoId,
      fundo_id: input.fundoId,
      status_tecnico: risco.classification.technicalStatus,
      correlation_id: risco.correlationId,
    })
  } catch (error) {
    console.error('[desembolsarOperacao][atualizar_risco]', {
      operacao_id: input.operacaoId,
      fundo_id: input.fundoId,
      erro: error instanceof Error ? error.message : 'Falha desconhecida.',
    })
  }
  return false
}
