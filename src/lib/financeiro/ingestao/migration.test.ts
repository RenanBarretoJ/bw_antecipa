import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrations = [
  '20260813191143_p2_2_ingestao_financeira_versionada_rlx.sql',
  '20260813193629_p2_2_complemento_linhagem_sem_movimento_rlx.sql',
  '20260813194809_p2_2_lock_ciclo_financeiro_rlx.sql',
  '20260813195427_p2_2_refresh_views_linhagem_rlx.sql',
  '20260813201000_p2_2_hardening_rls_indices_rlx.sql',
  '20260813202000_p2_2_escopo_hibrido_rlx.sql',
  '20260813203000_p2_2_helper_rls_super_admin_rlx.sql',
]
const sql = migrations.map((file) => readFileSync(join(process.cwd(), `supabase/migrations/${file}`), 'utf8')).join('\n')

describe('arquitetura SQL da ingestao financeira RLX', () => {
  it('publica somente pela RPC atomica com lock e preserva retificacao', () => {
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.publicar_importacao_financeira')
    expect(sql).toContain('pg_advisory_xact_lock')
    expect(sql).toContain("SET status = 'RETIFICADA'")
    expect(sql).toContain("status = 'PUBLICADA'")
  })

  it('mantem bruto e staging restritos e leitura canonica por fundo', () => {
    expect(sql).toContain('rlx_importacoes_super_admin_select')
    expect(sql).toContain('rlx_linhas_super_admin_select')
    expect(sql).toContain('private.rlx_gestor_tem_acesso_fundo(fundo_id)')
    expect(sql).not.toMatch(/CREATE POLICY rlx_\w+_(insert|update|delete)/i)
    expect(sql).toContain('security_invoker = true')
    expect(sql).toContain('DROP POLICY IF EXISTS rlx_estoque_super_admin_select')
    expect(sql).toContain('private.rlx_usuario_e_super_admin()')
  })

  it('indexa os identificadores financeiros sem acoplar matching', () => {
    expect(sql).toContain('rlx_estoque_seu_numero_lookup_idx')
    expect(sql).toContain('rlx_estoque_chave_nfe_lookup_idx')
    expect(sql).toContain('rlx_estoque_partes_vencimento_idx')
    expect(sql).toContain('rlx_aquisicoes_titulo_lookup_idx')
    expect(sql).toContain('rlx_liquidacoes_titulo_lookup_idx')
  })

  it('mantem bucket privado e sem leitura anonima', () => {
    expect(sql).toContain("VALUES ('financeiro-importacoes', 'financeiro-importacoes', false")
    expect(sql).toContain('REVOKE ALL ON TABLE')
  })

  it('explicita sem movimento, linhagem e lock atomico do cron', () => {
    expect(sql).toContain('registrar_importacao_financeira_sem_movimento')
    expect(sql).toContain('declaracao_sem_movimento')
    expect(sql).toContain('substitui_importacao_id')
    expect(sql).toContain('iniciar_ciclo_importacao_financeira_rlx')
    expect(sql).toContain('ON CONFLICT ON CONSTRAINT rlx_importacao_ciclos_lock_unique')
    expect(sql).toContain("interval '30 minutes'")
  })

  it('nao antecipa matching, conciliacao, logistica ou exposicao', () => {
    expect(sql).not.toMatch(/\bnota_fiscal_id\b/i)
    expect(sql).not.toMatch(/\bmatching_status\b/i)
    expect(sql).not.toMatch(/\bconciliacao_status\b/i)
    expect(sql).not.toMatch(/\bstatus_logistico\b/i)
    expect(sql).not.toMatch(/\bencerra_exposicao\b/i)
  })
})
