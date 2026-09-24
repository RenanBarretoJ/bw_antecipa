import 'server-only'

import { AuthorizationError, type AppSupabaseClient, type AuthContext } from '@/lib/auth/authorization'
import { resolverCedenteFundoAtivo } from '@/lib/fundos/cedente-fundo'
import { resolverCedenteSolicitanteOperacao } from '@/lib/operacoes/solicitante.server'

export type ContextoOperacionalNotaFiscal = {
  actorUserId: string
  actorRole: 'cedente' | 'consultor'
  cedente: {
    id: string
    cnpj: string
    razao_social: string
    nome_fantasia: string | null
    status: string
  }
  cedenteFundoId: string
  fundoId: string
}

/**
 * Resolve o contexto de NF pela mesma fronteira de autorizacao operacional do
 * C2. O identificador vindo da UI nunca e aceito como prova de acesso.
 */
export async function resolverContextoOperacionalNotaFiscal(
  auth: AuthContext,
  cedenteIdInformado?: string | null,
): Promise<ContextoOperacionalNotaFiscal> {
  const solicitante = await resolverCedenteSolicitanteOperacao(auth, cedenteIdInformado)
  const contextoFundo = await resolverCedenteFundoAtivo(solicitante.cedente.id, auth.supabase)

  if (!contextoFundo.cedenteFundo || !contextoFundo.fundo) {
    throw new AuthorizationError('O Cedente nao possui fundo operacional ativo.', 'FORBIDDEN')
  }

  return {
    actorUserId: auth.user.id,
    actorRole: solicitante.perfil,
    cedente: solicitante.cedente,
    cedenteFundoId: contextoFundo.cedenteFundo.id,
    fundoId: contextoFundo.fundo.id,
  }
}

export async function validarNotaNoContextoSelecionado(
  supabase: AppSupabaseClient,
  notaFiscalId: string,
  contexto: ContextoOperacionalNotaFiscal,
) {
  const { data, error } = await supabase
    .from('notas_fiscais')
    .select('id, cedente_id, cedente_fundo_id, fundo_id')
    .eq('id', notaFiscalId)
    .eq('cedente_id', contexto.cedente.id)
    .eq('cedente_fundo_id', contexto.cedenteFundoId)
    .eq('fundo_id', contexto.fundoId)
    .maybeSingle()

  if (error || !data) {
    throw new AuthorizationError('Nota fiscal fora do contexto selecionado.', 'FORBIDDEN')
  }

  return data
}
