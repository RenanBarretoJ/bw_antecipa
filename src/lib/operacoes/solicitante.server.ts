import 'server-only'

import { AuthorizationError, assertRole, type AuthContext } from '@/lib/auth/authorization'

export type PerfilSolicitanteOperacao = 'cedente' | 'consultor'

export type CedenteSolicitanteOperacao = {
  id: string
  cnpj: string
  razao_social: string
  nome_fantasia: string | null
  status: string
}

function uuidValido(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value))
}

/**
 * Resolve o Cedente da nova operacao exclusivamente a partir da sessao.
 * O identificador recebido do browser e apenas uma referencia: para o
 * Consultor, o vinculo ativo e revalidado no banco em toda chamada.
 */
export async function resolverCedenteSolicitanteOperacao(
  auth: AuthContext,
  cedenteIdInformado?: string | null,
): Promise<{ perfil: PerfilSolicitanteOperacao; cedente: CedenteSolicitanteOperacao }> {
  assertRole(auth.profile.role, ['cedente', 'consultor'])
  const perfil: PerfilSolicitanteOperacao = auth.profile.role === 'consultor' ? 'consultor' : 'cedente'

  let cedenteId: string | null = null
  if (perfil === 'cedente') {
    const { data, error } = await auth.supabase.rpc('get_user_cedente_id')
    if (error) throw new Error(`Nao foi possivel resolver o cedente autenticado: ${error.message}`)
    cedenteId = data ? String(data) : null
    if (cedenteIdInformado && cedenteIdInformado !== cedenteId) {
      throw new AuthorizationError('O Cedente informado nao pertence a sessao autenticada.', 'FORBIDDEN')
    }
  } else {
    if (!uuidValido(cedenteIdInformado)) {
      throw new AuthorizationError('Selecione um Cedente ativo da sua carteira.', 'FORBIDDEN')
    }

    const { data: permitido, error: vinculoError } = await auth.supabase.rpc('consultor_pode_operar_cedente', {
      p_cedente_id: cedenteIdInformado,
    })
    if (vinculoError) throw new Error(`Nao foi possivel validar o vinculo com o Cedente: ${vinculoError.message}`)
    if (permitido !== true) throw new AuthorizationError('O Cedente selecionado nao esta disponivel para esta Consultoria.', 'FORBIDDEN')
    cedenteId = cedenteIdInformado
  }

  if (!cedenteId) throw new AuthorizationError('Cadastro de Cedente nao encontrado.', 'NOT_FOUND')
  const { data: cedente, error: cedenteError } = await auth.supabase
    .from('cedentes')
    .select('id, cnpj, razao_social, nome_fantasia, status')
    .eq('id', cedenteId)
    .maybeSingle()
  if (cedenteError) throw new Error(`Nao foi possivel consultar o Cedente: ${cedenteError.message}`)
  if (!cedente || cedente.status !== 'ativo') {
    throw new AuthorizationError('O cadastro do Cedente precisa estar aprovado e ativo.', 'FORBIDDEN')
  }

  return {
    perfil,
    cedente: cedente as CedenteSolicitanteOperacao,
  }
}
