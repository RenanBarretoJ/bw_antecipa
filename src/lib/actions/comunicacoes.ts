'use server'

import { requireGestor } from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { registrarLog } from '@/lib/actions/auditoria'
import {
  executarMotorComunicacoes,
  enviarTesteComunicacao,
  templatesPadraoParaPersistencia,
} from '@/lib/comunicacoes/motor.server'
import {
  criarGrupoPreview,
  hashTemplate,
  obterTemplatePadrao,
  renderizarComunicacao,
  validarTemplate,
  type TemplateComunicacao,
} from '@/lib/comunicacoes/templates'
import {
  COMUNICACAO_CATEGORIAS,
  type ComunicacaoCategoria,
  type ReguaComunicacao,
} from '@/lib/comunicacoes/tipos'

type ActionResult<T = unknown> = { success: boolean; message: string; data?: T }

export type ComunicacaoTemplateForm = {
  categoria: ComunicacaoCategoria
  modo: 'padrao' | 'personalizado'
  assunto: string
  corpoHtml: string
  corpoTexto: string
}

export type ComunicacaoConfiguracaoForm = {
  versaoId: string
  logisticaHabilitada: boolean
  cteHabilitado: boolean
  comprovanteHabilitado: boolean
  financeiroHabilitado: boolean
  reguaLogistica: ReguaComunicacao
  reguaFinanceira: ReguaComunicacao
  templates: ComunicacaoTemplateForm[]
}

function ok<T>(message: string, data?: T): ActionResult<T> {
  return { success: true, message, data }
}

function fail<T = never>(message: string): ActionResult<T> {
  return { success: false, message }
}

function mensagemSegura(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback
  if (/acesso|sess[aã]o|mfa|fundo|rascunho|template|regra|e-mail/i.test(error.message)) return error.message
  return fallback
}

function validarRegua(regua: ReguaComunicacao, nome: string): ReguaComunicacao {
  const offsets = [...new Set(regua.offsets.map(Number))].filter(Number.isInteger).sort((a, b) => a - b)
  if (!offsets.length || offsets.some((offset) => Math.abs(offset) > 365)) throw new Error(`${nome}: informe etapas entre D-365 e D+365.`)
  const recorrenciaApos = Number(regua.recorrenciaApos)
  const recorrenciaDias = Number(regua.recorrenciaDias)
  if (!Number.isInteger(recorrenciaApos) || recorrenciaApos < 0 || recorrenciaApos > 365) throw new Error(`${nome}: inicio da recorrencia invalido.`)
  if (!Number.isInteger(recorrenciaDias) || recorrenciaDias < 1 || recorrenciaDias > 90) throw new Error(`${nome}: intervalo recorrente deve estar entre 1 e 90 dias.`)
  return { offsets, recorrenciaApos, recorrenciaDias }
}

async function validarFundoDoGestor(fundoId: string) {
  const context = await requireGestor()
  const { data, error } = await context.supabase.from('fundos').select('id, nome, gestora_nome, ativo').eq('id', fundoId).maybeSingle()
  if (error || !data) throw new Error('Fundo nao encontrado ou nao autorizado para o gestor atual.')
  if (data.ativo === false) throw new Error('A configuracao de comunicacoes exige um fundo ativo.')
  return { context, fundo: data as { id: string; nome: string; gestora_nome: string; ativo: boolean } }
}

export async function carregarComunicacoesDoFundo(fundoId: string) {
  const { context, fundo } = await validarFundoDoGestor(fundoId)
  const { data: root, error: rootError } = await context.supabase
    .from('comunicacao_configuracoes')
    .select('*')
    .eq('fundo_id', fundoId)
    .maybeSingle()
  if (rootError) throw new Error('Nao foi possivel carregar a configuracao de comunicacoes.')

  const { data: versions, error: versionError } = await context.supabase
    .from('comunicacao_configuracao_versoes')
    .select('*')
    .eq('fundo_id', fundoId)
    .order('numero_versao', { ascending: false })
  if (versionError) throw new Error('Nao foi possivel carregar as versoes da configuracao.')

  const versionIds = (versions || []).map((row) => row.id)
  const { data: templates, error: templateError } = versionIds.length
    ? await context.supabase.from('comunicacao_template_versoes').select('*').in('configuracao_versao_id', versionIds)
    : { data: [], error: null }
  if (templateError) throw new Error('Nao foi possivel carregar os templates de comunicacao.')

  const { data: history, error: historyError } = await context.supabase
    .from('comunicacoes')
    .select('id, familia, categoria, status, destinatario_nome, destinatario_email, assunto, data_efetiva, bloqueio_motivo, criada_em, enviada_em')
    .eq('fundo_id', fundoId)
    .order('criada_em', { ascending: false })
    .limit(50)
  if (historyError) throw new Error('Nao foi possivel carregar o historico de comunicacoes.')

  return {
    fundo,
    root,
    versions: versions || [],
    templates: templates || [],
    history: history || [],
    templateDefaults: Object.fromEntries(COMUNICACAO_CATEGORIAS.map((categoria) => [categoria, obterTemplatePadrao(categoria)])),
  }
}

export async function criarRascunhoComunicacoes(fundoId: string, baseVersaoId?: string | null): Promise<ActionResult<{ versaoId: string }>> {
  try {
    const { context } = await validarFundoDoGestor(fundoId)
    const defaults = templatesPadraoParaPersistencia().map((item) => ({ categoria: item.categoria, conteudo_hash: item.hash }))
    const { data, error } = await context.supabase.rpc('criar_rascunho_configuracao_comunicacoes', {
      p_fundo_id: fundoId,
      p_base_versao_id: baseVersaoId || null,
      p_templates_padrao: defaults,
    })
    if (error || !data) return fail('Nao foi possivel criar o rascunho da configuracao.')
    await registrarLog({ tipo_evento: 'COMUNICACAO_CONFIGURACAO_RASCUNHO_CRIADO', entidade_tipo: 'comunicacao_configuracao_versoes', entidade_id: data, dados_depois: { fundo_id: fundoId, base_versao_id: baseVersaoId || null } })
    return ok('Rascunho de comunicacoes criado.', { versaoId: data })
  } catch (error) {
    return fail(mensagemSegura(error, 'Nao foi possivel criar o rascunho da configuracao.'))
  }
}

export async function salvarRascunhoComunicacoes(fundoId: string, form: ComunicacaoConfiguracaoForm): Promise<ActionResult> {
  try {
    const { context } = await validarFundoDoGestor(fundoId)
    const logistica = validarRegua(form.reguaLogistica, 'Regua logistica')
    const financeira = validarRegua(form.reguaFinanceira, 'Regua financeira')
    const templates = new Map(form.templates.map((template) => [template.categoria, template]))
    if (templates.size !== COMUNICACAO_CATEGORIAS.length) return fail('Os sete templates da configuracao sao obrigatorios.')

    for (const categoria of COMUNICACAO_CATEGORIAS) {
      const item = templates.get(categoria)
      if (!item) return fail(`Template ${categoria} nao informado.`)
      if (item.modo === 'personalizado') {
        validarTemplate({ assunto: item.assunto, html: item.corpoHtml, texto: item.corpoTexto }, categoria.startsWith('LOGISTICA') ? 'LOGISTICA' : 'FINANCEIRO')
      }
    }

    const { data: version, error: loadError } = await context.supabase
      .from('comunicacao_configuracao_versoes')
      .select('id, status')
      .eq('id', form.versaoId)
      .eq('fundo_id', fundoId)
      .maybeSingle()
    if (loadError || !version || version.status !== 'rascunho') return fail('Rascunho nao encontrado ou ja publicado.')

    const { error: updateError } = await context.supabase
      .from('comunicacao_configuracao_versoes')
      .update({
        logistica_habilitada: form.logisticaHabilitada,
        cte_habilitado: form.cteHabilitado,
        comprovante_habilitado: form.comprovanteHabilitado,
        financeiro_habilitado: form.financeiroHabilitado,
        regua_logistica: { offsets: logistica.offsets, recorrencia_apos: logistica.recorrenciaApos, recorrencia_dias: logistica.recorrenciaDias },
        regua_financeira: { offsets: financeira.offsets, recorrencia_apos: financeira.recorrenciaApos, recorrencia_dias: financeira.recorrenciaDias },
        atualizada_em: new Date().toISOString(),
      })
      .eq('id', form.versaoId)
      .eq('fundo_id', fundoId)
      .eq('status', 'rascunho')
    if (updateError) return fail('Nao foi possivel salvar as reguas da configuracao.')

    for (const categoria of COMUNICACAO_CATEGORIAS) {
      const item = templates.get(categoria)!
      const content: TemplateComunicacao = item.modo === 'padrao'
        ? obterTemplatePadrao(categoria)
        : { assunto: item.assunto.trim(), html: item.corpoHtml.trim(), texto: item.corpoTexto.trim() }
      const { error } = await context.supabase
        .from('comunicacao_template_versoes')
        .update({
          modo: item.modo,
          assunto: item.modo === 'personalizado' ? content.assunto : null,
          corpo_html: item.modo === 'personalizado' ? content.html : null,
          corpo_texto: item.modo === 'personalizado' ? content.texto : null,
          conteudo_hash: hashTemplate(content),
        })
        .eq('configuracao_versao_id', form.versaoId)
        .eq('fundo_id', fundoId)
        .eq('categoria', categoria)
      if (error) return fail(`Nao foi possivel salvar o template ${categoria}.`)
    }

    await registrarLog({ tipo_evento: 'COMUNICACAO_CONFIGURACAO_RASCUNHO_ATUALIZADO', entidade_tipo: 'comunicacao_configuracao_versoes', entidade_id: form.versaoId, dados_depois: { fundo_id: fundoId, logistica: form.logisticaHabilitada, financeiro: form.financeiroHabilitado } })
    return ok('Rascunho salvo.')
  } catch (error) {
    return fail(mensagemSegura(error, 'Nao foi possivel salvar a configuracao.'))
  }
}

export async function publicarRascunhoComunicacoes(fundoId: string, versaoId: string): Promise<ActionResult> {
  try {
    const { context } = await validarFundoDoGestor(fundoId)
    await exigirSessaoElevada(context)
    const { data, error } = await context.supabase.rpc('publicar_configuracao_comunicacoes', { p_versao_id: versaoId })
    if (error || !data) return fail('Nao foi possivel publicar a configuracao de comunicacoes.')
    await registrarLog({ tipo_evento: 'COMUNICACAO_CONFIGURACAO_PUBLICADA', entidade_tipo: 'comunicacao_configuracao_versoes', entidade_id: versaoId, dados_depois: { fundo_id: fundoId, numero_versao: data.numero_versao } })
    return ok('Configuracao publicada. A ativacao nao gera comunicacoes retroativas anteriores ao inicio da regua.')
  } catch (error) {
    return fail(mensagemSegura(error, 'Nao foi possivel publicar a configuracao de comunicacoes.'))
  }
}

export async function alterarPausaComunicacoes(fundoId: string, pausada: boolean): Promise<ActionResult> {
  try {
    const { context } = await validarFundoDoGestor(fundoId)
    await exigirSessaoElevada(context)
    const { error } = await context.supabase.from('comunicacao_configuracoes').update({ pausada, atualizada_em: new Date().toISOString() }).eq('fundo_id', fundoId)
    if (error) return fail('Nao foi possivel alterar a pausa emergencial.')
    await registrarLog({ tipo_evento: pausada ? 'COMUNICACOES_PAUSADAS' : 'COMUNICACOES_RETOMADAS', entidade_tipo: 'fundos', entidade_id: fundoId, dados_depois: { pausada } })
    return ok(pausada ? 'Novas comunicacoes foram pausadas.' : 'Processamento de novas comunicacoes retomado.')
  } catch (error) {
    return fail(mensagemSegura(error, 'Nao foi possivel alterar a pausa emergencial.'))
  }
}

export async function gerarPreviewComunicacao(fundoId: string, versaoId: string, categoria: ComunicacaoCategoria) {
  const { context } = await validarFundoDoGestor(fundoId)
  const { data, error } = await context.supabase
    .from('comunicacao_template_versoes')
    .select('*')
    .eq('configuracao_versao_id', versaoId)
    .eq('fundo_id', fundoId)
    .eq('categoria', categoria)
    .maybeSingle()
  if (error || !data) throw new Error('Template nao encontrado para o preview.')
  const template = data.modo === 'personalizado'
    ? { assunto: data.assunto || '', html: data.corpo_html || '', texto: data.corpo_texto || '' }
    : obterTemplatePadrao(categoria)
  const group = { ...criarGrupoPreview(categoria.startsWith('LOGISTICA') ? 'LOGISTICA' as const : 'FINANCEIRO' as const), categoria }
  return renderizarComunicacao(group, template)
}

export async function executarDryRunComunicacoes(fundoId: string): Promise<ActionResult> {
  try {
    await validarFundoDoGestor(fundoId)
    const result = await executarMotorComunicacoes({ dryRun: true, fundoId })
    return ok('Simulacao concluida sem persistencia e sem envio.', {
      dataReferencia: result.dataReferencia,
      encontradas: result.encontradas,
      agrupadas: result.agrupadas,
      bloqueadas: result.bloqueadas,
    })
  } catch (error) {
    return fail(mensagemSegura(error, 'Nao foi possivel executar a simulacao.'))
  }
}

export async function enviarEmailTesteComunicacoes(fundoId: string, familia: 'LOGISTICA' | 'FINANCEIRO'): Promise<ActionResult> {
  try {
    const { context, fundo } = await validarFundoDoGestor(fundoId)
    await exigirSessaoElevada(context)
    const result = await enviarTesteComunicacao({ familia, email: context.profile.email, gestoraNome: fundo.gestora_nome })
    if (!result.success) return fail(result.errorMessage || 'Nao foi possivel enviar o e-mail de teste.')
    await registrarLog({ tipo_evento: 'COMUNICACAO_EMAIL_TESTE_ENVIADO', entidade_tipo: 'fundos', entidade_id: fundoId, dados_depois: { familia, destinatario: 'gestor_autenticado' } })
    return ok(`E-mail de teste enviado para ${context.profile.email}.`)
  } catch (error) {
    return fail(mensagemSegura(error, 'Nao foi possivel enviar o e-mail de teste.'))
  }
}

export async function carregarHistoricoComunicacoes(input: { fundoId?: string; status?: string; familia?: string; limite?: number } = {}) {
  const context = await requireGestor()
  let query = context.supabase
    .from('comunicacoes')
    .select('id, fundo_id, familia, categoria, status, destinatario_nome, destinatario_email, assunto, data_efetiva, bloqueio_motivo, criada_em, enviada_em')
    .order('criada_em', { ascending: false })
    .limit(Math.min(Math.max(input.limite || 100, 1), 200))
  if (input.fundoId) query = query.eq('fundo_id', input.fundoId)
  if (input.status) query = query.eq('status', input.status as 'PENDENTE' | 'PROCESSANDO' | 'ENVIADA' | 'FALHA' | 'BLOQUEADA' | 'CANCELADA')
  if (input.familia) query = query.eq('familia', input.familia as 'LOGISTICA' | 'FINANCEIRO')
  const { data, error } = await query
  if (error) throw new Error('Nao foi possivel carregar o historico de comunicacoes.')
  return data || []
}
