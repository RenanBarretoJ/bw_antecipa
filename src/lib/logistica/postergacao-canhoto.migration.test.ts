import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260731171219_postergacao_upload_canhoto.sql'),
  'utf8',
).toLowerCase()

describe('contrato da migration de postergação do canhoto', () => {
  it('é transacional, incremental e preserva o prazo original', () => {
    expect(migration).toContain('begin;')
    expect(migration).toContain('commit;')
    expect(migration).toContain('prazo_original_upload_canhoto')
    expect(migration).toContain('nova_previsao_upload_canhoto')
    expect(migration).not.toMatch(/update\s+public\.nota_fiscal_entregas\s+set\s+data_limite_canhoto/)
  })

  it('garante uma única comunicação por NF e serializa requests concorrentes', () => {
    expect(migration).toContain('constraint postergacao_canhoto_nf_unique unique (nota_fiscal_id)')
    expect(migration).toContain('for update')
    expect(migration).toContain("on conflict (usuario_id, dedupe_key) do nothing")
  })

  it('usa exclusivamente o snapshot histórico e mantém snapshots antigos desabilitados', () => {
    expect(migration).toContain("v_snapshot := v_operacao.politica_snapshot")
    expect(migration).toContain("v_snapshot->>'permite_postergacao_upload_canhoto'")
    expect(migration).toContain("nullif(v_snapshot->>'limite_postergacao_upload_canhoto_dias', '')::integer")
    expect(migration).toContain('v_limite := coalesce(v_limite, 5)')
    expect(migration).not.toMatch(/select[\s\s]*permite_postergacao_upload_canhoto[\s\s]*from[\s\s]*public\.politica_operacional_versoes/)
  })

  it('bloqueia após qualquer upload histórico, sem depender da aprovação', () => {
    expect(migration).toContain('public.documento_versoes')
    expect(migration).toContain('public.canhotos')
    expect(migration).not.toContain("dv.status = 'aprovado'")
  })

  it('expõe somente leitura por RLS e concentra escrita na RPC protegida', () => {
    expect(migration).toContain('security definer')
    expect(migration).toContain("set search_path = ''")
    expect(migration).toContain('revoke all on function public.comunicar_postergacao_upload_canhoto')
    expect(migration).toContain('for select to authenticated')
    expect(migration).not.toContain('for insert to authenticated')
    expect(migration).not.toContain('for update to authenticated')
    expect(migration).not.toContain('for delete to authenticated')
  })

  it('restringe gestores ao fundo, consultores à carteira e não concede acesso ao sacado ou anon', () => {
    expect(migration).toContain('private.usuario_tem_acesso_fundo(fundo_id)')
    expect(migration).toContain('private.consultor_tem_acesso_cedente(cedente_id)')
    expect(migration).toContain('revoke all on public.nota_fiscal_entrega_postergacoes_canhoto from anon, authenticated')
    expect(migration).not.toContain("get_user_role() = 'sacado'")
  })

  it('registra evento, auditoria e notificação em lote somente para gestores do fundo', () => {
    expect(migration).toContain('canhoto_postergacao_comunicada')
    expect(migration).toContain('insert into public.eventos_dominio')
    expect(migration).toContain('insert into public.logs_auditoria')
    expect(migration).toContain('insert into public.notificacoes')
    expect(migration).toContain('from public.usuario_fundos uf')
    expect(migration).toContain('where uf.fundo_id = v_nf.fundo_id')
    expect(migration).toContain("'/gestor/notas-fiscais/'")
  })
})
