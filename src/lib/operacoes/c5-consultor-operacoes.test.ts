import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseFiltrosOperacoes } from './listagem'

const migration = readFileSync(
  'supabase/migrations/20260925212843_c5_r2_organizational_operations_view.sql',
  'utf8',
)
const listagemServer = readFileSync('src/lib/operacoes/listagem.server.ts', 'utf8')
const listagemUi = readFileSync('src/components/operacoes/OperacoesPaginadas.tsx', 'utf8')
const detalheConsultor = readFileSync('src/app/consultor/operacoes/[id]/page.tsx', 'utf8')
const detalheCompartilhado = readFileSync('src/app/cedente/operacoes/[id]/page.tsx', 'utf8')
const authorization = readFileSync('src/lib/auth/authorization.ts', 'utf8')
const historico = readFileSync('src/lib/actions/historico.ts', 'utf8')

describe('C5 - acompanhamento read-only de operacoes pelo Consultor', () => {
  it('combina filtros server-side com valores normalizados e allowlists', () => {
    const cedenteId = '00000000-0000-4000-8000-0000000000a1'
    const fundoId = '00000000-0000-4000-8000-0000000000f1'
    const filtros = parseFiltrosOperacoes({
      cedente: cedenteId,
      fundo: fundoId,
      status: 'reprovada',
      solicitadoDe: '2026-09-01',
      solicitadoAte: '2026-09-25',
      sort: 'updated_at',
      direction: 'asc',
    })

    expect(filtros).toMatchObject({
      cedenteId,
      fundoId,
      status: 'reprovada',
      solicitadoDe: '2026-09-01',
      solicitadoAte: '2026-09-25',
      ordenacao: 'updated_at',
      direcao: 'asc',
    })
    expect(parseFiltrosOperacoes({ cedente: 'invalido', fundo: 'invalido' })).toMatchObject({
      cedenteId: null,
      fundoId: null,
    })
  })

  it('pagina no servidor e enriquece a pagina sem N+1', () => {
    expect(listagemServer).toContain(".from('operacoes').select(SELECT_OPERACOES, { count: 'exact' })")
    expect(listagemServer).toContain('.range(range.from, range.to)')
    expect(listagemServer).toContain("client.from('operacoes_nfs').select('operacao_id').in('operacao_id', operacaoIds)")
    expect(listagemServer).toContain("client.from('cedente_fundos').select('id,fundo_id').in('id', vinculoIds)")
    expect(listagemServer).not.toMatch(/for \([^)]*rows[^)]*\)[\s\S]{0,250}await client/u)
  })

  it('usa o predicate organizacional de leitura e o Fundo da propria operacao no RLS', () => {
    expect(migration).toContain('private.consultor_usuario_pode_visualizar_operacao')
    expect(migration).toContain('private.consultor_usuario_pode_visualizar_cedente_fundo')
    expect(migration).toContain("cu.papel IN ('OWNER', 'ADMIN', 'OPERADOR', 'LEITOR')")
    expect(migration).toContain('cf.id = p_cedente_fundo_id')
    expect(migration).toContain('cf.cedente_id = c.id')
    expect(migration).toContain('cfu.fundo_id = cf.fundo_id')
    expect(migration).toContain("cf.status = 'ativo'")
    expect(migration).toContain('coalesce(f.ativo, true) = true')
    expect(migration).toContain('operacoes_consultor_select')
    expect(migration).toContain('operacoes_nfs_consultor_select')
  })

  it('concede somente leitura C5 e filtra a timeline como visivel ao Cedente', () => {
    expect(migration).toContain('eventos_dominio_consultor_select')
    expect(migration).toContain("eventos_dominio.visibilidade IN ('cedente', 'ambos')")
    expect(historico).toContain("if (role === 'consultor') query = query.in('visibilidade', ['cedente', 'ambos'])")
    expect(migration).not.toMatch(/CREATE POLICY\s+\w*c5\w*\s+[\s\S]{0,100}?FOR\s+(INSERT|UPDATE|DELETE|ALL)/iu)
  })

  it('mantem o papel LEITOR sem entrada para operacoes mutaveis', () => {
    expect(listagemServer).toContain(".from('consultor_usuarios')")
    expect(listagemServer).toContain("usuarioResult.data?.papel === 'OPERADOR'")
    expect(listagemUi).toContain("perfil === 'consultor' && resultado.contextoConsultor?.podeOperar")
  })

  it('autoriza a leitura documental pelos tres contextos do requisito', () => {
    expect(migration).toContain('private.consultor_usuario_pode_visualizar_nota_fiscal')
    expect(migration).toContain('private.consultor_usuario_pode_visualizar_entrega')
    expect(migration).toContain('documento_requisito_instancias.operacao_id IS NOT NULL')
    expect(migration).toContain('documento_requisito_instancias.nota_fiscal_id IS NOT NULL')
    expect(migration).toContain('documento_requisito_instancias.nota_fiscal_entrega_id IS NOT NULL')
  })

  it('revalida o UUID no backend e compartilha o detalhe do Cedente sem duplicar regra', () => {
    expect(authorization).toContain('requireOperationViewAccess')
    expect(authorization).toContain("'consultor_pode_visualizar_operacao'")
    expect(authorization).toContain("assertRole(context.profile.role, ['consultor'])")
    expect(detalheConsultor).toContain("assertRole(auth.profile.role, ['consultor'])")
    expect(detalheConsultor).toContain('OperacaoDetalheFeature')
    expect(detalheCompartilhado).toContain("perfil?: 'cedente' | 'consultor'")
    expect(detalheCompartilhado).toContain("perfil === 'cedente' && pendencia.acaoHref")
    expect(detalheCompartilhado).toContain("perfil === 'cedente' && (")
  })

  it('exibe Cedente, Fundo, NFs e acao de detalhe na carteira consolidada', () => {
    expect(listagemUi).toContain('ConsultorCedenteSelector')
    expect(listagemUi).toContain('Todos os Fundos')
    expect(listagemUi).toContain('item.quantidadeNfs')
    expect(listagemUi).toContain('item.atualizadoEm')
    expect(listagemUi).toContain('Ver detalhes')
    expect(listagemServer).toContain("consultor_listar_cedente_ids_visiveis")
    expect(listagemServer).toContain("listar_fundos_visiveis_consultor")
    expect(listagemServer).toContain("consultor_pode_visualizar_cedente")
  })
})
