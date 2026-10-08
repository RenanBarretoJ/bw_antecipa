import 'server-only'

import { AuthorizationError, type AppSupabaseClient, type AuthContext } from '@/lib/auth/authorization'
import {
  obterCedenteFundoAtivoSelecionado,
  resolverCedenteFundoAtivo,
} from '@/lib/fundos/cedente-fundo'
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

/**
 * Resolve o mesmo contexto Cedente/Fundo para superficies estritamente de
 * leitura do C5. O predicado organizacional inclui LEITOR, mas as mutations
 * continuam usando resolverContextoOperacionalNotaFiscal.
 */
export async function resolverContextoLeituraNotaFiscal(
  auth: AuthContext,
  cedenteIdInformado?: string | null,
): Promise<ContextoOperacionalNotaFiscal> {
  if (auth.profile.role !== 'consultor' || !cedenteIdInformado) {
    throw new AuthorizationError('Cedente visivel nao informado ou perfil sem permissao.', 'FORBIDDEN')
  }

  const { data: permitido, error: permissaoError } = await auth.supabase.rpc(
    'consultor_pode_visualizar_cedente',
    { p_cedente_id: cedenteIdInformado },
  )
  if (permissaoError || permitido !== true) {
    throw new AuthorizationError('Cedente nao disponivel para este Consultor.', 'FORBIDDEN')
  }

  const { data: cedente, error: cedenteError } = await auth.supabase
    .from('cedentes')
    .select('id, cnpj, razao_social, nome_fantasia, status')
    .eq('id', cedenteIdInformado)
    .eq('status', 'ativo')
    .maybeSingle()
  if (cedenteError || !cedente) {
    throw new AuthorizationError('Cedente nao encontrado.', 'NOT_FOUND')
  }

  const { data: links, error: linksError } = await auth.supabase
    .from('cedente_fundos')
    .select('id, fundo_id, vigente_desde')
    .eq('cedente_id', cedente.id)
    .eq('status', 'ativo')
    .order('vigente_desde', { ascending: false })
  if (linksError || !links?.length) {
    throw new AuthorizationError('O Cedente nao possui fundo visivel ativo.', 'FORBIDDEN')
  }

  const selecionadoId = links.length > 1 ? await obterCedenteFundoAtivoSelecionado() : null
  const link = selecionadoId
    ? links.find((item) => item.id === selecionadoId)
    : links.length === 1 ? links[0] : null
  if (!link) {
    throw new AuthorizationError('Selecione explicitamente o fundo para consultar este Cedente.', 'FORBIDDEN')
  }

  const { data: fundo, error: fundoError } = await auth.supabase
    .from('fundos')
    .select('id, ativo')
    .eq('id', link.fundo_id)
    .eq('ativo', true)
    .maybeSingle()
  if (fundoError || !fundo) {
    throw new AuthorizationError('O fundo visivel nao esta ativo.', 'FORBIDDEN')
  }

  return {
    actorUserId: auth.user.id,
    actorRole: 'consultor',
    cedente,
    cedenteFundoId: link.id,
    fundoId: fundo.id,
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
