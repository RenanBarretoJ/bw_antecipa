'use server'

import { randomUUID } from 'node:crypto'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import { AuthorizationError } from '@/lib/auth/authorization'
import { registrarEventoSeguranca } from '@/lib/auth/mfa'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'
import { vortxCredencialSchema, vortxTesteConexaoSchema, type VortxActionResult, type VortxConfiguracaoStatus } from '@/lib/admin/vortx-vrs'
import { resolverConfiguracaoVortxVrs } from '@/lib/integracoes/vortx/credenciais.server'
import { validarParMtls, VortxCredencialValidacaoError } from '@/lib/integracoes/vortx/mtls-credencial-validacao'
import { autenticarVortxVrs } from '@/lib/integracoes/vortx/vortx-vrs-client.server'
import { criptografarPortalFidcValor, diagnosticarKeyringPortalFidc, type PortalFidcKeyringDiagnostico } from '@/lib/portal-fidc/credenciais'

type RpcError = { code?: string; message?: string }
type CategorizedError = { categoria?: string; message?: string }

function respostaErro(message: string): VortxActionResult {
  return { success: false, message }
}

/**
 * Etapas nomeadas do salvamento da credencial Vortx VRS -- cada uma vira um
 * codigo tecnico logado server-side (nunca exposto ao browser) quando algo
 * inesperado ocorre nela, para nunca mais depender so do toast generico
 * para diagnosticar (P0_Claude_Corrigir_Salvamento_Credencial_Vortx_VRS2).
 */
type EtapaSalvamento = 'totp' | 'encriptacao'

class EtapaSalvamentoError extends Error {
  readonly etapa: EtapaSalvamento
  readonly codigo: string

  constructor(etapa: EtapaSalvamento, codigo: string, message: string) {
    super(message)
    this.name = 'EtapaSalvamentoError'
    this.etapa = etapa
    this.codigo = codigo
  }
}

function mapearErro(error: unknown, correlationId: string): VortxActionResult {
  if (error instanceof VortxCredencialValidacaoError) {
    console.error('[admin/vortx-vrs][credencial]', { correlationId, codigo: error.codigo })
    return respostaErro(error.message)
  }
  if (error instanceof EtapaSalvamentoError) {
    console.error('[admin/vortx-vrs][credencial]', { correlationId, etapa: error.etapa, codigo: error.codigo })
    if (error.codigo === 'VORTX_CREDENTIAL_ENCRYPTION_ERROR') {
      return respostaErro('Nao foi possivel proteger a credencial Vortx VRS para salvamento. Tente novamente.')
    }
    if (error.codigo === 'VORTX_CREDENTIAL_TOTP_ERROR') {
      return respostaErro('Nao foi possivel confirmar a autorizacao TOTP para esta acao.')
    }
  }
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
  console.error('[admin/vortx-vrs]', { correlationId, code: value?.code, categoria: value?.categoria, codigo: 'VORTX_CREDENTIAL_UNEXPECTED_ERROR' })
  return respostaErro('Nao foi possivel concluir a operacao com a Vortx VRS.')
}

export async function configurarCredencialVortxVrsAdmin(input: unknown): Promise<VortxActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = vortxCredencialSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Revise os dados da credencial Vortx VRS.')

    // Valida o par certificado/chave privada ANTES de qualquer criptografia
    // ou chamada de rede -- usa APIs criptograficas do Node (X509Certificate/
    // createPrivateKey/checkPrivateKey), nunca comparacao textual.
    validarParMtls(parsed.data.certificadoPem, parsed.data.chavePrivadaPem)

    const context = await requireSuperAdmin()

    try {
      await autorizarEConsumirAcaoSensivel(context, 'configurar_credencial_vortx_vrs', parsed.data.mfaCode)
    } catch (error) {
      if (error instanceof AuthorizationError) throw error
      throw new EtapaSalvamentoError('totp', 'VORTX_CREDENTIAL_TOTP_ERROR', 'Falha inesperada na confirmacao TOTP.')
    }

    let key: ReturnType<typeof criptografarPortalFidcValor>
    let secret: ReturnType<typeof criptografarPortalFidcValor>
    let certificado: ReturnType<typeof criptografarPortalFidcValor>
    let chavePrivada: ReturnType<typeof criptografarPortalFidcValor>
    try {
      key = criptografarPortalFidcValor(parsed.data.key)
      secret = criptografarPortalFidcValor(parsed.data.secret)
      certificado = criptografarPortalFidcValor(parsed.data.certificadoPem)
      chavePrivada = criptografarPortalFidcValor(parsed.data.chavePrivadaPem)
      if (
        key.chaveVersao !== secret.chaveVersao
        || key.chaveVersao !== certificado.chaveVersao
        || key.chaveVersao !== chavePrivada.chaveVersao
      ) {
        throw new Error('Versao criptografica inconsistente entre os segredos.')
      }
    } catch (error) {
      throw new EtapaSalvamentoError(
        'encriptacao',
        'VORTX_CREDENTIAL_ENCRYPTION_ERROR',
        error instanceof Error ? error.message : 'Falha inesperada ao criptografar a credencial.',
      )
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
    if (error) {
      console.error('[admin/vortx-vrs][credencial]', { correlationId, etapa: 'rpc', codigo: 'VORTX_CREDENTIAL_RPC_ERROR', pgCode: error.code })
      return mapearErro(error, correlationId)
    }
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

export type VortxKeyringDiagnostico = PortalFidcKeyringDiagnostico & { environment: string }

/**
 * TEMPORARIO (P0_Claude_Validar_Keyring_Runtime_Vercel_Homolog): valida, no
 * runtime real onde esta rodando, se o keyring de criptografia usado por
 * criptografarPortalFidcValor esta configurado corretamente -- sem nunca
 * expor a chave, o JSON do keyring ou qualquer segredo. So metadados
 * booleanos/nome de versao. Remover assim que a causa raiz da falha de
 * salvamento da credencial Vortx VRS estiver confirmada e corrigida.
 */
export async function diagnosticarKeyringVortxVrsAdmin(): Promise<VortxKeyringDiagnostico> {
  await requireSuperAdmin()
  return {
    ...diagnosticarKeyringPortalFidc(),
    environment: process.env.NEXT_PUBLIC_APP_ENV || 'desconhecido',
  }
}
