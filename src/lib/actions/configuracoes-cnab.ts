'use server'

import { requireGestor } from '@/lib/auth/authorization'
import { registrarLog } from '@/lib/actions/auditoria'
import { montarConfiguracaoLegadoParaCadastro, normalizarConfiguracaoCnabInput, validarConfiguracaoCnab } from '@/lib/cnab/resolver-configuracao'
import { calcularHashConfiguracaoCnab, type ConfiguracaoCnabResolvida } from '@/lib/cnab/domain'
import { geradorCnab444 } from '@/lib/cnab/layouts/cnab444'

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
  secretName?: string
  vaultKey?: string
  configuracaoNaoSensivel?: Record<string, unknown>
}

function validarIntegracaoInput(input: IntegracaoInput): string[] {
  const erros: string[] = []
  if (!['fromtis', 'sinqia'].includes(input.provedor)) erros.push('Provedor invalido.')
  if (!['homologacao', 'producao'].includes(input.ambiente)) erros.push('Ambiente invalido.')
  if (!input.identificadorCliente.trim()) erros.push('Identificador do cliente e obrigatorio.')
  if (!input.endpointBase.trim()) erros.push('Endpoint base e obrigatorio.')
  if (!/^https?:\/\//i.test(input.endpointBase.trim())) erros.push('Endpoint base deve iniciar com http:// ou https://.')
  if (!input.credentialRef.trim()) erros.push('Referencia de credencial e obrigatoria.')
  if (input.codigoOriginador && !/^\d{1,20}$/.test(input.codigoOriginador.trim())) erros.push('Codigo originador da integracao deve conter ate 20 digitos.')
  return erros
}

export async function criarOuAtualizarIntegracaoFundo(fundoId: string, input: IntegracaoInput): Promise<ActionState<{ integracaoId: string; versaoId: string; versao: number }>> {
  try {
    const context = await requireGestor()
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
          nome: input.provedor === 'fromtis' ? 'Fromtis' : 'Sinqia',
          status: 'rascunho',
          created_by: context.user.id,
        } as never)
        .select('id')
        .single()
      if (error || !created) return result(`Erro ao criar integracao do fundo: ${error?.message || 'registro nao retornado'}`)
      integracaoId = (created as { id: string }).id
    }

    const { data: last } = await context.supabase
      .from('integracao_fundo_versoes')
      .select('versao')
      .eq('integracao_fundo_id', integracaoId)
      .order('versao', { ascending: false })
      .limit(1)
      .maybeSingle()

    const versao = ((last as { versao: number } | null)?.versao || 0) + 1
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
        credential_ref: input.credentialRef.trim(),
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

export async function publicarVersaoIntegracaoFundo(fundoId: string, versaoId: string): Promise<ActionState> {
  try {
    const context = await requireGestor()
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

export async function gerarArquivoTesteConfiguracaoCnab(fundoId: string, versaoId: string): Promise<ActionState<{ nomeArquivo: string; conteudo: string }>> {
  try {
    const context = await requireGestor()
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
