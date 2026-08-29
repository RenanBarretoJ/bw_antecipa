import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migration = readFileSync(
  join(root, 'supabase/migrations/20260811120000_p2_0_duplicata_ativo_financeiro.sql'),
  'utf8',
)
const action = readFileSync(join(root, 'src/lib/actions/duplicata.ts'), 'utf8')
const gate = readFileSync(join(root, 'src/lib/duplicatas/gate.server.ts'), 'utf8')
const storage = readFileSync(join(root, 'src/lib/documentos-v2/storage.ts'), 'utf8')
const cedentePage = readFileSync(join(root, 'src/app/cedente/notas-fiscais/[id]/page.tsx'), 'utf8')
const gestorPage = readFileSync(join(root, 'src/app/gestor/notas-fiscais/[id]/page.tsx'), 'utf8')
const nfActions = readFileSync(join(root, 'src/lib/actions/nota-fiscal.ts'), 'utf8')

describe('P2.0 - garantias arquiteturais da Duplicata Mercantil', () => {
  it('preserva fundos legados em NOTA_FISCAL e habilita escolha por versao de politica', () => {
    expect(migration).toContain("DEFAULT 'NOTA_FISCAL'")
    expect(migration).toContain("tipo_ativo_financeiro IN ('NOTA_FISCAL', 'DUPLICATA_MERCANTIL')")
    expect(migration).toContain('NEW.tipo_ativo_financeiro IS DISTINCT FROM OLD.tipo_ativo_financeiro')
  })

  it('modela NF 1:N e identidade do titulo por vinculo, numero e parcela', () => {
    expect(migration).toContain('nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id)')
    expect(migration).toContain('ON public.duplicatas(cedente_fundo_id, numero, parcela)')
    expect(migration).toContain("WHERE numero IS NOT NULL")
    expect(migration).toContain('duplicata_versoes_nf_hash_unique UNIQUE (nota_fiscal_id, sha256)')
  })

  it('preserva dados das partes e trata aceite textual sem inferir validade juridica', () => {
    expect(migration).toContain('nome_cedente_documento text')
    expect(migration).toContain('nome_sacado_documento text')
    expect(migration).toContain("aceite_detectado_textualmente IN ('SIM', 'NAO', 'INDETERMINADO')")
    expect(migration).toContain("aceite_detectado_textualmente = CASE")
  })

  it('nao depende de identificador ou nome fixo de fundo', () => {
    const implementation = [migration, action, gate].join('\n')
    expect(implementation).not.toMatch(/RLX|FORMAPLAN|HEALTH|18fbfd05|a4eb203b/i)
  })

  it('restringe estados ao escopo P2.0 e nao cria valor de aquisicao', () => {
    expect(migration).toContain("status_validacao IN ('RASCUNHO', 'EXTRAIDA', 'REVISAR', 'VALIDADA', 'REJEITADA')")
    expect(migration).not.toMatch(/valor_aquisicao|preco_aquisicao|0[,.]40|40\s*%/i)
  })

  it('mantem versoes, correcoes e validacoes append-only', () => {
    expect(migration).toContain('CREATE TRIGGER duplicata_versoes_append_only')
    expect(migration).toContain('CREATE TRIGGER duplicata_correcoes_append_only')
    expect(migration).toContain('CREATE TRIGGER duplicata_validacoes_append_only')
    expect(migration).not.toMatch(/UPDATE\s+public\.duplicata_versoes\s+SET/i)
    expect(migration).toContain('valor_original jsonb')
    expect(migration).toContain('valor_corrigido jsonb')
    expect(migration).toContain('corrigido_por uuid NOT NULL')
    expect(migration).toContain('motivo text NOT NULL')
    expect(migration).toContain("v_role = 'gestor' AND (SELECT private.usuario_tem_acesso_fundo(v_old.fundo_id))")
    expect(migration).toContain("v_role = 'cedente' AND NOT EXISTS")
  })

  it('usa RLS multifundo e nao concede acesso ao anonimo ou sacado', () => {
    expect(migration).toContain('ALTER TABLE public.duplicatas ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('private.usuario_tem_acesso_fundo(duplicatas.fundo_id)')
    expect(migration).toContain('private.consultor_tem_acesso_cedente(duplicatas.cedente_id)')
    expect(migration).toContain('duplicatas.cedente_id = (SELECT public.get_user_cedente_id())')
    expect(migration).toContain('GRANT SELECT ON public.duplicatas')
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL).*\sTO\s+(?:anon|sacado)/i)
  })

  it('protege o Storage privado, o caminho contextual e compensa falha SQL', () => {
    expect(migration).toContain("p_bucket <> 'documentos-v2'")
    expect(migration).toContain("v_nf.cedente_id::text || '/duplicatas/' || v_nf.id::text || '/%'")
    expect(storage).toContain('createSignedUrl')
    expect(action).toContain('await removerObjetoDocumento(uploadedPath)')
    expect(action).toContain('possuiAssinaturaPdf(buffer)')
  })

  it('exibe um componente compartilhado nas telas do cedente e gestor', () => {
    expect(cedentePage).toContain('<DuplicatasDaNota')
    expect(cedentePage).toContain('mode="cedente"')
    expect(gestorPage).toContain('<DuplicatasDaNota')
    expect(gestorPage).toContain('mode="gestor"')
  })

  it('aplica gates na submissao, ressubmissao e aprovacao sem afetar NOTA_FISCAL', () => {
    expect(gate).toContain("!== 'DUPLICATA_MERCANTIL'")
    expect(gate).toContain("etapa === 'aprovacao'")
    expect(nfActions.match(/avaliarGateDuplicatasDaNota/g)?.length || 0).toBeGreaterThanOrEqual(4)
  })

  it('nao refatora tabelas financeiras ou operacionais nesta migration', () => {
    expect(migration).not.toMatch(/ALTER TABLE public\.(operacoes|operacoes_nfs|escrow|remessas)/i)
    expect(migration).not.toMatch(/CREATE TABLE public\.(estoque|aquisicoes|liquidacoes)/i)
  })
})
