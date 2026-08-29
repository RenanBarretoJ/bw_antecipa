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
  obterPendenciaPublicacaoIntegracao,
  validarAdapterRascunhoContraHistorico,
  type AdminConfiguracoesTecnicasFundo,
  type AdminTechnicalActionResult,
} from '@/lib/admin/configuracoes-tecnicas'
import { validarEndpointTecnicoSeguro } from '@/lib/admin/endpoint-seguro.server'
import { integrationProviderRegistry } from '@/lib/integracoes/registry.server'
import { prepararConfiguracaoFinanceiraDoFundo, possuiCapabilityFinanceira } from '@/lib/integracoes/configuracao-financeira'
import {
  criptografarPortalFidcValor,
  descriptografarPortalFidcValor,
} from '@/lib/portal-fidc/credenciais'

type RpcError = { code?: string; message?: string }

function rpcRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Resposta administrativa invalida.')
  }
  return value as Record<string, unknown>
}

function rpcString(value: unknown, field: string): string {
  const result = rpcRecord(value)[field]
  if (typeof result !== 'string' || !result) throw new Error('Resposta administrativa incompleta.')
  return result
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
  const message = error instanceof Error ? error.message : value?.message
  if (message?.startsWith('O endpoint tecnico') || message?.startsWith('O dominio do endpoint') || message?.startsWith('O CNPJ cadastrado do fundo')) {
    return respostaErro(message, correlationId)
  }
  if (value?.code === '42501') return respostaErro('Acesso restrito ao Super Admin.', correlationId)
  if (value?.code === 'P0002') return respostaErro('Configuracao tecnica nao encontrada neste fundo.', correlationId)
  if (value?.code === '40001') return respostaErro('A configuracao foi alterada em outra sessao. Recarregue e tente novamente.', correlationId)
  if (value?.code === '23505') return respostaErro('Ja existe uma configuracao ativa equivalente.', correlationId)
  if (value?.code === '23514' || value?.code === '22023') return respostaErro(value.message || 'A configuracao informada e invalida.', correlationId)
  console.error('[admin/sa3]', { correlationId, code: value?.code || 'unexpected', message: message || 'sem mensagem' })
  return respostaErro('Nao foi possivel concluir a configuracao tecnica.', correlationId)
}

function mapearErroAtivacaoCredencial(error: unknown, correlationId: string): AdminTechnicalActionResult {
  const mapped = mapearErro(error, correlationId)
  return respostaErro(`Nao foi possivel ativar a credencial: ${mapped.message}`, correlationId)
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

    const { data, error } = await context.supabase.rpc('admin_cadastrar_credencial_integracao', {
      p_fundo_id: parsed.data.fundoId,
      p_integracao_fundo_id: parsed.data.integracaoFundoId,
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
    const resultId = rpcString(data, 'id')
    atualizarTela(parsed.data.fundoId)
    return sucesso(parsed.data.credencialAnteriorId ? 'Nova credencial de rotacao cadastrada.' : 'Credencial cadastrada.', resultId)
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
    const { error } = await context.supabase.rpc('admin_ativar_credencial_integracao', {
      p_fundo_id: parsed.data.fundoId,
      p_credencial_id: parsed.data.id,
      p_correlation_id: correlationId,
    })
    if (error) return mapearErroAtivacaoCredencial(error, correlationId)
    atualizarTela(parsed.data.fundoId)
    return sucesso('Credencial ativada com sucesso.', parsed.data.id)
  } catch (error) {
    return mapearErroAtivacaoCredencial(error, correlationId)
  }
}

export async function revogarCredencialAdmin(input: unknown): Promise<AdminTechnicalActionResult> {
  const correlationId = randomUUID()
  try {
    const parsed = adminTechnicalConfirmationSchema.safeParse(input)
    if (!parsed.success || !parsed.data.motivo || parsed.data.motivo.length < 10) return respostaErro('Informe um motivo com pelo menos 10 caracteres.', correlationId)
    const context = await requireSuperAdmin()
    await autorizarEConsumirAcaoSensivel(context, 'revogar_credencial_integracao', parsed.data.mfaCode)
    const { data, error } = await context.supabase.rpc('admin_revogar_credencial_integracao', {
      p_fundo_id: parsed.data.fundoId,
      p_credencial_id: parsed.data.id,
      p_motivo: parsed.data.motivo,
      p_correlation_id: correlationId,
    })
    if (error) return mapearErro(error, correlationId)
    const impactaVersaoPublicada = rpcRecord(data).impacta_versao_publicada === true
    atualizarTela(parsed.data.fundoId)
    return {
      ...sucesso('Credencial revogada.', parsed.data.id),
      notification: impactaVersaoPublicada
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
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      const validationMessages: Record<string, string> = {
        FUNDO_ID_INVALIDO: 'O fundo informado e invalido.',
        INTEGRACAO_ID_INVALIDO: 'A integracao selecionada e invalida.',
        VERSAO_ID_INVALIDO: 'A versao selecionada e invalida.',
      }
      return respostaErro(validationMessages[issue?.message] || issue?.message || 'Revise a configuracao da integracao.', correlationId)
    }
    const creating = parsed.data.integracaoFundoId == null
    const context = await requireSuperAdmin()
    if (parsed.data.integracaoFundoId) {
      const { data: configData, error: configError } = await context.supabase.rpc('admin_obter_configuracoes_tecnicas_fundo', {
        p_fundo_id: parsed.data.fundoId,
        p_execucoes_limite: 1,
        p_execucoes_offset: 0,
      })
      if (configError || !configData) return mapearErro(configError || new Error('Configuracao da integracao nao encontrada.'), correlationId)
      const state = configData as AdminConfiguracoesTecnicasFundo
      const integracao = state.integracoes.find((item) => item.id === parsed.data.integracaoFundoId)
      if (!integracao) return respostaErro('A integracao selecionada nao pertence ao fundo informado.', correlationId)
      const adapterError = validarAdapterRascunhoContraHistorico(parsed.data.adapterKey, integracao.versoes)
      if (adapterError) return respostaErro(adapterError, correlationId)
    }
    const endpoint = parsed.data.endpointBase ? new URL(parsed.data.endpointBase).toString() : ''
    let configuracaoNaoSensivel = parsed.data.configuracaoNaoSensivel
    if (possuiCapabilityFinanceira(parsed.data.capabilities)) {
      const { data: fundo, error: fundoError } = await context.supabase
        .from('fundos')
        .select('cnpj')
        .eq('id', parsed.data.fundoId)
        .maybeSingle()
      if (fundoError) return mapearErro(fundoError, correlationId)
      if (!fundo) return respostaErro('O fundo informado nao foi encontrado.', correlationId)
      configuracaoNaoSensivel = prepararConfiguracaoFinanceiraDoFundo({
        configuracao: configuracaoNaoSensivel,
        capabilities: parsed.data.capabilities,
        cnpjFundo: fundo.cnpj,
      })
    }
    const { data, error } = await context.supabase.rpc('admin_salvar_integracao_rascunho', {
      p_fundo_id: parsed.data.fundoId,
      p_integracao_fundo_id: parsed.data.integracaoFundoId || null,
      p_versao_id: parsed.data.versaoId || null,
      p_provider_key: parsed.data.providerKey,
      p_system_name: parsed.data.systemName,
      p_adapter_key: parsed.data.adapterKey,
      p_capabilities: parsed.data.capabilities,
      p_ambiente: parsed.data.ambiente,
      p_endpoint_base: endpoint,
      p_identificador_cliente: parsed.data.identificadorCliente,
      p_credencial_integracao_id: parsed.data.credencialIntegracaoId,
      p_configuracao_nao_sensivel: configuracaoNaoSensivel,
      p_updated_at_esperado: parsed.data.updatedAtEsperado || null,
      p_correlation_id: correlationId,
    })
    if (error) return mapearErro(error, correlationId)
    const resultId = rpcString(data, 'id')
    atualizarTela(parsed.data.fundoId)
    return {
      ...sucesso(creating ? 'Rascunho criado com sucesso.' : 'Rascunho atualizado com sucesso.', resultId),
      data: { id: resultId, integrationId: rpcString(data, 'integracao_id') },
    }
  } catch (error) {
    return mapearErro(error, correlationId)
  }
}

async function validarIntegracaoParaPublicacao(
  context: Awaited<ReturnType<typeof requireSuperAdmin>>,
  fundoId: string,
  versaoId: string,
) {
  const { data, error } = await context.supabase.rpc('admin_obter_configuracoes_tecnicas_fundo', {
    p_fundo_id: fundoId,
    p_execucoes_limite: 1,
    p_execucoes_offset: 0,
  })
  if (error || !data) throw error || new Error('Configuracao da integracao nao encontrada.')
  const state = data as AdminConfiguracoesTecnicasFundo
  const integracao = state.integracoes.find((item) => item.versoes.some((versao) => versao.id === versaoId))
  const versao = integracao?.versoes.find((item) => item.id === versaoId)
  if (!versao) return 'Configuracao da integracao nao encontrada neste fundo.'
  const adapter = integrationProviderRegistry.get(versao.adapter_key)
  if (!adapter) return 'Adapter nao implementado. O rascunho pode ser mantido, mas nao publicado.'
  const unsupported = versao.capabilities.find((capability) => !adapter.supports.includes(capability))
  if (unsupported) return `O adapter ${adapter.label} nao implementa a capability ${unsupported}.`
  const pendencia = obterPendenciaPublicacaoIntegracao(versao, state.credenciais, adapter)
  if (pendencia) return pendencia
  if (adapter.requiresCredential) {
    const credential = state.credenciais.find((item) => item.id === versao.credencial_integracao_id)
    if (!credential || credential.integracao_fundo_id !== integracao?.id) {
      return 'A credencial selecionada nao pertence a esta integracao.'
    }
  }
  const adapterPendencia = adapter.validatePublication({
    capabilities: versao.capabilities,
    clientIdentifier: versao.identificador_cliente,
    originatorCode: versao.codigo_originador,
    config: versao.configuracao_nao_sensivel,
  })
  if (adapterPendencia) return adapterPendencia
  if (adapter.requiresEndpoint) await validarEndpointTecnicoSeguro(versao.endpoint_base)
  if (versao.adapter_key === 'vortx_vrs') {
    // A credencial Vortx (Key/Secret + certificado/chave mTLS) vive em
    // integracoes_vortx_vrs_credenciais, fora do fluxo generico
    // credencial_integracao_id (por isso adapter.requiresCredential e
    // false para este adapter) -- valida aqui, reaproveitando a mesma RPC
    // de leitura ja usada pela secao Credenciais.
    const { data: vortxData, error: vortxError } = await context.supabase.rpc('admin_obter_configuracao_vortx_vrs', {
      p_fundo_id: fundoId,
    })
    if (vortxError) throw vortxError
    const vortxConfig = (vortxData || []) as Array<{ ambiente: string; status: string }>
    const possuiCredencialAtiva = vortxConfig.some((item) => item.ambiente === versao.ambiente && item.status === 'ativa')
    if (!possuiCredencialAtiva) return 'Configure e valide a credencial Vortx VRS deste ambiente antes de publicar.'
  }
  return null
}

async function executarAcaoVersaoIntegracao(input: unknown, acao: 'publicar' | 'desativar') {
  const correlationId = randomUUID()
  try {
    const parsed = adminTechnicalConfirmationSchema.safeParse(input)
    if (!parsed.success) return respostaErro('Confirmacao invalida.', correlationId)
    const context = await requireSuperAdmin()
    if (acao === 'publicar') {
      const pendencia = await validarIntegracaoParaPublicacao(context, parsed.data.fundoId, parsed.data.id)
      if (pendencia) return respostaErro(pendencia, correlationId)
    }
    await autorizarEConsumirAcaoSensivel(context, acao === 'publicar' ? 'publicar_integracao' : 'desativar_integracao', parsed.data.mfaCode)
    const rpc = acao === 'publicar' ? 'admin_publicar_integracao_versao' : 'admin_desativar_integracao_versao'
    const { error } = await context.supabase.rpc(rpc, {
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
    const { data: configData, error: configError } = await context.supabase.rpc('admin_obter_configuracoes_tecnicas_fundo', {
      p_fundo_id: parsed.data.fundoId,
      p_execucoes_limite: 1,
      p_execucoes_offset: 0,
    })
    if (configError || !configData) return mapearErro(configError || new Error('Configuracao nao encontrada.'), correlationId)
    const configState = configData as AdminConfiguracoesTecnicasFundo
    const version = configState.integracoes.flatMap((item) => item.versoes).find((item) => item.id === parsed.data.id)
    const adapter = integrationProviderRegistry.get(version?.adapter_key)
    if (!adapter) return respostaErro('Teste indisponivel: adapter nao implementado.', correlationId)
    await autorizarEConsumirAcaoSensivel(context, 'testar_integracao', parsed.data.mfaCode)
    const { data, error } = await context.supabase.rpc('admin_preparar_teste_integracao', {
      p_fundo_id: parsed.data.fundoId,
      p_versao_id: parsed.data.id,
      p_correlation_id: correlationId,
    })
    if (error || !data) return mapearErro(error || new Error('Teste nao preparado.'), correlationId)
    const prepared = {
      execucao_id: rpcString(data, 'execucao_id'),
      endpoint_base: rpcString(data, 'endpoint_base'),
      usuario_criptografado: rpcString(data, 'usuario_criptografado'),
      senha_criptografada: rpcString(data, 'senha_criptografada'),
      chave_versao: rpcString(data, 'chave_versao'),
    }
    execucaoId = prepared.execucao_id
    const endpoint = await validarEndpointTecnicoSeguro(prepared.endpoint_base)
    const username = descriptografarPortalFidcValor(prepared.usuario_criptografado, prepared.chave_versao)
    const password = descriptografarPortalFidcValor(prepared.senha_criptografada, prepared.chave_versao)
    const result = await adapter.testConnection({ endpoint, username, password, timeoutMs: 15_000 })
    const { error: finishError } = await context.supabase.rpc('admin_finalizar_teste_integracao', {
      p_fundo_id: parsed.data.fundoId,
      p_execucao_id: execucaoId,
      p_status: result.ok ? 'sucesso' : 'erro',
      p_codigo_resposta: result.statusCode,
      p_mensagem_resumida: result.message,
      p_erro_categoria: result.errorCategory,
      p_duracao_ms: Date.now() - inicio,
      p_correlation_id: correlationId,
    })
    if (finishError) return mapearErro(finishError, correlationId)
    atualizarTela(parsed.data.fundoId)
    return result.ok ? sucesso('Teste tecnico concluido com sucesso.', execucaoId) : respostaErro(`O endpoint respondeu HTTP ${result.statusCode}.`, correlationId)
  } catch (error) {
    if (context && execucaoId) {
      const timeout = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      await context.supabase.rpc('admin_finalizar_teste_integracao', {
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
    const { data, error } = await context.supabase.rpc('admin_salvar_cnab_rascunho', {
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
    const resultId = rpcString(data, 'id')
    atualizarTela(parsed.data.fundoId)
    return sucesso('Rascunho CNAB salvo.', resultId)
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
    const { error } = await context.supabase.rpc(rpc, {
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
