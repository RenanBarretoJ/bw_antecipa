'use server'

import fs from 'fs'
import path from 'path'
import { requireGestor } from '@/lib/auth/authorization'
import { exigirSessaoElevada } from '@/lib/auth/mfa'
import { registrarLog } from '@/lib/actions/auditoria'
import {
  calcularSha256Canonico,
  renderizarTemplate,
  sanitizarTemplateHtml,
  SCHEMAS_POR_TIPO,
  TEMPLATE_TIPOS,
  validarVariaveisTemplate,
  type TemplateTipoDocumento,
  type TemplateVariaveisSchema,
} from '@/lib/templates/resolver-template'
import { TEMPLATE_DOCUMENT_TYPES } from '@/lib/types/domain'

type TemplateActionState<T = unknown> = { success: boolean; message: string; data?: T }

function result<T = unknown>(message: string, success = false, data?: T): TemplateActionState<T> {
  return { success, message, data }
}

function assertTemplateType(value: string): TemplateTipoDocumento {
  if (!TEMPLATE_DOCUMENT_TYPES.includes(value as TemplateTipoDocumento)) throw new Error('Tipo de documento invalido.')
  return value as TemplateTipoDocumento
}

function assertCodigo(value: string): string {
  const codigo = value.trim()
  if (!codigo) throw new Error('Codigo do template e obrigatorio.')
  if (!/^[a-z0-9_-]+$/.test(codigo)) throw new Error('Codigo deve conter apenas letras minusculas, numeros, hifen ou underline.')
  return codigo
}

function caminhoTemplateLocal(arquivo: string): string {
  return path.join(process.cwd(), 'src', 'templates', 'contratos', arquivo)
}

async function validarFundoAtivo(supabase: Awaited<ReturnType<typeof requireGestor>>['supabase'], fundoId: string) {
  const { data: fundo, error } = await supabase
    .from('fundos')
    .select('id, ativo')
    .eq('id', fundoId)
    .maybeSingle()
  if (error || !fundo) throw new Error('Fundo nao encontrado.')
  if ((fundo as { ativo: boolean | null }).ativo === false) throw new Error('Templates so podem ser administrados para fundos ativos.')
}

async function validarTemplateDoFundo(supabase: Awaited<ReturnType<typeof requireGestor>>['supabase'], fundoId: string, templateId: string) {
  await validarFundoAtivo(supabase, fundoId)
  const { data: template, error } = await supabase
    .from('templates_documentos')
    .select('id, fundo_id')
    .eq('id', templateId)
    .eq('fundo_id', fundoId)
    .maybeSingle()
  if (error || !template) throw new Error('Template nao encontrado no fundo informado.')
}

async function validarVersaoTemplateDoFundo(supabase: Awaited<ReturnType<typeof requireGestor>>['supabase'], fundoId: string, versaoId: string) {
  await validarFundoAtivo(supabase, fundoId)
  const { data: versao, error } = await supabase
    .from('template_versoes')
    .select('id, template:templates_documentos(id, fundo_id)')
    .eq('id', versaoId)
    .maybeSingle()
  const versionData = versao as unknown as { template: { fundo_id: string } | null } | null
  if (error || versionData?.template?.fundo_id !== fundoId) throw new Error('Versao do template nao pertence ao fundo informado.')
}

export async function criarTemplateDocumento(input: {
  fundoId: string
  codigo: string
  tipoDocumento: string
  nome: string
  descricao?: string
}): Promise<TemplateActionState<{ id: string }>> {
  try {
    const context = await requireGestor()
    await validarFundoAtivo(context.supabase, input.fundoId)
    const tipoDocumento = assertTemplateType(input.tipoDocumento)
    const codigo = assertCodigo(input.codigo)
    const nome = input.nome.trim()
    if (!nome) return result('Nome do template e obrigatorio.')

    const { data, error } = await context.supabase
      .from('templates_documentos')
      .insert({
        fundo_id: input.fundoId,
        codigo,
        tipo_documento: tipoDocumento,
        nome,
        descricao: input.descricao?.trim() || null,
        status: 'rascunho',
        created_by: context.user.id,
      })
      .select('id')
      .single()

    if (error || !data) return result(`Erro ao criar template: ${error?.message || 'registro nao retornado'}`)
    await registrarLog({
      tipo_evento: 'TEMPLATE_JURIDICO_CRIADO',
      entidade_tipo: 'templates_documentos',
      entidade_id: (data as { id: string }).id,
      dados_depois: { fundo_id: input.fundoId, codigo, tipo_documento: tipoDocumento },
    })
    return result('Template criado como rascunho.', true, { id: (data as { id: string }).id })
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao criar template.')
  }
}

export async function criarVersaoTemplate(input: {
  templateId: string
  conteudoHtml: string
  vigenteDesde?: string
  variaveisSchema?: TemplateVariaveisSchema
}): Promise<TemplateActionState<{ id: string; versao: number }>> {
  try {
    const context = await requireGestor()
    const { data: template, error: templateError } = await context.supabase
      .from('templates_documentos')
      .select('id, tipo_documento, status')
      .eq('id', input.templateId)
      .maybeSingle()

    if (templateError || !template) return result('Template nao encontrado.')
    const templateData = template as { id: string; tipo_documento: TemplateTipoDocumento; status: string }
    if (templateData.status === 'desativado') return result('Nao e possivel criar versao para template desativado.')

    const schema = input.variaveisSchema || SCHEMAS_POR_TIPO[templateData.tipo_documento]
    const html = sanitizarTemplateHtml(input.conteudoHtml)
    validarVariaveisTemplate(html, schema, montarDadosPreview(templateData.tipo_documento))

    const { data: last } = await context.supabase
      .from('template_versoes')
      .select('versao')
      .eq('template_id', input.templateId)
      .order('versao', { ascending: false })
      .limit(1)
      .maybeSingle()

    const versao = ((last as { versao: number } | null)?.versao || 0) + 1
    const { data, error } = await context.supabase
      .from('template_versoes')
      .insert({
        template_id: input.templateId,
        versao,
        vigente_desde: input.vigenteDesde || new Date().toISOString(),
        conteudo_html: html,
        variaveis_schema: schema as Record<string, unknown>,
        sha256: calcularSha256Canonico(html),
        status: 'rascunho',
      })
      .select('id')
      .single()

    if (error || !data) return result(`Erro ao criar versao: ${error?.message || 'registro nao retornado'}`)
    await registrarLog({
      tipo_evento: 'TEMPLATE_JURIDICO_VERSAO_CRIADA',
      entidade_tipo: 'template_versoes',
      entidade_id: (data as { id: string }).id,
      dados_depois: { template_id: input.templateId, versao },
    })
    return result(`Versao ${versao} criada como rascunho.`, true, { id: (data as { id: string }).id, versao })
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao criar versao.')
  }
}

export async function criarVersaoTemplateNoFundo(fundoId: string, input: {
  templateId: string
  conteudoHtml: string
  vigenteDesde?: string
  variaveisSchema?: TemplateVariaveisSchema
}): Promise<TemplateActionState<{ id: string; versao: number }>> {
  try {
    const context = await requireGestor()
    await validarTemplateDoFundo(context.supabase, fundoId, input.templateId)
    return criarVersaoTemplate(input)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao criar versao.')
  }
}

export async function publicarVersaoTemplate(versaoId: string): Promise<TemplateActionState> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    const { data: versao } = await context.supabase
      .from('template_versoes')
      .select('id, template_id, versao, status, conteudo_html, variaveis_schema, template:templates_documentos(id, tipo_documento)')
      .eq('id', versaoId)
      .maybeSingle()

    if (!versao) return result('Versao nao encontrada.')
    const versionData = versao as unknown as {
      id: string
      template_id: string
      versao: number
      status: string
      conteudo_html: string
      variaveis_schema: TemplateVariaveisSchema
      template: { id: string; tipo_documento: TemplateTipoDocumento } | null
    }
    if (versionData.status === 'publicada') return result('Esta versao ja esta publicada.')
    if (!versionData.template) return result('Template da versao nao encontrado.')

    validarVariaveisTemplate(
      versionData.conteudo_html,
      versionData.variaveis_schema || SCHEMAS_POR_TIPO[versionData.template.tipo_documento],
      montarDadosPreview(versionData.template.tipo_documento),
    )

    const now = new Date().toISOString()
    const { error: closeError } = await context.supabase
      .from('template_versoes')
      .update({ status: 'substituida', vigente_ate: now } as never)
      .eq('template_id', versionData.template_id)
      .eq('status', 'publicada')
      .is('vigente_ate', null)

    if (closeError) return result(`Erro ao substituir versao anterior: ${closeError.message}`)

    const { error: publishError } = await context.supabase
      .from('template_versoes')
      .update({
        status: 'publicada',
        vigente_desde: now,
        publicada_por: context.user.id,
        publicada_em: now,
      } as never)
      .eq('id', versaoId)

    if (publishError) return result(`Erro ao publicar versao: ${publishError.message}`)

    const { error: templateError } = await context.supabase
      .from('templates_documentos')
      .update({ status: 'ativo' } as never)
      .eq('id', versionData.template_id)

    if (templateError) return result(`Versao publicada, mas o template nao foi ativado: ${templateError.message}`)
    await registrarLog({
      tipo_evento: 'TEMPLATE_JURIDICO_VERSAO_PUBLICADA',
      entidade_tipo: 'template_versoes',
      entidade_id: versaoId,
      dados_depois: { template_id: versionData.template_id, versao: versionData.versao, publicada_em: now },
    })
    return result(`Versao ${versionData.versao} publicada.`, true)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao publicar versao.')
  }
}

export async function publicarVersaoTemplateNoFundo(fundoId: string, versaoId: string): Promise<TemplateActionState> {
  try {
    const context = await requireGestor()
    await validarVersaoTemplateDoFundo(context.supabase, fundoId, versaoId)
    return publicarVersaoTemplate(versaoId)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao publicar versao.')
  }
}

export async function desativarTemplateDocumento(templateId: string): Promise<TemplateActionState> {
  try {
    const context = await requireGestor()
    await exigirSessaoElevada(context)
    const { error } = await context.supabase
      .from('templates_documentos')
      .update({ status: 'desativado' } as never)
      .eq('id', templateId)
    if (error) return result(`Erro ao desativar template: ${error.message}`)
    await registrarLog({
      tipo_evento: 'TEMPLATE_JURIDICO_DESATIVADO',
      entidade_tipo: 'templates_documentos',
      entidade_id: templateId,
      dados_depois: { status: 'desativado' },
    })
    return result('Template desativado.', true)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao desativar template.')
  }
}

export async function desativarTemplateDocumentoNoFundo(fundoId: string, templateId: string): Promise<TemplateActionState> {
  try {
    const context = await requireGestor()
    await validarTemplateDoFundo(context.supabase, fundoId, templateId)
    return desativarTemplateDocumento(templateId)
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao desativar template.')
  }
}

export async function importarTemplatesLocaisParaFundo(fundoId: string): Promise<TemplateActionState<{ criados: number; ignorados: number }>> {
  try {
    const context = await requireGestor()
    await validarFundoAtivo(context.supabase, fundoId)

    let criados = 0
    let ignorados = 0
    for (const item of TEMPLATE_TIPOS) {
      const { data: existing, error: existingError } = await context.supabase
        .from('templates_documentos')
        .select('id, template_versoes(id)')
        .eq('fundo_id', fundoId)
        .eq('codigo', item.codigo)
        .maybeSingle()
      if (existingError) return result(`Erro ao verificar template ${item.codigo}: ${existingError.message}`)

      let templateId = (existing as { id?: string } | null)?.id
      if (!templateId) {
        const { data: created, error } = await context.supabase
          .from('templates_documentos')
          .insert({
            fundo_id: fundoId,
            codigo: item.codigo,
            tipo_documento: item.tipo,
            nome: item.nome,
            descricao: 'Importado a partir do template local versionado no repositório.',
            status: 'rascunho',
            created_by: context.user.id,
          })
          .select('id')
          .single()
        if (error || !created) return result(`Erro ao criar template ${item.codigo}: ${error?.message || 'registro nao retornado'}`)
        templateId = (created as { id: string }).id
      } else if (((existing as { template_versoes?: unknown[] }).template_versoes || []).length > 0) {
        ignorados += 1
        continue
      }

      const html = fs.readFileSync(caminhoTemplateLocal(item.arquivo), 'utf8')
      const schema = SCHEMAS_POR_TIPO[item.tipo]
      sanitizarTemplateHtml(html)
      validarVariaveisTemplate(html, schema, montarDadosPreview(item.tipo))

      const { error: versionError } = await context.supabase
        .from('template_versoes')
        .insert({
          template_id: templateId,
          versao: 1,
          vigente_desde: new Date().toISOString(),
          conteudo_html: html,
          variaveis_schema: schema as Record<string, unknown>,
          sha256: calcularSha256Canonico(html),
          status: 'rascunho',
        } as never)

      if (versionError) return result(`Erro ao importar versao do template ${item.codigo}: ${versionError.message}`)
      criados += 1
    }

    await registrarLog({
      tipo_evento: 'TEMPLATES_JURIDICOS_LOCAIS_IMPORTADOS',
      entidade_tipo: 'fundos',
      entidade_id: fundoId,
      dados_depois: { criados, ignorados },
    })
    return result(`${criados} templates importados. ${ignorados} ja existiam com versao.`, true, { criados, ignorados })
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao importar templates locais.')
  }
}

export async function previewTemplateHtml(input: {
  tipoDocumento: string
  conteudoHtml: string
  variaveisSchema?: TemplateVariaveisSchema
}): Promise<TemplateActionState<{ html: string }>> {
  try {
    await requireGestor()
    const tipoDocumento = assertTemplateType(input.tipoDocumento)
    const schema = input.variaveisSchema || SCHEMAS_POR_TIPO[tipoDocumento]
    const html = renderizarTemplate(input.conteudoHtml, schema, montarDadosPreview(tipoDocumento))
    return result('Preview gerado.', true, {
      html: `${watermarkPreview()}${html}`,
    })
  } catch (error) {
    return result(error instanceof Error ? error.message : 'Erro ao gerar preview.')
  }
}

function watermarkPreview() {
  return '<div style="position:fixed;top:14px;right:14px;z-index:9999;padding:6px 10px;border:1px solid #d97706;border-radius:999px;background:rgba(254,243,199,.94);color:#92400e;font:700 11px Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase">Preview sem validade jurídica</div>'
}

function montarDadosPreview(tipoDocumento: TemplateTipoDocumento): Record<string, unknown> {
  const base = {
    cedente: {
      razao_social: 'EMPRESA EXEMPLO LTDA',
      cnpj: '00.000.000/0001-00',
      logradouro: 'Avenida Exemplo',
      numero: '100',
      complemento: 'Sala 01',
      bairro: 'Centro',
      cidade: 'Sao Paulo',
      estado: 'SP',
      cep: '00000-000',
      telefone: '(11) 99999-0000',
      email: 'financeiro@exemplo.com.br',
      rep_legal_nome: 'Representante Exemplo',
      banco: '001',
      agencia: '0001',
      conta: '12345-6',
    },
    contrato: {
      data_assinatura_extenso: '21 de julho de 2026',
    },
    termo: {
      numero: 'ABC12345',
      data_extenso: '21 de julho de 2026',
      preco_aquisicao_formatado: 'R$ 100.000,00',
      solicitacao_data: '21/07/2026 10:00:00',
      quantidade: 1,
      total_face_formatado: 'R$ 120.000,00',
    },
    quitacao: {
      numero: 'ABC12345',
      data_extenso: '21 de julho de 2026',
      data_pagamento: '21/07/2026',
      total_pago: '120.000,00',
      total_pago_extenso: 'cento e vinte mil reais',
      total_face: '120.000,00',
      qtd_nf: 1,
    },
    notas_fiscais: [{
      numero: '123',
      sacado_cnpj: '11.111.111/0001-11',
      data_emissao_formatada: '01/07/2026',
      data_vencimento_formatada: '31/07/2026',
      valor_face_formatado: 'R$ 120.000,00',
      taxa_desagio: '3.99',
      valor_antecipado_formatado: 'R$ 100.000,00',
      id_curto: 'NF123456',
      inclusao_data: '01/07/2026 10:00:00',
      aprovacao_gestor_data: '02/07/2026 10:00:00',
      aceite_sacado_data: 'dispensado',
      aprovacao_final_gestor_data: '03/07/2026 10:00:00',
      data_pagamento_formatada: '21/07/2026',
      valor_pago_formatado: '120.000,00',
    }],
    testemunha_1: { nome: 'Testemunha Um', cpf: '111.111.111-11' },
    testemunha_2: { nome: 'Testemunha Dois', cpf: '222.222.222-22' },
  }

  const allowed = SCHEMAS_POR_TIPO[tipoDocumento].variaveis || {}
  return Object.fromEntries(Object.keys(allowed).map((key) => [key, base[key as keyof typeof base]]))
}
