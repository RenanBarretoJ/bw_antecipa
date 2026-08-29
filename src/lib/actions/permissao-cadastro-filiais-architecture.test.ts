import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync('supabase/migrations/20260819200000_p0_permissao_cadastro_filiais_cedente.sql', 'utf8')
const actions = readFileSync('src/lib/actions/gestor.ts', 'utf8')
const estabelecimentoActions = readFileSync('src/lib/actions/estabelecimento.ts', 'utf8')
const cedenteLayout = readFileSync('src/app/cedente/layout.tsx', 'utf8')
const meusEstabelecimentos = readFileSync('src/app/cedente/estabelecimentos/meus-estabelecimentos-client.tsx', 'utf8')
const gestorCedentePage = readFileSync('src/app/gestor/cedentes/[id]/page.tsx', 'utf8')

function actionBody(startMarker: string, endMarker: string) {
  return actions.slice(actions.indexOf(startMarker), endMarker ? actions.indexOf(endMarker) : undefined)
}

describe('P0/P1: permissao por Cedente para cadastrar novas Filiais', () => {
  it('campo booleano canonico em cedentes, default false, sem alterar Matriz/Filial/originacao', () => {
    expect(migration).toContain('ADD COLUMN permite_cadastro_filiais boolean NOT NULL DEFAULT false')
    expect(migration).not.toContain('UPDATE public.cedente_estabelecimentos')
  })

  it('RPC de alternancia segue o mesmo padrao de alternar_escrow/alternar_coobrigacao (multifundo, SECURITY DEFINER)', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.alternar_cadastro_filiais_cedente_gestor(p_cedente_id uuid, p_habilitar boolean)')
    expect(migration).toContain('private.gestor_tem_acesso_cedente(p_cedente_id)')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.alternar_cadastro_filiais_cedente_gestor(uuid, boolean) FROM PUBLIC, anon')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.alternar_cadastro_filiais_cedente_gestor(uuid, boolean) TO authenticated')
  })

  it('cadastrar_filial_cedente aborta antes do INSERT quando a permissao esta desabilitada, sem depender da UI', () => {
    const corpoRpc = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.cadastrar_filial_cedente('))
    const indiceGate = corpoRpc.indexOf("RAISE EXCEPTION 'O cadastro de novas Filiais nao esta habilitado para este Cedente.'")
    const indiceInsert = corpoRpc.indexOf('INSERT INTO public.cedente_estabelecimentos')
    expect(indiceGate).toBeGreaterThan(-1)
    expect(indiceInsert).toBeGreaterThan(-1)
    expect(indiceGate).toBeLessThan(indiceInsert)
  })

  it('toggleCadastroFiliaisCedente chama a RPC e audita habilitado/desabilitado (mesmo padrao de escrow/coobrigacao)', () => {
    const toggle = actionBody('export async function toggleCadastroFiliaisCedente', '')
    expect(toggle).toContain("supabase.rpc('alternar_cadastro_filiais_cedente_gestor'")
    expect(toggle).toContain("registrarLog({")
    expect(toggle).toContain("habilitar ? 'CADASTRO_FILIAIS_HABILITADO' : 'CADASTRO_FILIAIS_DESABILITADO'")
    expect(toggle).not.toContain("from('cedentes')\n    .update(")
  })

  it('tela do Gestor expoe o controle Habilitar/Desabilitar de Cadastro de Filiais', () => {
    expect(gestorCedentePage).toContain('toggleCadastroFiliaisCedente')
    expect(gestorCedentePage).toContain('Cadastro de Filiais')
    expect(gestorCedentePage).toContain('permite_cadastro_filiais')
  })

  it('obterStatusMatriz expoe a permissao para a UI do Cedente decidir visibilidade do botao', () => {
    expect(estabelecimentoActions).toContain('permiteCadastroFiliais')
  })

  it('botao Cadastrar filial so aparece quando Matriz aprovada E permissao habilitada; aviso claro quando desabilitada', () => {
    expect(meusEstabelecimentos).toContain('const podeCadastrar = matrizAprovada && permiteCadastroFiliais')
    expect(meusEstabelecimentos).toContain('{podeCadastrar &&')
    expect(meusEstabelecimentos).toContain('O cadastro de novas Filiais esta desabilitado pela Gestora.')
  })

  it('menu Meus CNPJs fica oculto quando a permissao esta desabilitada e nao ha Filiais', () => {
    expect(cedenteLayout).toContain("item.href !== '/cedente/estabelecimentos'")
    expect(cedenteLayout).toContain("eq('tipo', 'filial')")
    expect(cedenteLayout).toContain('if (!count)')
  })
})
