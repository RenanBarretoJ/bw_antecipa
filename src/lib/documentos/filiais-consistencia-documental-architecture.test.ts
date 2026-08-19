import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const meusEstabelecimentos = readFileSync('src/app/cedente/estabelecimentos/meus-estabelecimentos-client.tsx', 'utf8')
const estabelecimentosGestor = readFileSync('src/components/cedentes/EstabelecimentosGestor.tsx', 'utf8')
const migrationNovoTipo = readFileSync('supabase/migrations/20260819160000_p0_novo_tipo_comprovante_residencia_representante.sql', 'utf8')
const migrationBackfill = readFileSync('supabase/migrations/20260819160500_p0_backfill_comprovante_residencia_representante.sql', 'utf8')
const migrationRepresentantesLeitura = readFileSync('supabase/migrations/20260819161000_p0_representantes_leitura_multifundo_gestor.sql', 'utf8')
const domain = readFileSync('src/lib/types/domain.ts', 'utf8')
const cedenteDocumentosPage = readFileSync('src/app/cedente/documentos/page.tsx', 'utf8')
const gestorActions = readFileSync('src/lib/actions/gestor.ts', 'utf8')
const gestorCedentePage = readFileSync('src/app/gestor/cedentes/[id]/page.tsx', 'utf8')
const gestorListagemServer = readFileSync('src/lib/documentos/gestor-listagem.server.ts', 'utf8')
const documentosGestorListagem = readFileSync('src/components/documentos/DocumentosGestorListagem.tsx', 'utf8')

describe('correcao P0: botao "Enviar para analise" e "Configurar requisito" nao disparavam submit', () => {
  it('Enviar para analise, Enviar documento e Salvar conta tem type="submit" explicito', () => {
    expect(meusEstabelecimentos).toContain('<Button type="submit" disabled={pending}>Enviar para analise</Button>')
    expect(meusEstabelecimentos).toContain('<Button type="submit" size="sm" variant="outline" disabled={pending}>Enviar</Button>')
    expect(meusEstabelecimentos).toContain('<Button type="submit" disabled={pending}>Salvar conta</Button>')
  })

  it('Configurar requisito, Rejeitar e Suspender tem type="submit" explicito', () => {
    expect(estabelecimentosGestor).toContain('<Button type="submit" size="sm" variant="outline" disabled={pending}>Configurar requisito</Button>')
    expect(estabelecimentosGestor).toContain('<Button type="submit" size="sm" variant="destructive" disabled={pending}>Rejeitar</Button>')
    expect(estabelecimentosGestor).toContain('<Button type="submit" size="sm" variant="destructive" disabled={pending}>Suspender</Button>')
  })
})

describe('correcao P0: codigo canonico proprio para residencia do Representante', () => {
  it('adiciona o novo valor de enum em uma migration isolada (ADD VALUE nao pode ser usado na mesma transacao)', () => {
    expect(migrationNovoTipo).toContain("ALTER TYPE public.documento_tipo ADD VALUE 'representante_comprovante_residencia'")
  })

  it('faz backfill dos documentos existentes e adiciona constraint estrutural de escopo', () => {
    expect(migrationBackfill).toContain("SET tipo = 'representante_comprovante_residencia'::public.documento_tipo")
    expect(migrationBackfill).toContain('WHERE tipo = \'comprovante_endereco\'::public.documento_tipo')
    expect(migrationBackfill).toContain('AND representante_id IS NOT NULL')
    expect(migrationBackfill).toContain('ADD CONSTRAINT documentos_escopo_endereco_residencia_check')
  })

  it('o novo tipo esta no catalogo TypeScript', () => {
    expect(domain).toContain("'representante_comprovante_residencia'")
  })

  it('a tela do Cedente usa o novo codigo para o comprovante do representante, nao mais comprovante_endereco', () => {
    expect(cedenteDocumentosPage).toContain("{ key: 'representante_comprovante_residencia', label: 'Comprovante de Residencia (ultimos 90 dias)', obrigatorio: true }")
    expect(cedenteDocumentosPage).not.toContain("{ key: 'comprovante_endereco', label: 'Comprovante de Residencia")
  })

  it('aprovarCedente (gate de aprovacao) exige o novo codigo para o representante', () => {
    expect(gestorActions).toContain("const docsRepObrig = ['rg_cpf', 'representante_comprovante_residencia']")
  })

  it('a tela de detalhe do Cedente no Gestor usa o novo codigo para o representante', () => {
    expect(gestorCedentePage).toContain("const docsRepObrig = ['rg_cpf', 'representante_comprovante_residencia']")
    expect(gestorCedentePage).toContain('representante_comprovante_residencia: \'Comprovante de Residencia (ultimos 90 dias)\'')
    expect(gestorCedentePage).toContain("'rg_cpf', 'comprovante_de_renda', 'representante_comprovante_residencia', 'procuracao'")
  })
})

describe('correcao P0 (achado adicional): SELECT de representantes restaurado para authenticated, multifundo', () => {
  it('concede SELECT a authenticated e substitui a policy sem checagem de fundo', () => {
    expect(migrationRepresentantesLeitura).toContain('GRANT SELECT ON TABLE public.representantes TO authenticated')
    expect(migrationRepresentantesLeitura).toContain('DROP POLICY IF EXISTS representantes_gestor_all ON public.representantes')
    expect(migrationRepresentantesLeitura).toContain('CREATE POLICY representantes_gestor_multifundo_select')
    expect(migrationRepresentantesLeitura).toContain('private.gestor_tem_acesso_cedente(cedente_id)')
  })
})

describe('correcao P0: fila global do Gestor (/gestor/documentos) mostra rotulo e escopo corretos', () => {
  it('corrige o rotulo de extrato_bancario e adiciona os rotulos que faltavam', () => {
    expect(gestorListagemServer).toContain("extrato_bancario: 'Comprovante de Faturamento'")
    expect(gestorListagemServer).toContain("comprovante_de_renda: 'Comprovante de Renda'")
    expect(gestorListagemServer).toContain("representante_comprovante_residencia: 'Comprovante de Residencia'")
  })

  it('a query seleciona representante_id e o nome do representante', () => {
    expect(gestorListagemServer).toContain('representante_id,')
    expect(gestorListagemServer).toContain('representantes(nome)')
  })

  it('o item retornado expoe o escopo (empresa ou nome do representante)', () => {
    expect(gestorListagemServer).toContain("escopo: row.representante_id")
  })

  it('a tabela da fila global exibe a coluna de escopo', () => {
    expect(documentosGestorListagem).toContain('Escopo</TableHead>')
    expect(documentosGestorListagem).toContain("doc.escopo.tipo === 'empresa' ? 'Empresa' : doc.escopo.nome")
  })
})
