import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260823140000_p0_canhoto_requisito_checklist.sql'),
  'utf8',
)
const migrationLower = migration.toLowerCase()

const enviarCanhotoAction = readFileSync(join(process.cwd(), 'src/lib/actions/logistica.ts'), 'utf8')

describe('contrato da migration de consolidacao do canhoto no checklist (item 3 do ticket)', () => {
  it('e incremental e transacional', () => {
    expect(migrationLower).toContain('begin;')
    expect(migrationLower).toContain('commit;')
  })

  it('estende registrar_canhoto_documento apenas com parametro DEFAULT no final, depois de p_nota_fiscal_remessa_id (chamadas existentes continuam funcionando)', () => {
    const assinatura = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.registrar_canhoto_documento'),
      migration.indexOf('RETURNS jsonb'),
    )
    expect(assinatura).toContain('p_requisito_id uuid DEFAULT NULL')
    const posicaoNovoParam = assinatura.indexOf('p_requisito_id')
    const posicaoParamAnterior = assinatura.indexOf('p_nota_fiscal_remessa_id')
    expect(posicaoParamAnterior).toBeGreaterThan(-1)
    expect(posicaoNovoParam).toBeGreaterThan(posicaoParamAnterior)
  })

  it('quando o requisito e informado, exige que pertenca a mesma entrega e a familia documental de comprovante de entrega (fail-closed)', () => {
    expect(migrationLower).toContain('p_requisito_id is not null and not exists')
    expect(migrationLower).toContain("and nota_fiscal_entrega_id = p_nota_fiscal_entrega_id")
    expect(migrationLower).toContain("tipo_documento_codigo_snapshot in ('canhoto', 'comprovante_entrega', 'comprovante_de_entrega')")
    expect(migrationLower).toContain('requisito informado nao corresponde a esta entrega')
  })

  it('apos inserir o canhoto, atualiza a instancia do requisito (documento_id, status pendente, sem versao aprovada) escopada por id = p_requisito_id', () => {
    const bloco = migration.slice(
      migration.indexOf('IF p_requisito_id IS NOT NULL THEN\n    UPDATE public.documento_requisito_instancias'),
      migration.indexOf('PERFORM public.registrar_evento_entrega(p_nota_fiscal_entrega_id'),
    )
    expect(bloco).toContain('documento_id = doc_id')
    expect(bloco).toContain("status = 'pendente'")
    expect(bloco).toContain('versao_aprovada_id = NULL')
    expect(bloco).toContain('satisfeito_em = NULL')
    expect(bloco).toContain('WHERE id = p_requisito_id')
  })

  it('regrant explicito para o novo tamanho de assinatura (15 parametros)', () => {
    expect(migration).toContain(
      'REVOKE ALL ON FUNCTION public.registrar_canhoto_documento(uuid, text, text, bigint, text, text, text, date, text, text, boolean, boolean, text, uuid, uuid)',
    )
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.registrar_canhoto_documento(uuid, text, text, bigint, text, text, text, date, text, text, boolean, boolean, text, uuid, uuid)',
    )
  })

  it('amplia o WHERE de analisar_canhoto_documento na aprovacao para os tres codigos da familia comprovante de entrega', () => {
    const funcao = migration.slice(migration.indexOf('CREATE OR REPLACE FUNCTION public.analisar_canhoto_documento'))
    expect(funcao).toContain("tipo_documento_codigo_snapshot IN ('canhoto', 'comprovante_entrega', 'comprovante_de_entrega')")
  })

  it('nao altera a assinatura de analisar_canhoto_documento (mesmos 4 parametros de sempre)', () => {
    const assinatura = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.analisar_canhoto_documento'),
      migration.indexOf('RETURNS jsonb', migration.indexOf('CREATE OR REPLACE FUNCTION public.analisar_canhoto_documento')),
    )
    expect(assinatura).toContain('p_canhoto_id uuid')
    expect(assinatura).toContain('p_documento_versao_id uuid')
    expect(assinatura).toContain('p_resultado text')
    expect(assinatura).toContain('p_motivo text DEFAULT NULL')
  })
})

describe('enviarCanhoto (action) repassa requisitoId para a RPC', () => {
  it('le requisitoId do formData e passa como p_requisito_id', () => {
    const trecho = enviarCanhotoAction.slice(enviarCanhotoAction.indexOf('export async function enviarCanhoto'))
    expect(trecho).toContain("p_requisito_id: String(formData.get('requisitoId')")
  })

  it('continua repassando possuiRessalva/descricaoRessalva/notaFiscalRemessaId (usados pela deteccao de ambiguidade de vinculo)', () => {
    const trecho = enviarCanhotoAction.slice(enviarCanhotoAction.indexOf('export async function enviarCanhoto'))
    expect(trecho).toContain("p_possui_ressalva: formData.get('possuiRessalva')")
    expect(trecho).toContain("p_descricao_ressalva: String(formData.get('descricaoRessalva')")
    expect(trecho).toContain("p_nota_fiscal_remessa_id: String(formData.get('notaFiscalRemessaId')")
  })
})
