'use server'

import { requireGestor } from '@/lib/auth/authorization'
import { exigirSessaoElevada, registrarEventoSeguranca } from '@/lib/auth/mfa'
import { registrarLog } from '@/lib/actions/auditoria'
import { createAdminClient } from '@/lib/supabase/server'
import { montarConfiguracaoLegadoParaCadastro, normalizarConfiguracaoCnabInput, validarConfiguracaoCnab } from '@/lib/cnab/resolver-configuracao'
import { calcularHashConfiguracaoCnab, type ConfiguracaoCnabResolvida } from '@/lib/cnab/domain'
import { geradorCnab444 } from '@/lib/cnab/layouts/cnab444'
import { testarConexaoPortalFidc } from '@/lib/portal-fidc/integracao'
import { criptografarPortalFidcValor } from '@/lib/portal-fidc/credenciais'
import { registrarTentativaRateLimit, verificarRateLimit } from '@/lib/security/rate-limit'

type ActionState<T = unknown> = { success: boolean; message: string; data?: T }

type ConfigInput = Omit<ConfiguracaoCnabResolvida, 'configuracaoId' | 'versaoId' | 'versao' | 'hash' | 'codigo'>

function result<T = unknown>(message: string, success = false, data?: T): ActionState<T> {
  return { success, message, data }
}

function assertCodigo(codigo: string) {
  const normalized = codigo.trim()
  if (!/^[a-z0-9_-]+$/.test(normalized)) throw new Error('Codigo deve conter apenas letras minusculas, numeros, hifen ou underline.')
  return normalized
}

async function assertFundoGestor(context: Awaited<ReturnType<typeof requireGestor>>, fundoId: string) {
  if (!fundoId) throw new Error('Fundo e obrigatorio.')
  const { data, error } = await context.supabase
    .from('fundos')
    .select('id, nome, cnpj')
    .eq('id', fundoId)
    .maybeSingle()
  if (error) throw new Error(`Erro ao validar fundo: ${error.message}`)
  if (!data) throw new Error('Fundo nao encontrado ou sem acesso.')
  return data as { id: string; nome: string; cnpj: string }
}

export async function criarConfiguracaoCnab(input: {
  fundoId: string
  codigo: string
  nome: string
  descricao?: string
}): Promise<ActionState<{ id: string }>> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    const codigo = assertCodigo(input.codigo)
    if (!input.fundoId || !input.nome.trim()) return result('Fundo e nome sao obrigatorios.')
    await assertFundoGestor(context, input.fundoId)
    const { data, error } = await context.supabase
      .from('configuracoes_cnab')
      .insert({
        fundo_id: input.fundoId,
        codigo,
        nome: input.nome.trim(),
        descricao: input.descricao?.trim() || null,
        finalidade: 'remessa',
        status: 'rascunho',
        created_by: context.user.id,
      } as never)
      .select('id')
      .single()
    if (error || !data) return result(`Erro ao criar configuracao CNAB: ${error?.message || 'registro nao retornado'}`)
    await registrarLog({ tipo_evento: 'CONFIGURACAO_CNAB_CRIADA', entidade_tipo: 'configuracoes_cnab', entidade_id: (data as { id: string }).id, dados_depois: { fundo_id: input.fundoId, codigo } })
    return result('Configuracao CNAB criada como rascunho.', true, { id: (data as { id: string }).id })
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao criar configuracao CNAB.')
  }
}

export async function criarVersaoConfiguracaoCnab(fundoId: string, configuracaoCnabId: string, input: ConfigInput): Promise<ActionState<{ id: string; versao: number }>> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await assertFundoGestor(context, fundoId)
    const { data: config } = await context.supabase
      .from('configuracoes_cnab')
      .select('id, fundo_id, status')
      .eq('id', configuracaoCnabId)
      .eq('fundo_id', fundoId)
      .maybeSingle()
    if (!config) return result('Configuracao CNAB nao encontrada.')
    if ((config as { status: string }).status === 'desativada') return result('Nao e possivel criar versao para configuracao desativada.')

    const normalized = normalizarConfiguracaoCnabInput(input)
    const erros = validarConfiguracaoCnab(normalized)
    if (erros.length > 0) return result(erros.join(' '))

    const { data: last } = await context.supabase
      .from('configuracao_cnab_versoes')
      .select('versao')
      .eq('configuracao_cnab_id', configuracaoCnabId)
      .order('versao', { ascending: false })
      .limit(1)
      .maybeSingle()

    const versao = ((last as { versao: number } | null)?.versao || 0) + 1
    const { data, error } = await context.supabase
      .from('configuracao_cnab_versoes')
      .insert({
        configuracao_cnab_id: configuracaoCnabId,
        versao,
        vigente_desde: new Date().toISOString(),
        layout: normalized.layout,
        versao_layout: normalized.versaoLayout,
        codigo_banco: normalized.codigoBanco,
        banco: normalized.banco,
        agencia: normalized.agencia,
        conta: normalized.conta,
        digito_conta: normalized.digitoConta,
        carteira: normalized.carteira,
        convenio: normalized.convenio,
        codigo_originador: normalized.codigoOriginador,
        codigo_empresa: normalized.codigoEmpresa,
        tipo_inscricao: normalized.tipoInscricao,
        numero_inscricao: normalized.numeroInscricao,
        especie_titulo: normalized.especieTitulo,
        tipo_recebivel: normalized.tipoRecebivel,
        configuracao: normalized.configuracao,
        conteudo_hash: calcularHashConfiguracaoCnab(normalized),
        status: 'rascunho',
      } as never)
      .select('id')
      .single()
    if (error || !data) return result(`Erro ao criar versao CNAB: ${error?.message || 'registro nao retornado'}`)
    await registrarLog({ tipo_evento: 'CONFIGURACAO_CNAB_VERSAO_CRIADA', entidade_tipo: 'configuracao_cnab_versoes', entidade_id: (data as { id: string }).id, dados_depois: { configuracao_cnab_id: configuracaoCnabId, versao } })
    return result(`Versao ${versao} criada como rascunho.`, true, { id: (data as { id: string }).id, versao })
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao criar versao CNAB.')
  }
}

export async function publicarVersaoConfiguracaoCnab(fundoId: string, versaoId: string): Promise<ActionState> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await assertFundoGestor(context, fundoId)
    const { data: version } = await context.supabase
      .from('configuracao_cnab_versoes')
      .select('id, configuracao_cnab_id, versao, status, configuracao:configuracoes_cnab(fundo_id)')
      .eq('id', versaoId)
      .maybeSingle()
    if (!version) return result('Versao CNAB nao encontrada.')
    const versionData = version as { id: string; configuracao_cnab_id: string; versao: number; status: string; configuracao: { fundo_id: string } | null }
    if (versionData.configuracao?.fundo_id !== fundoId) return result('Versao CNAB nao pertence ao fundo informado.')
    if (versionData.status === 'publicada') return result('Versao ja publicada.')

    const now = new Date().toISOString()
    const { error: closeError } = await context.supabase
      .from('configuracao_cnab_versoes')
      .update({ status: 'substituida', vigente_ate: now } as never)
      .eq('configuracao_cnab_id', versionData.configuracao_cnab_id)
      .eq('status', 'publicada')
      .is('vigente_ate', null)
    if (closeError) return result(`Erro ao substituir versao anterior: ${closeError.message}`)

    const { error: publishError } = await context.supabase
      .from('configuracao_cnab_versoes')
      .update({ status: 'publicada', vigente_desde: now, publicada_por: context.user.id, publicada_em: now } as never)
      .eq('id', versaoId)
    if (publishError) return result(`Erro ao publicar versao: ${publishError.message}`)

    const { data: cfg } = await context.supabase
      .from('configuracoes_cnab')
      .select('fundo_id, finalidade')
      .eq('id', versionData.configuracao_cnab_id)
      .maybeSingle()
    const configData = cfg as { fundo_id: string; finalidade: string } | null
    if (configData) {
      await context.supabase
        .from('configuracoes_cnab')
        .update({ status: 'desativada' } as never)
        .eq('fundo_id', configData.fundo_id)
        .eq('finalidade', configData.finalidade)
        .neq('id', versionData.configuracao_cnab_id)
        .eq('status', 'ativa')
    }

    const { error: activateError } = await context.supabase
      .from('configuracoes_cnab')
      .update({ status: 'ativa' } as never)
      .eq('id', versionData.configuracao_cnab_id)
    if (activateError) return result(`Versao publicada, mas configuracao nao foi ativada: ${activateError.message}`)

    await registrarLog({ tipo_evento: 'CONFIGURACAO_CNAB_VERSAO_PUBLICADA', entidade_tipo: 'configuracao_cnab_versoes', entidade_id: versaoId, dados_depois: { versao: versionData.versao, publicada_em: now } })
    return result(`Versao ${versionData.versao} publicada.`, true)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao publicar versao CNAB.')
  }
}

export async function desativarConfiguracaoCnab(fundoId: string, configuracaoCnabId: string): Promise<ActionState> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await assertFundoGestor(context, fundoId)
    const { error } = await context.supabase
      .from('configuracoes_cnab')
      .update({ status: 'desativada' } as never)
      .eq('id', configuracaoCnabId)
      .eq('fundo_id', fundoId)
    if (error) return result(`Erro ao desativar configuracao: ${error.message}`)
    await registrarLog({ tipo_evento: 'CONFIGURACAO_CNAB_DESATIVADA', entidade_tipo: 'configuracoes_cnab', entidade_id: configuracaoCnabId, dados_depois: { status: 'desativada' } })
    return result('Configuracao CNAB desativada.', true)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao desativar configuracao CNAB.')
  }
}

export async function importarConfiguracaoCnabLegado(fundoId: string): Promise<ActionState<{ configuracaoId: string; versaoId: string }>> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await assertFundoGestor(context, fundoId)
    const legado = montarConfiguracaoLegadoParaCadastro()
    const codigo = 'cnab444_legado'

    const { data: existing } = await context.supabase
      .from('configuracoes_cnab')
      .select('id, configuracao_cnab_versoes(id)')
      .eq('fundo_id', fundoId)
      .eq('codigo', codigo)
      .maybeSingle()

    let configuracaoId = (existing as { id?: string } | null)?.id
    if (!configuracaoId) {
      const created = await criarConfiguracaoCnab({
        fundoId,
        codigo,
        nome: 'CNAB 444 legado',
        descricao: 'Configuração equivalente ao gerador CNAB 444 legado versionado no repositório.',
      })
      if (!created.success || !created.data?.id) return result(created.message)
      configuracaoId = created.data.id
    } else if (((existing as { configuracao_cnab_versoes?: unknown[] }).configuracao_cnab_versoes || []).length > 0) {
      return result('Configuracao legado ja possui versao cadastrada.', true, { configuracaoId, versaoId: '' })
    }

    const version = await criarVersaoConfiguracaoCnab(fundoId, configuracaoId, legado)
    if (!version.success || !version.data?.id) return result(version.message)
    return result('Configuracao legado importada como rascunho.', true, { configuracaoId, versaoId: version.data.id })
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao importar configuracao legado.')
  }
}

type IntegracaoInput = {
  provedor: 'fromtis' | 'sinqia'
  ambiente: 'homologacao' | 'producao'
  identificadorCliente: string
  codigoOriginador?: string
  endpointBase: string
  credentialRef: string
  credencialIntegracaoId?: string | null
  secretName?: string
  vaultKey?: string
  configuracaoNaoSensivel?: Record<string, unknown>
}

type CredencialPortalFidcMetadata = {
  id: string
  fundo_id: string
  integracao_fundo_id: string
  ambiente: 'homologacao' | 'producao'
  nome: string
  status: 'rascunho' | 'ativa' | 'substituida' | 'revogada'
  chave_versao: string
  criada_por: string
  criada_em: string
  ativada_em: string | null
  revogada_em: string | null
  substituida_por: string | null
  ultimo_uso_em: string | null
  created_at: string
  updated_at: string
  criador?: { nome_completo: string; email: string } | null
}

function validarIntegracaoInput(input: IntegracaoInput): string[] {
  const erros: string[] = []
  if (input.provedor !== 'fromtis') erros.push('Provedor invalido. Use Portal FIDC - Sinqia.')
  if (!['homologacao', 'producao'].includes(input.ambiente)) erros.push('Ambiente invalido.')
  if (!input.identificadorCliente.trim()) erros.push('Identificador do cliente e obrigatorio.')
  if (!input.endpointBase.trim()) erros.push('Endpoint base e obrigatorio.')
  if (!/^https?:\/\//i.test(input.endpointBase.trim())) erros.push('Endpoint base deve iniciar com http:// ou https://.')
  if (!input.credencialIntegracaoId && !input.credentialRef.trim()) erros.push('Selecione uma credencial ativa ou informe referencia temporaria de fallback.')
  if (input.codigoOriginador && !/^\d{1,20}$/.test(input.codigoOriginador.trim())) erros.push('Codigo originador da integracao deve conter ate 20 digitos.')
  return erros
}

async function obterOuCriarIntegracaoPortalFidc(fundoId: string, userId: string) {
  const admin = createAdminClient()
  const { data: existing, error: existingError } = await admin
    .from('integracoes_fundo')
    .select('id, status')
    .eq('fundo_id', fundoId)
    .eq('provedor', 'fromtis')
    .maybeSingle()
  if (existingError) throw new Error(`Erro ao consultar integracao Portal FIDC: ${existingError.message}`)

  const integracaoId = (existing as { id?: string; status?: string } | null)?.id
  if (integracaoId) {
    if ((existing as { status?: string }).status === 'desativada') {
      await admin.from('integracoes_fundo').update({ status: 'rascunho', nome: 'Portal FIDC - Sinqia' } as never).eq('id', integracaoId)
    }
    return integracaoId
  }

  const { data, error } = await admin
    .from('integracoes_fundo')
    .insert({
      fundo_id: fundoId,
      provedor: 'fromtis',
      nome: 'Portal FIDC - Sinqia',
      status: 'rascunho',
      created_by: userId,
    } as never)
    .select('id')
    .single()
  if (error || !data) throw new Error(`Erro ao criar integracao Portal FIDC: ${error?.message || 'registro nao retornado'}`)
  return (data as { id: string }).id
}

function mascararIdentificador(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length <= 4) return '••••'
  return `${trimmed.slice(0, 2)}••••${trimmed.slice(-2)}`
}

export async function listarCredenciaisPortalFidc(fundoId: string): Promise<ActionState<CredencialPortalFidcMetadata[]>> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await assertFundoGestor(context, fundoId)
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('credenciais_integracao')
      .select('id, fundo_id, integracao_fundo_id, ambiente, nome, status, chave_versao, criada_por, criada_em, ativada_em, revogada_em, substituida_por, ultimo_uso_em, created_at, updated_at, criador:profiles(nome_completo, email)')
      .eq('fundo_id', fundoId)
      .order('created_at', { ascending: false })

    if (error) {
      if (error.code === '42P01' || error.message.includes('credenciais_integracao')) return result('Tabela de credenciais ainda nao aplicada no banco.', true, [])
      return result(`Erro ao listar credenciais: ${error.message}`)
    }

    return result('Credenciais carregadas.', true, (data || []) as unknown as CredencialPortalFidcMetadata[])
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao listar credenciais Portal FIDC.')
  }
}

export async function cadastrarCredencialPortalFidc(fundoId: string, input: {
  ambiente: 'homologacao' | 'producao'
  nome: string
  usuario: string
  senha: string
}): Promise<ActionState<{ id: string }>> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await assertFundoGestor(context, fundoId)
    if (!['homologacao', 'producao'].includes(input.ambiente)) return result('Ambiente invalido.')
    if (input.nome.trim().length < 2) return result('Nome da credencial e obrigatorio.')
    if (!input.usuario.trim() || !input.senha) return result('Usuario e senha sao obrigatorios.')

    const integracaoId = await obterOuCriarIntegracaoPortalFidc(fundoId, context.user.id)
    const usuario = criptografarPortalFidcValor(input.usuario.trim())
    const senha = criptografarPortalFidcValor(input.senha)
    const chaveVersao = usuario.chaveVersao
    if (senha.chaveVersao !== chaveVersao) return result('Rotacao de chave mudou durante criptografia. Tente novamente.')

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('credenciais_integracao')
      .insert({
        fundo_id: fundoId,
        integracao_fundo_id: integracaoId,
        ambiente: input.ambiente,
        nome: input.nome.trim(),
        usuario_criptografado: usuario.ciphertext,
        senha_criptografada: senha.ciphertext,
        chave_versao: chaveVersao,
        status: 'rascunho',
        criada_por: context.user.id,
        metadados: { usuario_mascarado: mascararIdentificador(input.usuario) },
      } as never)
      .select('id')
      .single()

    if (error || !data) return result(`Erro ao cadastrar credencial: ${error?.message || 'registro nao retornado'}`)
    const id = (data as { id: string }).id
    await registrarEventoSeguranca({ tipo_evento: 'CREDENCIAL_CRIADA', usuario_id: context.user.id, ator_usuario_id: context.user.id, severidade: 'warning', entidade_tipo: 'credenciais_integracao', entidade_id: id, dados: { fundo_id: fundoId, integracao_fundo_id: integracaoId, ambiente: input.ambiente, chave_versao: chaveVersao } })
    await registrarLog({ tipo_evento: 'CREDENCIAL_CRIADA', entidade_tipo: 'credenciais_integracao', entidade_id: id, dados_depois: { fundo_id: fundoId, integracao_fundo_id: integracaoId, ambiente: input.ambiente, status: 'rascunho' } })
    return result('Credencial criptografada cadastrada como rascunho.', true, { id })
  } catch (error) {
    await registrarEventoSeguranca({ tipo_evento: 'ACESSO_CREDENCIAL_NEGADO', severidade: 'warning', entidade_tipo: 'credenciais_integracao', dados: { fundo_id: fundoId, erro: error instanceof Error ? error.message : 'erro_desconhecido' } })
    return result(error instanceof Error ? error.message : 'Erro ao cadastrar credencial Portal FIDC.')
  }
}

export async function ativarCredencialPortalFidc(fundoId: string, credencialId: string, motivo?: string): Promise<ActionState> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await assertFundoGestor(context, fundoId)
    const admin = createAdminClient()
    const now = new Date().toISOString()
    const { data: credencial } = await admin
      .from('credenciais_integracao')
      .select('id, fundo_id, integracao_fundo_id, ambiente, status')
      .eq('id', credencialId)
      .eq('fundo_id', fundoId)
      .maybeSingle()

    const atual = credencial as { id: string; integracao_fundo_id: string; ambiente: 'homologacao' | 'producao'; status: string } | null
    if (!atual) return result('Credencial nao encontrada para este fundo.')
    if (atual.status === 'revogada') return result('Credencial revogada nao pode ser ativada.')
    if (atual.status === 'ativa') return result('Credencial ja esta ativa.', true)

    const { data: anterior } = await admin
      .from('credenciais_integracao')
      .select('id')
      .eq('integracao_fundo_id', atual.integracao_fundo_id)
      .eq('ambiente', atual.ambiente)
      .eq('status', 'ativa')
      .maybeSingle()

    await admin
      .from('credenciais_integracao')
      .update({ status: 'substituida', substituida_por: credencialId, updated_at: now } as never)
      .eq('integracao_fundo_id', atual.integracao_fundo_id)
      .eq('ambiente', atual.ambiente)
      .eq('status', 'ativa')

    const { error } = await admin
      .from('credenciais_integracao')
      .update({ status: 'ativa', ativada_em: now, revogada_em: null, updated_at: now } as never)
      .eq('id', credencialId)
    if (error) return result(`Erro ao ativar credencial: ${error.message}`)

    await registrarEventoSeguranca({ tipo_evento: anterior ? 'CREDENCIAL_ROTACIONADA' : 'CREDENCIAL_ATIVADA', usuario_id: context.user.id, ator_usuario_id: context.user.id, severidade: 'critical', entidade_tipo: 'credenciais_integracao', entidade_id: credencialId, dados: { fundo_id: fundoId, integracao_fundo_id: atual.integracao_fundo_id, ambiente: atual.ambiente, anterior_id: (anterior as { id?: string } | null)?.id || null, motivo: motivo?.trim() || null } })
    await registrarLog({ tipo_evento: anterior ? 'CREDENCIAL_ROTACIONADA' : 'CREDENCIAL_ATIVADA', entidade_tipo: 'credenciais_integracao', entidade_id: credencialId, dados_depois: { fundo_id: fundoId, ambiente: atual.ambiente, anterior_id: (anterior as { id?: string } | null)?.id || null } })
    return result(anterior ? 'Credencial ativada e anterior marcada como substituida.' : 'Credencial ativada.', true)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao ativar credencial Portal FIDC.')
  }
}

export async function revogarCredencialPortalFidc(fundoId: string, credencialId: string, motivo: string): Promise<ActionState> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await assertFundoGestor(context, fundoId)
    if (motivo.trim().length < 10) return result('Informe um motivo com pelo menos 10 caracteres.')
    const admin = createAdminClient()
    const now = new Date().toISOString()

    const { data: usada } = await admin
      .from('integracao_fundo_versoes')
      .select('id')
      .eq('credencial_integracao_id', credencialId)
      .eq('status', 'publicada')
      .limit(1)
      .maybeSingle()
    if (usada) return result('Credencial vinculada a versao publicada nao pode ser revogada antes de publicar uma nova versao com outra credencial.')

    const { error } = await admin
      .from('credenciais_integracao')
      .update({ status: 'revogada', revogada_em: now, updated_at: now } as never)
      .eq('id', credencialId)
      .eq('fundo_id', fundoId)
      .neq('status', 'revogada')
    if (error) return result(`Erro ao revogar credencial: ${error.message}`)

    await registrarEventoSeguranca({ tipo_evento: 'CREDENCIAL_REVOGADA', usuario_id: context.user.id, ator_usuario_id: context.user.id, severidade: 'critical', entidade_tipo: 'credenciais_integracao', entidade_id: credencialId, dados: { fundo_id: fundoId, motivo: motivo.trim() } })
    await registrarLog({ tipo_evento: 'CREDENCIAL_REVOGADA', entidade_tipo: 'credenciais_integracao', entidade_id: credencialId, dados_depois: { fundo_id: fundoId, status: 'revogada' } })
    return result('Credencial revogada.', true)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao revogar credencial Portal FIDC.')
  }
}

export async function criarOuAtualizarIntegracaoFundo(fundoId: string, input: IntegracaoInput): Promise<ActionState<{ integracaoId: string; versaoId: string; versao: number }>> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await assertFundoGestor(context, fundoId)
    const erros = validarIntegracaoInput(input)
    if (erros.length > 0) return result(erros.join(' '))

    const { data: existing } = await context.supabase
      .from('integracoes_fundo')
      .select('id, status')
      .eq('fundo_id', fundoId)
      .eq('provedor', input.provedor)
      .maybeSingle()

    let integracaoId = (existing as { id?: string } | null)?.id
    if (!integracaoId) {
      const { data: created, error } = await context.supabase
        .from('integracoes_fundo')
        .insert({
          fundo_id: fundoId,
          provedor: input.provedor,
          nome: 'Portal FIDC - Sinqia',
          status: 'rascunho',
          created_by: context.user.id,
        } as never)
        .select('id')
        .single()
      if (error || !created) return result(`Erro ao criar integracao do fundo: ${error?.message || 'registro nao retornado'}`)
      integracaoId = (created as { id: string }).id
    } else if ((existing as { status?: string } | null)?.status === 'desativada') {
      await context.supabase
        .from('integracoes_fundo')
        .update({ status: 'rascunho', nome: 'Portal FIDC - Sinqia' } as never)
        .eq('id', integracaoId)
    }

    const { data: last } = await context.supabase
      .from('integracao_fundo_versoes')
      .select('versao')
      .eq('integracao_fundo_id', integracaoId)
      .order('versao', { ascending: false })
      .limit(1)
      .maybeSingle()

    const versao = ((last as { versao: number } | null)?.versao || 0) + 1
    const credentialRef = input.credentialRef.trim() || (input.credencialIntegracaoId ? `credencial:${input.credencialIntegracaoId}` : '')
    const { data, error } = await context.supabase
      .from('integracao_fundo_versoes')
      .insert({
        integracao_fundo_id: integracaoId,
        versao,
        ambiente: input.ambiente,
        status: 'rascunho',
        identificador_cliente: input.identificadorCliente.trim(),
        codigo_originador: input.codigoOriginador?.trim() || null,
        endpoint_base: input.endpointBase.trim(),
        configuracao_nao_sensivel: input.configuracaoNaoSensivel || {},
        credential_ref: credentialRef,
        credencial_integracao_id: input.credencialIntegracaoId || null,
        secret_name: input.secretName?.trim() || null,
        vault_key: input.vaultKey?.trim() || null,
        vigente_desde: new Date().toISOString(),
      } as never)
      .select('id')
      .single()
    if (error || !data) return result(`Erro ao criar versao da integracao: ${error?.message || 'registro nao retornado'}`)

    await registrarLog({ tipo_evento: 'INTEGRACAO_FUNDO_VERSAO_CRIADA', entidade_tipo: 'integracao_fundo_versoes', entidade_id: (data as { id: string }).id, dados_depois: { fundo_id: fundoId, provedor: input.provedor, versao } })
    return result(`Versao ${versao} da integracao criada como rascunho.`, true, { integracaoId, versaoId: (data as { id: string }).id, versao })
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao salvar integracao do fundo.')
  }
}

export async function atualizarRascunhoIntegracaoFundo(fundoId: string, versaoId: string, input: IntegracaoInput): Promise<ActionState> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await assertFundoGestor(context, fundoId)
    const erros = validarIntegracaoInput(input)
    if (erros.length > 0) return result(erros.join(' '))

    const { data: version } = await context.supabase
      .from('integracao_fundo_versoes')
      .select('id, status, integracao_fundo_id, integracao:integracoes_fundo(fundo_id, provedor)')
      .eq('id', versaoId)
      .maybeSingle()
    if (!version) return result('Rascunho de integracao nao encontrado.')
    const versionData = version as { id: string; status: string; integracao_fundo_id: string; integracao: { fundo_id: string; provedor: string } | null }
    if (versionData.integracao?.fundo_id !== fundoId) return result('Versao de integracao nao pertence ao fundo informado.')
    if (versionData.integracao?.provedor !== 'fromtis') return result('Somente Portal FIDC - Sinqia e suportado nesta fase.')
    if (versionData.status !== 'rascunho') return result('Somente rascunhos podem ser editados.')

    const credentialRef = input.credentialRef.trim() || (input.credencialIntegracaoId ? `credencial:${input.credencialIntegracaoId}` : '')
    const { error } = await context.supabase
      .from('integracao_fundo_versoes')
      .update({
        ambiente: input.ambiente,
        identificador_cliente: input.identificadorCliente.trim(),
        codigo_originador: input.codigoOriginador?.trim() || null,
        endpoint_base: input.endpointBase.trim(),
        configuracao_nao_sensivel: input.configuracaoNaoSensivel || {},
        credential_ref: credentialRef,
        credencial_integracao_id: input.credencialIntegracaoId || null,
        secret_name: input.secretName?.trim() || null,
        vault_key: input.vaultKey?.trim() || null,
      } as never)
      .eq('id', versaoId)
    if (error) return result(`Erro ao atualizar rascunho da integracao: ${error.message}`)
    await registrarLog({ tipo_evento: 'INTEGRACAO_FUNDO_RASCUNHO_ATUALIZADO', entidade_tipo: 'integracao_fundo_versoes', entidade_id: versaoId, dados_depois: { fundo_id: fundoId } })
    return result('Rascunho da integracao atualizado.', true)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao atualizar rascunho da integracao.')
  }
}

export async function publicarVersaoIntegracaoFundo(fundoId: string, versaoId: string): Promise<ActionState> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await assertFundoGestor(context, fundoId)
    const { data: version } = await context.supabase
      .from('integracao_fundo_versoes')
      .select('id, versao, status, integracao_fundo_id, integracao:integracoes_fundo(fundo_id)')
      .eq('id', versaoId)
      .maybeSingle()
    if (!version) return result('Versao de integracao nao encontrada.')
    const versionData = version as { id: string; versao: number; status: string; integracao_fundo_id: string; integracao: { fundo_id: string } | null }
    if (versionData.integracao?.fundo_id !== fundoId) return result('Versao de integracao nao pertence ao fundo informado.')
    if (versionData.status === 'publicada') return result('Versao de integracao ja publicada.')

    const now = new Date().toISOString()
    const { error: closeError } = await context.supabase
      .from('integracao_fundo_versoes')
      .update({ status: 'substituida', vigente_ate: now } as never)
      .eq('integracao_fundo_id', versionData.integracao_fundo_id)
      .eq('status', 'publicada')
      .is('vigente_ate', null)
    if (closeError) return result(`Erro ao substituir integracao anterior: ${closeError.message}`)

    const { error: publishError } = await context.supabase
      .from('integracao_fundo_versoes')
      .update({ status: 'publicada', vigente_desde: now, publicada_por: context.user.id, publicada_em: now } as never)
      .eq('id', versaoId)
    if (publishError) return result(`Erro ao publicar integracao: ${publishError.message}`)

    const { error: activateError } = await context.supabase
      .from('integracoes_fundo')
      .update({ status: 'ativa' } as never)
      .eq('id', versionData.integracao_fundo_id)
    if (activateError) return result(`Versao publicada, mas integracao nao foi ativada: ${activateError.message}`)

    await registrarLog({ tipo_evento: 'INTEGRACAO_FUNDO_VERSAO_PUBLICADA', entidade_tipo: 'integracao_fundo_versoes', entidade_id: versaoId, dados_depois: { fundo_id: fundoId, versao: versionData.versao, publicada_em: now } })
    return result(`Versao ${versionData.versao} da integracao publicada.`, true)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao publicar integracao do fundo.')
  }
}

export async function desativarIntegracaoFundo(fundoId: string, integracaoId: string): Promise<ActionState> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await assertFundoGestor(context, fundoId)
    const now = new Date().toISOString()
    const { data: integracao } = await context.supabase
      .from('integracoes_fundo')
      .select('id, fundo_id, provedor')
      .eq('id', integracaoId)
      .eq('fundo_id', fundoId)
      .maybeSingle()
    if (!integracao) return result('Integracao nao encontrada no fundo informado.')
    const integracaoData = integracao as { id: string; provedor: string }
    if (integracaoData.provedor !== 'fromtis') return result('Somente Portal FIDC - Sinqia e suportado nesta fase.')

    await context.supabase
      .from('integracao_fundo_versoes')
      .update({ status: 'desativada', vigente_ate: now } as never)
      .eq('integracao_fundo_id', integracaoId)
      .in('status', ['rascunho', 'publicada'])

    const { error } = await context.supabase
      .from('integracoes_fundo')
      .update({ status: 'desativada' } as never)
      .eq('id', integracaoId)
      .eq('fundo_id', fundoId)
    if (error) return result(`Erro ao desativar integracao: ${error.message}`)
    await registrarLog({ tipo_evento: 'INTEGRACAO_FUNDO_DESATIVADA', entidade_tipo: 'integracoes_fundo', entidade_id: integracaoId, dados_depois: { fundo_id: fundoId } })
    return result('Integracao Portal FIDC desativada.', true)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao desativar integracao.')
  }
}

export async function testarConexaoIntegracaoFundo(fundoId: string, versaoId: string): Promise<ActionState<{ execucaoId: string }>> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    await assertFundoGestor(context, fundoId)
    const { data: version } = await context.supabase
      .from('integracao_fundo_versoes')
      .select('id, integracao:integracoes_fundo(fundo_id, provedor)')
      .eq('id', versaoId)
      .maybeSingle()
    const versionData = version as { integracao: { fundo_id: string; provedor: string } | null } | null
    if (versionData?.integracao?.fundo_id !== fundoId) return result('Versao de integracao nao pertence ao fundo informado.')
    if (versionData.integracao.provedor !== 'fromtis') return result('Somente Portal FIDC - Sinqia e suportado nesta fase.')
    const limited = await verificarRateLimit({ escopo: 'portal_fidc_test', identifier: `${context.user.id}:${versaoId}`, limite: 5 })
    if (!limited.allowed) return result('Muitas tentativas de teste de conexao. Aguarde antes de tentar novamente.')
    const teste = await testarConexaoPortalFidc(fundoId, versaoId)
    await registrarTentativaRateLimit({ escopo: 'portal_fidc_test', identifier: `${context.user.id}:${versaoId}`, sucesso: teste.success })
    await registrarLog({ tipo_evento: 'PORTAL_FIDC_TESTE_CONEXAO', entidade_tipo: 'integracao_fundo_versoes', entidade_id: versaoId, dados_depois: { fundo_id: fundoId, sucesso: teste.success } })
    return result(teste.message, teste.success, teste.data)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao testar conexao com o Portal FIDC.')
  }
}

export async function gerarArquivoTesteConfiguracaoCnab(fundoId: string, versaoId: string): Promise<ActionState<{ nomeArquivo: string; conteudo: string }>> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    const fundo = await assertFundoGestor(context, fundoId)
    const { data: version } = await context.supabase
      .from('configuracao_cnab_versoes')
      .select('*, config_meta:configuracoes_cnab(id, codigo, fundo_id)')
      .eq('id', versaoId)
      .maybeSingle()
    if (!version) return result('Versao CNAB nao encontrada.')
    const v = version as Record<string, unknown> & { configuracao: Record<string, unknown>; config_meta: { id: string; codigo: string; fundo_id: string } | null }
    if (v.config_meta?.fundo_id !== fundoId) return result('Versao CNAB nao pertence ao fundo informado.')

    const normalized = normalizarConfiguracaoCnabInput({
      layout: v.layout as 'cnab444',
      versaoLayout: String(v.versao_layout),
      codigoBanco: String(v.codigo_banco),
      banco: String(v.banco),
      agencia: String(v.agencia),
      conta: String(v.conta),
      digitoConta: String(v.digito_conta),
      carteira: String(v.carteira),
      convenio: String(v.convenio),
      codigoOriginador: String(v.codigo_originador),
      codigoEmpresa: String(v.codigo_empresa),
      tipoInscricao: String(v.tipo_inscricao),
      numeroInscricao: String(v.numero_inscricao),
      especieTitulo: String(v.especie_titulo),
      tipoRecebivel: String(v.tipo_recebivel),
      configuracao: v.configuracao || {},
    })

    const hash = calcularHashConfiguracaoCnab(normalized)
    const resultado = geradorCnab444.gerar({
      fundo: { id: fundo.id, nome: fundo.nome, cnpj: fundo.cnpj },
      cedente: { id: 'teste-cedente', razaoSocial: 'Cedente Teste Ltda', cnpj: '12345678000112', coobrigacao: true },
      operacoes: [{ id: '11111111-2222-3333-4444-555555555555', cedenteId: 'teste-cedente', cedenteFundoId: 'teste-vinculo', aprovadoEm: '2026-04-10T00:00:00.000Z', createdAt: '2026-04-10T00:00:00.000Z' }],
      titulos: [{ notaFiscalId: 'teste-nf', numero: '987654321', serie: '1', chaveAcesso: '35260412345678000112550010009876541000043210', dataEmissao: '2026-04-10', dataVencimento: '2026-08-15', valorFace: 1234.56, valorPresente: 1000.12, sacadoCnpj: '98765432000198', sacadoNome: 'Sacado Teste SA' }],
      conta: { banco: normalized.banco, agencia: normalized.agencia, conta: normalized.conta, digitoConta: normalized.digitoConta, carteira: normalized.carteira, convenio: normalized.convenio },
      identificadores: { dataGeracao: new Date().toISOString(), sequencial: 1, nomeArquivo: 'TESTE_CNAB444.REM' },
      configuracao: { configuracaoId: v.config_meta.id, versaoId, versao: Number(v.versao), hash, codigo: v.config_meta.codigo, ...normalized },
    })

    return result('Arquivo de teste gerado.', true, { nomeArquivo: `TESTE_CNAB444_${String(v.versao).padStart(3, '0')}.REM`, conteudo: resultado.conteudo })
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao gerar arquivo de teste CNAB.')
  }
}
