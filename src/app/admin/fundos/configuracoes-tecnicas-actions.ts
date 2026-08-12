'use server'

import { createHash, randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { requireSuperAdmin } from '@/lib/auth/admin-authorization'
import { AuthorizationError } from '@/lib/auth/authorization'
import { autorizarEConsumirAcaoSensivel } from '@/lib/auth/sensitive-action'
import {
  adminCnabRascunhoSchema,
  adminCredencialSchema,
  adminIntegracaoRascunhoSchema,
  adminTechnicalConfirmationSchema,
  mascararIdentificador,
  type AdminTechnicalActionResult,
} from '@/lib/admin/configuracoes-tecnicas'
import { validarEndpointTecnicoSeguro } from '@/lib/admin/endpoint-seguro.server'
import {
  criptografarPortalFidcValor,
  descriptografarPortalFidcValor,
} from '@/lib/portal-fidc/credenciais'

type RpcError = { code?: string; message?: string }
type RpcResult = Promise<{ data: unknown; error: RpcError | null }>

function callAdminRpc(client: { rpc: unknown }, name: string, args: Record<string, unknown>): RpcResult {
  return (client.rpc as (rpcName: string, rpcArgs: Record<string, unknown>) => RpcResult)(name, args)
}

function respostaErro(message: string, correlationId?: string): AdminTechnicalActionResult {
  return {
    success: false,
    message,
    notification: {
      type: 'error',
      message,
      details: correlationId ? `Referencia: ${correlationId}` : undefined,
    },
  }
}

function mapearErro(error: unknown, correlationId: string): AdminTechnicalActionResult {
  if (error instanceof AuthorizationError) return respostaErro(error.message, correlationId)
  const value = error as RpcError
  if (value?.code === '42501') return respostaErro('Acesso restrito ao Super Admin.', correlationId)
  if (value?.code === 'P0002') return respostaErro('Configuracao tecnica nao encontrada neste fundo.', correlationId)
  if (value?.code === '40001') return respostaErro('A configuracao foi alterada em outra sessao. Recarregue e tente novamente.', correlationId)
  if (value?.code === '23505') return respostaErro('Ja existe uma configuracao ativa equivalente.', correlationId)
  if (value?.code === '23514' || value?.code === '22023') return respostaErro(value.message || 'A configuracao informada e invalida.', correlationId)
  console.error('[admin/sa3]', { correlationId, code: value?.code || 'unexpected' })
  return respostaErro('Nao foi possivel concluir a configuracao tecnica.', correlationId)
}

function sucesso(message: string, id: string): AdminTechnicalActionResult {
  return { success: true, message, data: { id }, notification: { type: 'success', message } }
}

function atualizarTela(fundoId: string) {
  revalidatePath(`/admin/fundos/${fundoId}`)
}

export async function cadastrarCredencialAdmin(input: unknown): Promise<AdminTechnicalActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = adminCredencialSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Revise os dados da credencial.', correlationId)
    const context = await requireSuperAdmin()
    const actionType = parsed.data.credencialAnteriorId ? 'rotacionar_credencial_integracao' : 'cadastrar_credencial_integracao'
    await autorizarEConsumirAcaoSensivel(context, actionType, parsed.data.mfaCode)

    const usuario = criptografarPortalFidcValor(parsed.data.usuario)
    const senha = criptografarPortalFidcValor(parsed.data.senha)
    if (usuario.chaveVersao !== senha.chaveVersao) throw new Error('Versao criptografica inconsistente.')

    const { data, error } = await callAdminRpc(context.supabase, 'admin_cadastrar_credencial_integracao', {
      p_fundo_id: parsed.data.fundoId,
      p_ambiente: parsed.data.ambiente,
      p_nome: parsed.data.nome,
      p_usuario_criptografado: usuario.ciphertext,
      p_senha_criptografada: senha.ciphertext,
      p_chave_versao: usuario.chaveVersao,
      p_usuario_mascarado: mascararIdentificador(parsed.data.usuario),
      p_credencial_anterior_id: parsed.data.credencialAnteriorId || null,
      p_correlation_id: correlationId,
    })
    if (error) return mapearErro(error, correlationId)
    const result = data as unknown as { id: string }
    atualizarTela(parsed.data.fundoId)
    return sucesso(parsed.data.credencialAnteriorId ? 'Nova credencial de rotacao cadastrada.' : 'Credencial cadastrada.', result.id)
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function ativarCredencialAdmin(input: unknown): Promise<AdminTechnicalActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = adminTechnicalConfirmationSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Confirmacao invalida.', correlationId)
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'ativar_credencial_integracao', parsed.data.mfaCode)
    const { error } = await callAdminRpc(context.supabase, 'admin_ativar_credencial_integracao', {
      p_fundo_id: parsed.data.fundoId,
      p_credencial_id: parsed.data.id,
      p_correlation_id: correlationId,
    })
    if (error) return mapearErro(error, correlationId)
    atualizarTela(parsed.data.fundoId)
    return sucesso('Credencial ativada.', parsed.data.id)
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function revogarCredencialAdmin(input: unknown): Promise<AdminTechnicalActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = adminTechnicalConfirmationSchema.safeParse(input)
    if (!parsed.success || !parsed.data.motivo || parsed.data.motivo.length < 10) return respostaErro('Informe um motivo com pelo menos 10 caracteres.', correlationId)
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'revogar_credencial_integracao', parsed.data.mfaCode)
    const { data, error } = await callAdminRpc(context.supabase, 'admin_revogar_credencial_integracao', {
      p_fundo_id: parsed.data.fundoId,
      p_credencial_id: parsed.data.id,
      p_motivo: parsed.data.motivo,
      p_correlation_id: correlationId,
    })
    if (error) return mapearErro(error, correlationId)
    const result = data as unknown as { impacta_versao_publicada?: boolean }
    atualizarTela(parsed.data.fundoId)
    return {
      ...sucesso('Credencial revogada.', parsed.data.id),
      notification: result.impacta_versao_publicada
        ? { type: 'warning', message: 'Credencial revogada. A integracao publicada ficou indisponivel.' }
        : { type: 'success', message: 'Credencial revogada.' },
    }
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function salvarIntegracaoRascunhoAdmin(input: unknown): Promise<AdminTechnicalActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = adminIntegracaoRascunhoSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Revise a configuracao da integracao.', correlationId)
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'criar_integracao_versao', parsed.data.mfaCode)
    const endpoint = await validarEndpointTecnicoSeguro(parsed.data.endpointBase)
    const { data, error } = await callAdminRpc(context.supabase, 'admin_salvar_integracao_rascunho', {
      p_fundo_id: parsed.data.fundoId,
      p_versao_id: parsed.data.versaoId || null,
      p_ambiente: parsed.data.ambiente,
      p_endpoint_base: endpoint,
      p_identificador_cliente: parsed.data.identificadorCliente,
      p_credencial_integracao_id: parsed.data.credencialIntegracaoId,
      p_configuracao_nao_sensivel: parsed.data.configuracaoNaoSensivel,
      p_updated_at_esperado: parsed.data.updatedAtEsperado || null,
      p_correlation_id: correlationId,
    })
    if (error) return mapearErro(error, correlationId)
    const result = data as unknown as { id: string }
    atualizarTela(parsed.data.fundoId)
    return sucesso('Rascunho da integracao salvo.', result.id)
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

async function executarAcaoVersaoIntegracao(input: unknown, acao: 'publicar' | 'desativar') {
  const correlationId = randomUUID()
  try {
    const parsed = adminTechnicalConfirmationSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Confirmacao invalida.', correlationId)
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, acao === 'publicar' ? 'publicar_integracao' : 'desativar_integracao', parsed.data.mfaCode)
    const rpc = acao === 'publicar' ? 'admin_publicar_integracao_versao' : 'admin_desativar_integracao_versao'
    const { error } = await callAdminRpc(context.supabase, rpc, {
      p_fundo_id: parsed.data.fundoId,
      p_versao_id: parsed.data.id,
      p_correlation_id: correlationId,
    })
    if (error) return mapearErro(error, correlationId)
    atualizarTela(parsed.data.fundoId)
    return sucesso(acao === 'publicar' ? 'Versao da integracao publicada.' : 'Versao da integracao desativada.', parsed.data.id)
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function publicarIntegracaoAdmin(input: unknown) {
  return executarAcaoVersaoIntegracao(input, 'publicar')
}

export async function desativarIntegracaoAdmin(input: unknown) {
  return executarAcaoVersaoIntegracao(input, 'desativar')
}

export async function testarIntegracaoAdmin(input: unknown): Promise<AdminTechnicalActionResult> {
  const correlationId = randomUUID()
  let context: Awaited<ReturnType<typeof requireSuperAdmin>> | null = null
  let execucaoId: string | null = null
  const inicio = Date.now()
  try {
    const parsed = adminTechnicalConfirmationSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Confirmacao invalida.', correlationId)
    context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'testar_integracao', parsed.data.mfaCode)
    const { data, error } = await callAdminRpc(context.supabase, 'admin_preparar_teste_integracao', {
      p_fundo_id: parsed.data.fundoId,
      p_versao_id: parsed.data.id,
      p_correlation_id: correlationId,
    })
    if (error || !data) return mapearErro(error || new Error('Teste nao preparado.'), correlationId)
    const prepared = data as unknown as {
      execucao_id: string
      endpoint_base: string
      usuario_criptografado: string
      senha_criptografada: string
      chave_versao: string
    }
    execucaoId = prepared.execucao_id
    const endpoint = await validarEndpointTecnicoSeguro(prepared.endpoint_base)
    const username = descriptografarPortalFidcValor(prepared.usuario_criptografado, prepared.chave_versao)
    const password = descriptografarPortalFidcValor(prepared.senha_criptografada, prepared.chave_versao)
    const response = await fetch(endpoint, {
      method: 'GET',
      headers: { username, password },
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
    })
    const ok = response.status < 500 && response.status !== 401 && response.status !== 403
    const { error: finishError } = await callAdminRpc(context.supabase, 'admin_finalizar_teste_integracao', {
      p_fundo_id: parsed.data.fundoId,
      p_execucao_id: execucaoId,
      p_status: ok ? 'sucesso' : 'erro',
      p_codigo_resposta: String(response.status),
      p_mensagem_resumida: `Teste tecnico HTTP ${response.status}.`,
      p_erro_categoria: ok ? '' : response.status === 401 || response.status === 403 ? 'autenticacao' : 'resposta_inesperada',
      p_duracao_ms: Date.now() - inicio,
      p_correlation_id: correlationId,
    })
    if (finishError) return mapearErro(finishError, correlationId)
    atualizarTela(parsed.data.fundoId)
    return ok ? sucesso('Teste tecnico concluido com sucesso.', execucaoId) : respostaErro(`O endpoint respondeu HTTP ${response.status}.`, correlationId)
  } catch (error) {
    if (context && execucaoId) {
      const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      await callAdminRpc(context.supabase, 'admin_finalizar_teste_integracao', {
        p_fundo_id: (input as { fundoId?: string })?.fundoId || '',
        p_execucao_id: execucaoId,
        p_status: timeout ? 'timeout' : 'erro',
        p_codigo_resposta: '',
        p_mensagem_resumida: timeout ? 'Tempo limite excedido no teste tecnico.' : 'Falha sanitizada no teste tecnico.',
        p_erro_categoria: timeout ? 'timeout' : 'configuracao',
        p_duracao_ms: Date.now() - inicio,
        p_correlation_id: correlationId,
      })
    }
    return mapearErro(error, correlationId)
  }
}

export async function salvarCnabRascunhoAdmin(input: unknown): Promise<AdminTechnicalActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = adminCnabRascunhoSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Revise os parametros CNAB.', correlationId)
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'atualizar_codigo_originador', parsed.data.mfaCode)
    const conteudoHash = createHash('sha256').update(JSON.stringify({
      layout: parsed.data.layout,
      versaoLayout: parsed.data.versaoLayout,
      codigoBanco: parsed.data.codigoBanco,
      banco: parsed.data.banco,
      agencia: parsed.data.agencia,
      conta: parsed.data.conta,
      digitoConta: parsed.data.digitoConta,
      carteira: parsed.data.carteira,
      convenio: parsed.data.convenio,
      codigoOriginador: parsed.data.codigoOriginador,
      codigoEmpresa: parsed.data.codigoEmpresa,
      tipoInscricao: parsed.data.tipoInscricao,
      numeroInscricao: parsed.data.numeroInscricao,
      especieTitulo: parsed.data.especieTitulo,
      tipoRecebivel: parsed.data.tipoRecebivel,
      configuracao: parsed.data.configuracao,
    })).digest('hex')
    const { data, error } = await callAdminRpc(context.supabase, 'admin_salvar_cnab_rascunho', {
      p_fundo_id: parsed.data.fundoId,
      p_configuracao_id: parsed.data.configuracaoId || null,
      p_versao_id: parsed.data.versaoId || null,
      p_codigo: parsed.data.codigo,
      p_nome: parsed.data.nome,
      p_descricao: parsed.data.descricao || null,
      p_layout: parsed.data.layout,
      p_versao_layout: parsed.data.versaoLayout,
      p_codigo_banco: parsed.data.codigoBanco,
      p_banco: parsed.data.banco,
      p_agencia: parsed.data.agencia,
      p_conta: parsed.data.conta,
      p_digito_conta: parsed.data.digitoConta,
      p_carteira: parsed.data.carteira,
      p_convenio: parsed.data.convenio,
      p_codigo_originador: parsed.data.codigoOriginador,
      p_codigo_empresa: parsed.data.codigoEmpresa,
      p_tipo_inscricao: parsed.data.tipoInscricao,
      p_numero_inscricao: parsed.data.numeroInscricao,
      p_especie_titulo: parsed.data.especieTitulo,
      p_tipo_recebivel: parsed.data.tipoRecebivel,
      p_configuracao: parsed.data.configuracao,
      p_conteudo_hash: conteudoHash,
      p_updated_at_esperado: parsed.data.updatedAtEsperado || null,
      p_correlation_id: correlationId,
    })
    if (error) return mapearErro(error, correlationId)
    const result = data as unknown as { id: string }
    atualizarTela(parsed.data.fundoId)
    return sucesso('Rascunho CNAB salvo.', result.id)
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

async function executarAcaoVersaoCnab(input: unknown, acao: 'publicar' | 'desativar') {
  const correlationId = randomUUID()
  try {
    const parsed = adminTechnicalConfirmationSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Confirmacao invalida.', correlationId)
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'atualizar_cnab', parsed.data.mfaCode)
    const rpc = acao === 'publicar' ? 'admin_publicar_cnab_versao' : 'admin_desativar_cnab_versao'
    const { error } = await callAdminRpc(context.supabase, rpc, {
      p_fundo_id: parsed.data.fundoId,
      p_versao_id: parsed.data.id,
      p_correlation_id: correlationId,
    })
    if (error) return mapearErro(error, correlationId)
    atualizarTela(parsed.data.fundoId)
    return sucesso(acao === 'publicar' ? 'Versao CNAB publicada.' : 'Versao CNAB desativada.', parsed.data.id)
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

export async function publicarCnabAdmin(input: unknown) {
  return executarAcaoVersaoCnab(input, 'publicar')
}

export async function desativarCnabAdmin(input: unknown) {
  return executarAcaoVersaoCnab(input, 'desativar')
}
