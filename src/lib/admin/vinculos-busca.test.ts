import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { adminVinculoBuscaSchema } from '@/lib/admin/usuarios'

const migration = readFileSync('supabase/migrations/20260826143321_p0_vinculo_gestor_fundo_busca_paginada.sql', 'utf8')
const modal = readFileSync('src/components/admin/admin-vinculo-search-dialog.tsx', 'utf8')
const action = readFileSync('src/app/admin/usuarios/actions.ts', 'utf8')
const accessAction = readFileSync('src/components/admin/gestor-fund-access-action.tsx', 'utf8')
const userPage = readFileSync('src/app/admin/usuarios/[id]/page.tsx', 'utf8')
const fundPage = readFileSync('src/app/admin/fundos/[id]/page.tsx', 'utf8')

function functionBody(name: string, nextName: string) {
  return migration.slice(migration.indexOf(`FUNCTION public.${name}`), migration.indexOf(`FUNCTION public.${nextName}`))
}

describe('P0 de vinculos Gestor e Fundo com busca paginada', () => {
  it('lista na pagina principal somente vinculos ativos existentes', () => {
    const fundosAtuais = functionBody('admin_listar_fundos_usuario', 'admin_listar_gestores_fundo')
    const gestoresAtuais = functionBody('admin_listar_gestores_fundo', 'admin_buscar_gestores_para_fundo')

    expect(fundosAtuais).toContain('FROM public.usuario_fundos uf')
    expect(fundosAtuais).toContain("AND uf.status = 'ativo'")
    expect(fundosAtuais).not.toContain('FROM public.fundos f\n  LEFT JOIN')
    expect(gestoresAtuais).toContain('FROM public.usuario_fundos uf')
    expect(gestoresAtuais).toContain("AND uf.status = 'ativo'")
    expect(gestoresAtuais).not.toContain('FROM public.profiles p\n  LEFT JOIN')

    expect(fundPage).toContain('Nenhum gestor vinculado a este fundo.')
    expect(userPage).toContain('Nenhum fundo vinculado a este gestor.')
  })

  it('compartilha um unico modal e nao busca o catalogo inteiro no mount', () => {
    expect(fundPage).toContain('<AdminVinculoSearchDialog direcao="gestores_para_fundo"')
    expect(userPage).toContain('<AdminVinculoSearchDialog direcao="fundos_para_gestor"')
    expect(modal).toContain('if (!open || termo.length < 2) return')
    expect(modal).toContain('const timer = window.setTimeout(() => {')
    expect(modal).toContain('}, 300)')
    expect(modal).toContain('Digite ao menos dois caracteres para iniciar a busca.')
    expect(modal).toContain('Nenhum resultado encontrado.')
  })

  it('busca gestores por nome ou e-mail e exclui os ja vinculados', () => {
    const search = functionBody('admin_buscar_gestores_para_fundo', 'admin_buscar_fundos_para_gestor')
    expect(search).toContain("lower(p.nome_completo) LIKE '%' || v_busca || '%'")
    expect(search).toContain("lower(p.email) LIKE '%' || v_busca || '%'")
    expect(search).toContain("COALESCE(uf.status, '') <> 'ativo'")
    expect(search).toContain("p.role::text = 'gestor'")
    expect(search).toContain('LIMIT p_por_pagina')
    expect(search).toContain('OFFSET (p_pagina - 1) * p_por_pagina')
  })

  it('busca fundos por nome ou CNPJ, pagina em 20 e preserva o status inativo', () => {
    const search = migration.slice(migration.indexOf('FUNCTION public.admin_buscar_fundos_para_gestor'))
    expect(search).toContain("lower(f.nome) LIKE '%' || v_busca || '%'")
    expect(search).toContain("regexp_replace(f.cnpj, '[^0-9]', '', 'g')")
    expect(search).toContain("COALESCE(uf.status, '') <> 'ativo'")
    expect(search).toContain('p_por_pagina <> 20')
    expect(search).toContain("CASE WHEN e.entidade_ativa THEN 'ativo' ELSE 'inativo' END")
    expect(modal).toContain("`Fundo ${statusAtivo ? 'ativo' : 'inativo'}`")
  })

  it('valida entrada e nao permite busca vazia ou pagina invalida', () => {
    expect(adminVinculoBuscaSchema.safeParse({ direcao: 'gestores_para_fundo', contextoId: crypto.randomUUID(), busca: 'ab', pagina: 1 }).success).toBe(true)
    expect(adminVinculoBuscaSchema.safeParse({ direcao: 'gestores_para_fundo', contextoId: crypto.randomUUID(), busca: 'a', pagina: 1 }).success).toBe(false)
    expect(adminVinculoBuscaSchema.safeParse({ direcao: 'fundos_para_gestor', contextoId: crypto.randomUUID(), busca: 'fundo', pagina: 0 }).success).toBe(false)
  })

  it('reutiliza a mutacao protegida por Super Admin, TOTP, auditoria e revalidacao', () => {
    expect(action).toContain("await autorizarEConsumirAcaoSensivel(context, actionType, input.mfaCode)")
    expect(action).toContain("'admin_vincular_gestor_fundo'")
    expect(action).toContain("'admin_reativar_gestor_fundo'")
    expect(action).toContain("'admin_revogar_gestor_fundo'")
    expect(action).not.toContain('createAdminClient')
    expect(accessAction).toContain('onSuccess?.()')
    expect(accessAction).toContain('router.refresh()')
  })
})
