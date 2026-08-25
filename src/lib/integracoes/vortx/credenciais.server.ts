import 'server-only'

import { registrarEventoSeguranca } from '@/lib/auth/mfa'
import { descriptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'
import { createAdminClient } from '@/lib/supabase/server'
import type { VortxAmbiente } from './token-cache.server'

type AdminClient = ReturnType<typeof createAdminClient>

export type VortxVrsConfig = {
  fundoId: string
  ambiente: VortxAmbiente
  baseUrl: string
  key: string
  secret: string
  credential: { certificadoPem: string; chavePrivadaPem: string }
}

/**
 * Resolve e descriptografa a credencial Vortx VRS ativa de um fundo/ambiente.
 * Le diretamente com service_role (RLS nega tudo para authenticated nesta
 * tabela) -- mesmo padrao ja usado em
 * integracoes/credentials.server.ts#resolverCredencialIntegracaoSegura. O
 * valor decifrado nunca deve ser logado, retornado a Server Actions ou
 * enviado ao navegador.
 */
export async function resolverConfiguracaoVortxVrs(
  fundoId: string,
  ambiente: VortxAmbiente,
  admin: AdminClient = createAdminClient(),
): Promise<VortxVrsConfig> {
  const { data, error } = await admin
    .from('integracoes_vortx_vrs_credenciais')
    .select('base_url,key_criptografada,secret_criptografada,certificado_criptografado,chave_privada_criptografada,chave_versao')
    .eq('fundo_id', fundoId)
    .eq('ambiente', ambiente)
    .eq('status', 'ativa')
    .maybeSingle()

  if (error) throw new Error(`Nao foi possivel resolver a credencial Vortx VRS: ${error.message}`)
  if (!data) {
    await registrarEventoSeguranca({
      tipo_evento: 'ACESSO_CREDENCIAL_NEGADO',
      ator_tipo: 'integracao',
      severidade: 'critical',
      entidade_tipo: 'integracoes_vortx_vrs_credenciais',
      dados: { fundo_id: fundoId, ambiente },
    })
    throw Object.assign(
      new Error('Nao ha credencial Vortx VRS ativa para este fundo e ambiente.'),
      { categoria: 'autenticacao' },
    )
  }

  return {
    fundoId,
    ambiente,
    baseUrl: data.base_url,
    key: descriptografarPortalFidcValor(data.key_criptografada, data.chave_versao),
    secret: descriptografarPortalFidcValor(data.secret_criptografada, data.chave_versao),
    credential: {
      certificadoPem: descriptografarPortalFidcValor(data.certificado_criptografado, data.chave_versao),
      chavePrivadaPem: descriptografarPortalFidcValor(data.chave_privada_criptografada, data.chave_versao),
    },
  }
}
