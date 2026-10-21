import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const sql=readFileSync('supabase/migrations/20261021155151_vortx_inclusao_persistence.sql','utf8')
describe('Inclusion-only forward migration boundaries',()=>{
  it('adds an isolated immutable native movement/version namespace, not legacy financial writes',()=>{
    expect(sql).toContain('CREATE TABLE public.vortx_inclusoes')
    expect(sql).toContain('CREATE TABLE public.vortx_inclusao_linhas')
    expect(sql).toContain('vortx_validar_linhagem_inclusao')
    expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(?:aquisicao_movimentos|estoque_posicoes|notas_fiscais|operacoes|cnab_remessas)\b/i)
    expect(sql).not.toMatch(/DISABLE ROW LEVEL SECURITY|DROP POLICY|ALTER POLICY/i)
  })
  it('retains operator/session/MFA access through the canonical existing history projection',()=>{
    expect(sql).toContain('private.vortx_relatorio_operador(p_fundo,false) IS NOT TRUE')
    expect(sql).toContain('private.vortx_central_bases_historico(p_fundo_id,p_pagina,p_tipo,p_origem,p_estado,p_referencia)')
    expect(sql).not.toMatch(/CREATE(?: OR REPLACE)? FUNCTION (?:public\.obter_sessao_mfa_atual|private\.vortx_relatorio_operador)/)
    expect(sql).not.toMatch(/GRANT (?:ALL|INSERT|UPDATE|DELETE)[^;]+TO (?:authenticated|anon)/)
  })
  it('keeps publication and full/PDD stock reconciliation unchanged',()=>{
    expect(sql).not.toMatch(/CREATE(?: OR REPLACE)? FUNCTION (?:public\.publicar_|private\.vortx_estoque_reconciliado)/)
    expect(sql).not.toContain("SET status='PUBLICADA'")
    expect(sql).toContain('vortx_inclusao_autorizada(j.evento_id)')
    expect(sql).toContain('j.lease IS DISTINCT FROM p_lease')
    expect(sql).toContain('c.capability=\'AQUISICOES\'')
  })
})
