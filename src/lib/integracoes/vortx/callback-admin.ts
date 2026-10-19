import { z } from 'zod'

export const callbackActionSchema = z.object({ fundoId: z.uuid(), versaoId: z.uuid(),
  acao: z.enum(['gerar', 'rotacionar', 'revogar', 'informar_cadastro']), revisao: z.number().int().nonnegative(),
  mfaCode: z.string().regex(/^\d{6}$/),
}).strict()
export type CallbackAcao = z.infer<typeof callbackActionSchema>['acao']
export const callbackStatusSchema = z.object({ id: z.uuid().nullable(), revisao: z.number().int().nonnegative(), ativo: z.boolean(),
  carteira: z.string().min(1), ambiente: z.enum(['producao', 'homologacao']), geradaEm: z.string().nullable(),
  cadastroInformadoEm: z.string().nullable(), ultimoEventoEm: z.string().nullable(),
})
export type CallbackStatus = z.infer<typeof callbackStatusSchema>
export type CallbackAdminResult = { success: false; message: string } | { success: true; message: string;
  status: CallbackStatus; habilitado: boolean; bloqueio: string | null; urlUnica?: string }

export function situacaoCallback(status: CallbackStatus) {
  if (!status.id) return 'URL não gerada'
  if (!status.ativo) return 'Recebimento revogado'
  if (status.ultimoEventoEm) return 'Evento recebido'
  if (status.cadastroInformadoEm) return 'Aguardando primeiro evento'
  return 'Aguardando cadastro na Vórtx'
}
