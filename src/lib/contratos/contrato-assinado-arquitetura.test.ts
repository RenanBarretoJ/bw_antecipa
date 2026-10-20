import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const source = (path: string) => readFileSync(path, 'utf8')
const migration = source('supabase/migrations/20261020160000_cedente_contrato_assinado_canonico.sql')
const servidor = source('src/lib/contratos/contrato-assinado.server.ts')
const pagina = source('src/app/gestor/cedentes/[id]/page.tsx')

describe('fronteiras do hotfix de contrato do Cedente', () => {
  it('nao abre policies nem grants diretos de tabelas', () => {
    expect(migration).not.toMatch(/(?:CREATE|ALTER|DROP)\s+POLICY|DISABLE\s+ROW\s+LEVEL\s+SECURITY|GRANT\s+(?:INSERT|UPDATE|ALL).*ON\s+(?:TABLE|public\.cedentes|storage\.objects)/i)
    expect(migration).toContain("SET search_path = ''")
    expect(migration).toContain('FROM PUBLIC, anon, service_role')
  })
  it('revalida sessao TOTP, role e vinculos no banco, sem ator enviado pelo browser', () => {
    expect(migration).toContain('v_actor uuid := auth.uid()')
    expect(migration).toContain('public.obter_sessao_mfa_atual()')
    expect(migration).toContain("m.metodo = 'totp'")
    expect(migration).toContain('public.usuario_fundos')
    expect(migration).toContain('public.cedente_fundos')
    expect(migration).toContain('p_path_anterior')
    expect(migration).toContain('FOR UPDATE')
  })
  it('reference e auditoria estao na mesma transacao e sem DELETE', () => {
    expect(migration).toContain('UPDATE public.cedentes SET contrato_assinado_url')
    expect(migration).toContain('INSERT INTO public.logs_auditoria')
    expect(migration).not.toMatch(/DELETE\s+FROM/i)
    expect(migration).not.toMatch(/EXCEPTION\s+WHEN/i)
  })
  it('grava o cadastro com JWT/RPC e nao com update administrativo', () => {
    expect(servidor).toContain("contexto.auth.supabase.rpc('registrar_contrato_assinado_cedente'")
    expect(servidor).not.toContain('.update(')
    expect(servidor).toContain('await exigirSessaoElevada(auth)')
    expect(servidor).toContain('metadata: { sha256:')
  })
  it('retira action que aceitava path arbitrario e usa endpoint canonico no cadastro', () => {
    expect(source('src/lib/actions/cedente.ts')).not.toContain('salvarContratoAssinado')
    expect(pagina).toContain('uploadEndpoint={`/api/cedentes/${cedente.id}/contrato-assinado`}')
    expect(pagina).toContain('maxBytes={MAX_CONTRATO_ASSINADO_BYTES}')
    expect(source('src/components/contratos/UploadDocumentoAssinado.tsx')).toContain('await concluirUploadDocumentoAssinado')
  })
})
