import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const page = readFileSync('src/app/consultor/notas-fiscais/page.tsx', 'utf8')
const detailPage = readFileSync('src/app/consultor/notas-fiscais/[id]/page.tsx', 'utf8')
const list = readFileSync('src/app/cedente/notas-fiscais/notas-fiscais-listagem.tsx', 'utf8')
const context = readFileSync('src/lib/notas-fiscais/contexto-operacional.server.ts', 'utf8')
const action = readFileSync('src/lib/actions/nota-fiscal.ts', 'utf8')
const migration = readFileSync(
  'supabase/migrations/20260924143332_c4_consultor_notas_fiscais_por_cedente.sql',
  'utf8',
)
const establishmentGateMigration = readFileSync(
  'supabase/migrations/20260924170410_c4_consultor_gate_estabelecimento_origem.sql',
  'utf8',
)
const establishmentReadMigration = readFileSync(
  'supabase/migrations/20260924171344_c4_consultor_leitura_estabelecimento_origem.sql',
  'utf8',
)
const establishmentPolicyConsolidation = readFileSync(
  'supabase/migrations/20260924171634_c4_consolidar_policy_estabelecimentos.sql',
  'utf8',
)

describe('C4 - Consultor opera NFs somente no Cedente selecionado', () => {
  it('reutiliza o seletor C2 e a mesma feature de listagem/upload do Cedente', () => {
    expect(page).toContain("ConsultorCedenteSelector")
    expect(page).toContain("@/app/cedente/notas-fiscais/notas-fiscais-listagem")
    expect(page).toContain('if (!cedenteId)')
    expect(page.indexOf('if (!cedenteId)')).toBeLessThan(page.indexOf('carregarNotasFiscaisComResumoDocumental(filtros'))
    expect(page).toContain('basePath="/consultor/notas-fiscais"')
    expect(page).toContain('cedenteIdSelecionado={cedenteId}')
  })

  it('permite que o dropdown do seletor ultrapasse o Card sem ser recortado', () => {
    expect(page.match(/relative z-20 overflow-visible/g)).toHaveLength(3)
  })

  it('limpa o estado cliente ao alternar o Cedente e preserva o contexto em filtros, upload e detalhe', () => {
    expect(page).toContain('key={[')
    expect(page).toContain('cedenteId,')
    expect(list).toContain("formData.append('cedente_id', cedenteIdSelecionado)")
    expect(list).toContain("params.set('cedente', cedenteIdSelecionado)")
    expect(list).toContain('encodeURIComponent(cedenteIdSelecionado)')
  })

  it('reautoriza o Cedente e valida a NF exata no servidor', () => {
    expect(context).toContain('resolverCedenteSolicitanteOperacao(auth, cedenteIdInformado)')
    expect(context).toContain(".eq('cedente_id', contexto.cedente.id)")
    expect(context).toContain(".eq('cedente_fundo_id', contexto.cedenteFundoId)")
    expect(context).toContain(".eq('fundo_id', contexto.fundoId)")
    expect(detailPage).toContain('resolverContextoOperacionalNotaFiscal(auth, cedenteId)')
    expect(detailPage).toContain('validarNotaNoContextoSelecionado(auth.supabase, id, contexto)')
  })

  it('mantem validacao de emitente, estabelecimento e parser unico no upload compartilhado', () => {
    expect(action).toContain("formData.get('cedente_id')")
    expect(action).toContain('resolverContextoOperacionalNotaFiscal(auth, cedenteIdInformado)')
    expect(action).toContain('validarXmlNfeParaUploadCedente({')
    expect(action).toContain('resolverEstabelecimentoOrigem({')
    expect(action).toContain('e instanceof EstabelecimentoOrigemError && !notaFiscalPersistidaId')
    expect(action).toContain("status: 'REJECTED_INVALID', error: mensagemErroEstabelecimentoOrigem(e)")
    expect(action).toContain('O CNPJ emitente não pertence ao Cedente selecionado.')
    expect(action).toContain("excluir_notas_fiscais_rascunho_operador")
  })

  it('autoriza o gate de estabelecimento do Consultor somente no contexto operacional exato', () => {
    expect(establishmentGateMigration).toContain(
      'CREATE OR REPLACE FUNCTION public.estabelecimento_pode_originar',
    )
    expect(establishmentGateMigration).toContain("public.get_user_role() = 'consultor'")
    expect(establishmentGateMigration).toContain('private.usuario_pode_operar_cedente(p_cedente_id)')
    expect(establishmentGateMigration).toContain('private.consultor_tem_acesso_fundo(p_fundo_id)')
    expect(establishmentGateMigration).toContain(
      'private.estabelecimento_pode_originar(',
    )
    expect(establishmentGateMigration).toContain('SECURITY INVOKER')
    expect(establishmentGateMigration).toContain(
      'REVOKE ALL ON FUNCTION public.estabelecimento_pode_originar(uuid, uuid, uuid)',
    )
    expect(establishmentGateMigration).not.toMatch(/GRANT EXECUTE[^;]+TO anon/)
  })

  it('torna visivel somente o estabelecimento de Cedente e fundo autorizados ao Consultor', () => {
    expect(establishmentReadMigration).toContain(
      'CREATE POLICY cedente_estabelecimentos_consultor_select_c4',
    )
    expect(establishmentReadMigration).toContain("public.get_user_role()) = 'consultor'")
    expect(establishmentReadMigration).toContain(
      'private.usuario_pode_operar_cedente(cedente_estabelecimentos.cedente_id)',
    )
    expect(establishmentReadMigration).toContain('cf.cedente_id = cedente_estabelecimentos.cedente_id')
    expect(establishmentReadMigration).toContain("cf.status = 'ativo'")
    expect(establishmentReadMigration).toContain('private.consultor_tem_acesso_fundo(cf.fundo_id)')
    expect(establishmentReadMigration).not.toMatch(/TO anon/)
  })

  it('consolida a leitura de estabelecimentos em uma unica policy permissiva', () => {
    expect(establishmentPolicyConsolidation).toContain(
      'DROP POLICY IF EXISTS cedente_estabelecimentos_consultor_select_c4',
    )
    expect(establishmentPolicyConsolidation).toContain(
      'DROP POLICY IF EXISTS cedente_estabelecimentos_select',
    )
    expect(establishmentPolicyConsolidation).toContain(
      'CREATE POLICY cedente_estabelecimentos_select',
    )
    expect(establishmentPolicyConsolidation).toContain(
      'private.usuario_tem_acesso_cedente(cedente_estabelecimentos.cedente_id)',
    )
    expect(establishmentPolicyConsolidation).toContain(
      'private.gestor_tem_acesso_cedente(cedente_estabelecimentos.cedente_id)',
    )
    expect(establishmentPolicyConsolidation).toContain(
      'private.usuario_pode_operar_cedente(cedente_estabelecimentos.cedente_id)',
    )
    expect(establishmentPolicyConsolidation).not.toMatch(/TO anon/)
  })

  it('RLS exige simultaneamente vinculo operacional, fundo autorizado e contexto ativo', () => {
    for (const policy of [
      'notas_fiscais_consultor_select',
      'notas_fiscais_consultor_insert',
      'notas_fiscais_consultor_update',
      'notas_fiscais_consultor_delete',
    ]) {
      expect(migration).toContain(`CREATE POLICY ${policy}`)
    }
    expect(migration).toContain('private.usuario_pode_operar_cedente(notas_fiscais.cedente_id)')
    expect(migration).toContain('private.consultor_tem_acesso_fundo(notas_fiscais.fundo_id)')
    expect(migration).toContain('cf.id = notas_fiscais.cedente_fundo_id')
    expect(migration).toContain("cf.status = 'ativo'")
  })

  it('Storage e exclusao nao concedem acesso global nem anonimo', () => {
    expect(migration).toContain('CREATE POLICY storage_nfs_consultor_insert_c4')
    expect(migration).toContain("storage.objects.bucket_id = 'notas-fiscais'")
    expect(migration).toContain("(storage.foldername(storage.objects.name))[2] = 'nf'")
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.excluir_notas_fiscais_rascunho_operador')
    expect(migration).toContain('nf.cedente_id <> p_cedente_id')
    expect(migration).toContain("'actor_role', v_role")
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.excluir_notas_fiscais_rascunho_operador(uuid[], uuid) FROM PUBLIC, anon')
    expect(migration).not.toMatch(/GRANT EXECUTE[^;]+TO anon/)
  })
})
