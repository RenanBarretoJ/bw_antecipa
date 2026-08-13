import type { AdminTechnicalActionResult } from '@/lib/admin/configuracoes-tecnicas'

const UNEXPECTED_ERROR_MESSAGE = 'Nao foi possivel concluir a configuracao tecnica. Tente novamente.'

export async function executarMutacaoTecnica(
  mutation: () => Promise<AdminTechnicalActionResult>,
): Promise<AdminTechnicalActionResult> {
  try {
    return await mutation()
  } catch {
    return {
      success: false,
      message: UNEXPECTED_ERROR_MESSAGE,
      notification: {
        type: 'error',
        message: UNEXPECTED_ERROR_MESSAGE,
        details: 'A solicitacao nao foi concluida. Verifique sua conexao e tente novamente.',
      },
    }
  }
}
