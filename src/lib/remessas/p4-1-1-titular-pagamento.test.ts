import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const read = (relativePath: string) => fs.readFileSync(path.join(root, relativePath), 'utf8')
const migration = read('supabase/migrations/20260826223437_p4_1_1_titular_pagamento_vrs.sql')
const loader = read('src/lib/remessas/loader.server.ts')
const mapper = read('src/lib/remessas/vrs/mapper.ts')
const action = read('src/lib/actions/estabelecimento.ts')
const client = read('src/app/cedente/estabelecimentos/meus-estabelecimentos-client.tsx')

describe('P4.1.1 - titular do PAGAMENTO VRS', () => {
  it('modela o titular por referencia ao estabelecimento e valida o mesmo Cedente', () => {
    expect(migration).toContain('ADD COLUMN titular_estabelecimento_id uuid')
    expect(migration).toContain('FOREIGN KEY (titular_estabelecimento_id)')
    expect(migration).toContain('v_titular.cedente_id IS DISTINCT FROM v_proprietario.cedente_id')
    expect(migration).toContain('O titular da conta deve pertencer ao mesmo Cedente.')
  })

  it('mantem backfill conservador e deixa ambiguidades sem titular', () => {
    expect(migration).toContain("WHEN proprietario.tipo = 'matriz' THEN proprietario.id")
    expect(migration).toContain('matriz_correspondente.quantidade, 0) = 1')
    expect(migration).toContain('matriz_correspondente.quantidade, 0) = 0')
    expect(migration).toContain('ELSE NULL')
  })

  it('carrega o titular em lote e nunca usa o Cedente como fallback no PAGAMENTO', () => {
    expect(loader).toContain('titular_estabelecimento_id')
    expect(loader).toContain("admin.from('cedente_estabelecimentos').select('id, cedente_id, cnpj, razao_social').in('id', titularIds)")
    expect(mapper).toContain('destinoPagamento?.favorecidoCpfCnpj')
    expect(mapper).toContain('destinoPagamento?.favorecidoNome')
    expect(mapper).toContain('REMESSA_VRS_TITULAR_CONTA_INDISPONIVEL')
    expect(mapper).not.toContain("cedente?.razaoSocial ?? ''")
  })

  it('cadastro exige escolha explicita e a RPC recebe somente o identificador do titular', () => {
    expect(action).toContain("formData.get('titular_estabelecimento_id')")
    expect(action).toContain('p_titular_estabelecimento_id: titularEstabelecimentoId')
    expect(client).toContain('Titular da conta')
    expect(client).toContain('name="titular_estabelecimento_id"')
  })
})
