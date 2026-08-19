import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migracaoReuso = readFileSync('supabase/migrations/20260819170000_evolucao_estabelecimentos_reuso_documental.sql', 'utf8')
const migracaoListagem = readFileSync('supabase/migrations/20260819180000_evolucao_estabelecimentos_listagem_paginada.sql', 'utf8')
const acoesEstabelecimento = readFileSync('src/lib/actions/estabelecimento.ts', 'utf8')
const meusEstabelecimentos = readFileSync('src/app/cedente/estabelecimentos/meus-estabelecimentos-client.tsx', 'utf8')
const estabelecimentosGestor = readFileSync('src/components/cedentes/EstabelecimentosGestor.tsx', 'utf8')
const listagemTipos = readFileSync('src/lib/cedentes/estabelecimentos-listagem.ts', 'utf8')
const listagemServer = readFileSync('src/lib/cedentes/estabelecimentos-listagem.server.ts', 'utf8')

describe('Evolucao de Estabelecimentos: reuso documental da Matriz (secao 2)', () => {
  it('mapeia os 4 codigos cadastrais para os equivalentes legados do onboarding, sem duplicar Storage', () => {
    expect(migracaoReuso).toContain("WHEN 'estabelecimento_cartao_cnpj' THEN 'cartao_cnpj'")
    expect(migracaoReuso).toContain("WHEN 'estabelecimento_comprovante_endereco' THEN 'comprovante_endereco'")
    expect(migracaoReuso).toContain("WHEN 'estabelecimento_contrato_social' THEN 'contrato_social'")
    expect(migracaoReuso).toContain("WHEN 'estabelecimento_comprovante_faturamento' THEN 'extrato_bancario'")
    expect(migracaoReuso).not.toContain('INSERT INTO public.documentos_repositorio')
    expect(migracaoReuso).not.toContain('storage.copy')
  })

  it('so reusa para a Matriz -- Filial nunca herda documento do onboarding', () => {
    expect(migracaoReuso).toContain("v_estab.tipo = 'matriz'")
  })

  it('origem cadastro_inicial so aparece quando nao ha upload proprio do estabelecimento', () => {
    expect(migracaoReuso).toContain("CASE WHEN dv.status IS NOT NULL THEN 'estabelecimento' WHEN legado.id IS NOT NULL THEN 'cadastro_inicial' ELSE NULL END")
  })
})

describe('Evolucao de Estabelecimentos: workflow de analise reaproveita o motor de documento_analises (secao 3)', () => {
  it('analisar_documento_estabelecimento_gestor insere em documento_analises (append-only) com o mesmo contrato semantico', () => {
    expect(migracaoReuso).toContain('INSERT INTO public.documento_analises (documento_versao_id, resultado, analisado_por, observacoes)')
    expect(migracaoReuso).toContain("p_resultado NOT IN ('aprovado', 'rejeitado', 'requer_ajuste')")
  })

  it('exige motivo para rejeicao ou ajuste, e checa acesso multifundo do gestor explicitamente', () => {
    expect(migracaoReuso).toContain("p_resultado IN ('rejeitado', 'requer_ajuste') AND length(trim(coalesce(p_observacoes, '')))")
    expect(migracaoReuso).toContain('private.gestor_tem_acesso_cedente(v_vinculo.cedente_id)')
  })
})

describe('Evolucao de Estabelecimentos: gate de aprovacao de Filial com codigos claros (secao 5)', () => {
  it('bloqueia aprovacao de Filial com codigos estaveis parseaveis pela UI', () => {
    expect(migracaoReuso).toContain('CEDENTE_INATIVO:')
    expect(migracaoReuso).toContain('MATRIZ_NAO_APROVADA:')
    expect(migracaoReuso).toContain('DOCUMENTOS_OBRIGATORIOS_PENDENTES:')
    expect(migracaoReuso).toContain('CONTA_BANCARIA_PENDENTE:')
  })

  it('gate de documentos obrigatorios ignora requisitos desativados', () => {
    expect(migracaoReuso).toContain("WHERE req.ativo AND req.obrigatorio AND req.status <> 'aprovado'")
  })

  it('gate nao se aplica a aprovacao da Matriz (mantem o fluxo de onboarding existente)', () => {
    expect(migracaoReuso).toContain("IF v_atual.tipo = 'filial' AND p_acao = 'aprovar' THEN")
  })
})

describe('Evolucao de Estabelecimentos: pendencia pos-aprovacao nao rebaixa status (secao 6)', () => {
  it('pendencia_pos_aprovacao e derivada, nao grava tabela nova', () => {
    expect(migracaoReuso).not.toContain('CREATE TABLE public.cedente_estabelecimento_pendencias')
    expect(migracaoReuso).toContain("v_estab.status = 'aprovado'")
  })

  it('configurar_requisito nao altera status/ativo do estabelecimento ao criar pendencia', () => {
    const inicio = migracaoReuso.indexOf('CREATE FUNCTION public.configurar_requisito_estabelecimento_gestor')
    const fim = migracaoReuso.indexOf('-- Gate de aprovacao de Filial')
    const corpoConfigurar = migracaoReuso.slice(inicio, fim)
    expect(corpoConfigurar).not.toContain('UPDATE public.cedente_estabelecimentos')
  })

  it('action notifica o Cedente reaproveitando o motor existente quando ha pendencia pos-aprovacao', () => {
    expect(acoesEstabelecimento).toContain('resultado.pendencia_pos_aprovacao')
    expect(acoesEstabelecimento).toContain("notificarCedente(")
    expect(acoesEstabelecimento).toContain("'estabelecimento_pendencia_pos_aprovacao'")
  })
})

describe('Evolucao de Estabelecimentos: listagem paginada sem N+1 (secoes 7, 8 e 9)', () => {
  it('RPC unica agrega e pagina no banco, sem 1 query por estabelecimento', () => {
    expect(migracaoListagem).toContain('CREATE OR REPLACE FUNCTION public.listar_estabelecimentos_pagina')
    expect(migracaoListagem).toContain('LIMIT v_page_size OFFSET')
    expect(migracaoListagem).toContain("CASE WHEN coalesce(p_page_size, 10) IN (10, 20, 40)")
  })

  it('classifica pendencia documental sem inventar tabela paralela de estado', () => {
    expect(migracaoListagem).toContain("'pendencia_pos_aprovacao'")
    expect(migracaoListagem).toContain("'conta_bancaria_pendente'")
    expect(migracaoListagem).toContain("'documentos_aguardando_analise'")
    expect(migracaoListagem).toContain("'aguardando_documentos'")
  })

  it('Matriz aparece sempre primeiro na ordenacao', () => {
    expect(migracaoListagem).toContain("ORDER BY (f.tipo = 'matriz') DESC")
  })

  it('tipos de filtro cobrem tipo, status e pendencia documental', () => {
    expect(listagemTipos).toContain("ESTABELECIMENTO_PENDENCIA_FILTRO")
    expect(listagemTipos).toContain('aguardando_documentos')
    expect(listagemTipos).toContain('documentos_aguardando_analise')
    expect(listagemTipos).toContain('pendencia_pos_aprovacao')
    expect(listagemTipos).toContain('conta_bancaria_pendente')
  })

  it('UI do Cedente usa busca com debounce, filtros e ListPagination (sem componente paralelo)', () => {
    expect(meusEstabelecimentos).toContain("from '@/components/pagination'")
    expect(meusEstabelecimentos).toContain('buildListUrl')
    expect(meusEstabelecimentos).toContain('<ListPagination')
    expect(meusEstabelecimentos).toContain('setTimeout(() => navegar({ q: busca || null, page: 1 }), 350)')
  })

  it('UI do Gestor usa a mesma RPC paginada e nao carrega tudo no primeiro render', () => {
    expect(estabelecimentosGestor).toContain('listarEstabelecimentosGestor')
    expect(estabelecimentosGestor).toContain('<ListPagination')
    expect(estabelecimentosGestor).not.toContain(".select('*').eq('cedente_id', cedenteId)")
  })

  it('detalhe (checklist/conta) e carregado sob demanda apenas ao expandir a linha', () => {
    expect(meusEstabelecimentos).toContain('carregarDetalheEstabelecimento')
    expect(meusEstabelecimentos).toContain('if (!detalhes[id])')
    expect(estabelecimentosGestor).toContain('carregarDetalheEstabelecimento')
    expect(estabelecimentosGestor).toContain('if (!detalhes[id])')
  })

  it('loader server-only nao expoe dados sem passar pela RPC com checagem de acesso', () => {
    expect(listagemServer).toContain("supabase.rpc('listar_estabelecimentos_pagina'")
    expect(listagemServer).toContain("import 'server-only'")
  })
})

describe('Evolucao de Estabelecimentos: seguranca preservada (secao 10)', () => {
  it('todas as RPCs de escrita/consulta checam acesso do Cedente ou do Gestor multifundo explicitamente', () => {
    expect(migracaoReuso).toContain('private.usuario_tem_acesso_cedente(v_estab.cedente_id)')
    expect(migracaoReuso).toContain('private.gestor_tem_acesso_cedente(v_estab.cedente_id)')
    expect(migracaoListagem).toContain('private.usuario_tem_acesso_cedente(p_cedente_id)')
    expect(migracaoListagem).toContain('private.gestor_tem_acesso_cedente(p_cedente_id)')
  })

  it('funcoes revogam PUBLIC e concedem apenas a authenticated', () => {
    expect(migracaoReuso).toContain('REVOKE ALL ON FUNCTION public.listar_requisitos_estabelecimento(uuid) FROM PUBLIC')
    expect(migracaoReuso).toContain('REVOKE ALL ON FUNCTION public.analisar_documento_estabelecimento_gestor(uuid, text, text) FROM PUBLIC')
    expect(migracaoListagem).toContain('REVOKE ALL ON FUNCTION public.listar_estabelecimentos_pagina')
  })

  it('frontend nunca envia cedente_id/analisado_por/status final -- server actions derivam do contexto autenticado', () => {
    expect(acoesEstabelecimento).not.toContain("formData.get('cedente_id')")
    expect(acoesEstabelecimento).not.toContain("formData.get('analisado_por')")
    expect(acoesEstabelecimento).not.toContain("formData.get('status')")
  })
})
