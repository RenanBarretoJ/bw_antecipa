import 'server-only'

import { registrarEventoSeguranca } from '@/lib/auth/mfa'
import { descriptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'
import { createAdminClient } from '@/lib/supabase/server'
import type { ResolvedIntegrationVersion } from './resolver.server'

type AdminClient = ReturnType<typeof createAdminClient>

export type ResolvedIntegrationCredential = {
  username: string
  password: string
  credentialId: string
}

export async function resolverCredencialIntegracaoSegura(
  integration: Pick<
    ResolvedIntegrationVersion,
    'fundoId' | 'integrationId' | 'integrationVersionId' | 'environment' | 'credentialId'
  >,
  admin: AdminClient = createAdminClient(),
): Promise<ResolvedIntegrationCredential> {
  if (!integration.credentialId) {
    throw Object.assign(new Error('A versao publicada da integracao nao possui credencial vinculada.'), {
      categoria: 'autenticacao',
    })
  }

  const { data, error } = await admin
    .from('credenciais_integracao')
    .select('id,fundo_id,integracao_fundo_id,ambiente,status,usuario_criptografado,senha_criptografada,chave_versao')
    .eq('id', integration.credentialId)
    .eq('fundo_id', integration.fundoId)
    .eq('integracao_fundo_id', integration.integrationId)
    .eq('ambiente', integration.environment)
    .eq('status', 'ativa')
    .maybeSingle()

  if (error) throw new Error(`Nao foi possivel resolver a credencial da integracao: ${error.message}`)
  if (!data) {
    await registrarEventoSeguranca({
      tipo_evento: 'ACESSO_CREDENCIAL_NEGADO',
      ator_tipo: 'integracao',
      severidade: 'critical',
      entidade_tipo: 'integracao_fundo_versoes',
      entidade_id: integration.integrationVersionId,
      dados: {
        fundo_id: integration.fundoId,
        integracao_fundo_id: integration.integrationId,
        ambiente: integration.environment,
      },
    })
    throw Object.assign(new Error('A credencial vinculada esta ausente, inativa, revogada ou pertence a outro contexto.'), {
      categoria: 'autenticacao',
    })
  }

  const username = descriptografarPortalFidcValor(data.usuario_criptografado, data.chave_versao)
  const password = descriptografarPortalFidcValor(data.senha_criptografada, data.chave_versao)
  await admin.from('credenciais_integracao').update({ ultimo_uso_em: new Date().toISOString() }).eq('id', data.id)
  await registrarEventoSeguranca({
    tipo_evento: 'CREDENCIAL_USADA',
    ator_tipo: 'integracao',
    severidade: 'info',
    entidade_tipo: 'credenciais_integracao',
    entidade_id: data.id,
    dados: {
      fundo_id: integration.fundoId,
      integracao_fundo_id: integration.integrationId,
      ambiente: integration.environment,
      versao_id: integration.integrationVersionId,
    },
  })
  return { username, password, credentialId: data.id }
}
