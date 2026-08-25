'use server'

import { randomUUID } from 'node:crypto'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import { AuthorizationError } from '@/lib/auth/authorization'
import { registrarEventoSeguranca } from '@/lib/auth/mfa'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'
import { vortxCredencialSchema, vortxTesteConexaoSchema, type VortxActionResult, type VortxConfiguracaoStatus } from '@/lib/admin/vortx-vrs'
import { resolverConfiguracaoVortxVrs } from '@/lib/integracoes/vortx/credenciais.server'
import { autenticarVortxVrs } from '@/lib/integracoes/vortx/vortx-vrs-client.server'
import { criptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'

type RpcError = { code?: string; message?: string }
type CategorizedError = { categoria?: string; message?: string }

function respostaErro(message: string): VortxActionResult {
  return { success: false, message }
}

function mapearErro(error: unknown, correlationId: string): VortxActionResult {
  if (error instanceof AuthorizationError) return respostaErro(error.message)
  const value = error as RpcError & CategorizedError
  if (value?.code === '42501') return respostaErro('Acesso restrito ao Super Admin.')
  if (value?.code === 'P0002') return respostaErro('Fundo nao encontrado.')
  if (value?.code === '22023') return respostaErro(value.message || 'Dados invalidos.')
  if (value?.categoria === 'autenticacao') return respostaErro('Credenciais Vortx VRS invalidas ou nao configuradas.')
  if (value?.categoria === 'timeout') return respostaErro('Tempo limite excedido ao conectar com a Vortx VRS.')
  if (value?.categoria === 'conexao') return respostaErro('Nao foi possivel conectar com a Vortx VRS.')
  if (value?.categoria === 'resposta_inesperada' || value?.categoria === 'resposta_invalida') {
    return respostaErro('A Vortx VRS retornou uma resposta inesperada.')
  }
  console.error('[admin/vortx-vrs]', { correlationId, code: value?.code, categoria: value?.categoria })
  return respostaErro('Nao foi possivel concluir a operacao com a Vortx VRS.')
}

export async function configurarCredencialVortxVrsAdmin(input: unknown): Promise<VortxActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = vortxCredencialSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Revise os dados da credencial Vortx VRS.')
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'configurar_credencial_vortx_vrs', parsed.data.mfaCode)

    const key = criptografarPortalFidcValor(parsed.data.key)
    const secret = criptografarPortalFidcValor(parsed.data.secret)
    const certificado = criptografarPortalFidcValor(parsed.data.certificadoPem)
    const chavePrivada = criptografarPortalFidcValor(parsed.data.chavePrivadaPem)
    if (
      key.chaveVersao !== secret.chaveVersao
      || key.chaveVersao !== certificado.chaveVersao
      || key.chaveVersao !== chavePrivada.chaveVersao
    ) {
      throw new Error('Versao criptografica inconsistente.')
    }

    const { data, error } = await context.supabase.rpc('admin_configurar_credencial_vortx_vrs', {
      p_fundo_id: parsed.data.fundoId,
      p_ambiente: parsed.data.ambiente,
      p_base_url: parsed.data.baseUrl,
      p_key_criptografada: key.ciphertext,
      p_secret_criptografada: secret.ciphertext,
      p_certificado_criptografado: certificado.ciphertext,
      p_chave_privada_criptografada: chavePrivada.ciphertext,
      p_chave_versao: key.chaveVersao,
      p_correlation_id: correlationId,
    })
    if (error) return mapearErro(error, correlationId)
    const resultId = (data as { id?: string } | null)?.id
    return { success: true, message: 'Credencial Vortx VRS configurada.', data: { id: resultId, ambiente: parsed.data.ambiente } }
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function obterConfiguracaoVortxVrsAdmin(fundoId: string): Promise<VortxConfiguracaoStatus[]> {
  const context = await requireSuperAdmin()
  const { data, error } = await context.supabase.rpc('admin_obter_configuracao_vortx_vrs', { p_fundo_id: fundoId })
  if (error || !data) throw new Error('Nao foi possivel carregar a configuracao Vortx VRS.')
  return data as VortxConfiguracaoStatus[]
}

export async function testarConexaoVortxVrsAdmin(input: unknown): Promise<VortxActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = vortxTesteConexaoSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Revise o fundo e o ambiente informados.')
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'testar_conexao_vortx_vrs', parsed.data.mfaCode)

    const config = await resolverConfiguracaoVortxVrs(parsed.data.fundoId, parsed.data.ambiente)
    const login = await autenticarVortxVrs(config)
    const expiraEm = new Date(Date.parse(login.created) + login.expiresIn * 1000).toISOString()

    await registrarEventoSeguranca({
      tipo_evento: 'CREDENCIAL_TESTADA',
      ator_usuario_id: context.user.id,
      severidade: 'info',
      entidade_tipo: 'integracoes_vortx_vrs_credenciais',
      dados: { fundo_id: parsed.data.fundoId, ambiente: parsed.data.ambiente },
      correlation_id: correlationId,
    })

    return {
      success: true,
      message: 'Autenticacao Vortx VRS confirmada.',
      data: { ambiente: parsed.data.ambiente, expiraEm },
    }
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}
