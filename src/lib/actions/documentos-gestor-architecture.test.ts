import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260819120000_p0_analise_documentos_gestor_permission_denied.sql', 'utf8')
const actions = readFileSync('src/lib/actions/gestor.ts', 'utf8')

describe('correcao P0: analise documental do Gestor sem escrita direta em documentos', () => {
  it('nao faz mais UPDATE direto em documentos no fluxo de analise/atualizacao', () => {
    const analisar = actions.slice(actions.indexOf('export async function analisarDocumento'), actions.indexOf('export async function gerarUrlDocumentoGestor'))
    expect(analisar).not.toContain("from('documentos')\n    .update(")
    expect(analisar).toContain("supabase.rpc('analisar_documento_gestor'")

    const solicitar = actions.slice(actions.indexOf('export async function solicitarAtualizacaoDocumento'), actions.indexOf('export async function convidarUsuarioCedente'))
    expect(solicitar).not.toContain("from('documentos')\n    .update(")
    expect(solicitar).toContain("supabase.rpc('solicitar_atualizacao_documento_gestor'")
  })

  it('define as duas RPCs como SECURITY DEFINER com search_path fechado', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.analisar_documento_gestor')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.solicitar_atualizacao_documento_gestor')
    expect(migration.match(/^SECURITY DEFINER$/gm)?.length).toBe(2)
    expect(migration.match(/SET search_path = ''/g)?.length).toBe(2)
  })

  it('reutiliza a mesma regra multifundo da policy de leitura, sem depender do fundo ativo em cookie', () => {
    expect(migration).toContain('private.usuario_tem_acesso_fundo(cf.fundo_id)')
    expect(migration).not.toContain('fundo_ativo')
    expect(migration).not.toContain('resolverContextoFundoGestor')
  })

  it('exige motivo para reprovacao e bloqueia decisao fora de enviado/em_analise', () => {
    expect(migration).toContain("Motivo da reprovacao e obrigatorio")
    expect(migration).toContain("v_status_atual NOT IN ('enviado', 'em_analise')")
    expect(migration).toContain("p_decisao NOT IN ('aprovado', 'reprovado')")
  })

  it('concede EXECUTE apenas para authenticated e revoga de PUBLIC/anon', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.analisar_documento_gestor(uuid, text, text) FROM PUBLIC, anon')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.analisar_documento_gestor(uuid, text, text) TO authenticated')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.solicitar_atualizacao_documento_gestor(uuid) FROM PUBLIC, anon')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.solicitar_atualizacao_documento_gestor(uuid) TO authenticated')
  })

  it('nao reabre GRANT de escrita direta em documentos para authenticated', () => {
    expect(migration).not.toMatch(/GRANT\s+(INSERT|UPDATE|DELETE).*ON TABLE public\.documentos TO authenticated/i)
  })
})
