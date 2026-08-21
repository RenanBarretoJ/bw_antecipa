import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260821070000_p0_nf_remessa_requisito_politica_satisfacao.sql'),
  'utf8',
)

const satisfacaoRequisito = readFileSync(join(process.cwd(), 'src/lib/documentos-v2/satisfacao-requisito.ts'), 'utf8')
const documentoV2Action = readFileSync(join(process.cwd(), 'src/lib/actions/documento-v2.ts'), 'utf8')

describe('contrato da migration: nf_remessa satisfeito a partir de nota_fiscal_remessas', () => {
  it('e incremental e transacional', () => {
    expect(migration).toContain('BEGIN;')
    expect(migration).toContain('COMMIT;')
  })

  it('a reconciliacao so considera status_validacao=VALIDADA (REVISAO_MANUAL e REJEITADA nunca satisfazem)', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION private.reconciliar_requisito_nf_remessa'),
      migration.indexOf('$function$;'),
    )
    expect(funcao).toContain("r.status_validacao = 'VALIDADA'")
    expect(funcao).not.toContain('REVISAO_MANUAL')
    expect(funcao).not.toContain('REJEITADA')
  })

  it('reverte para pendente quando deixa de haver remessa VALIDADA (nao apenas avanca para satisfeito)', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION private.reconciliar_requisito_nf_remessa'),
      migration.indexOf('$function$;'),
    )
    expect(funcao).toMatch(/SET status = 'satisfeito'[\s\S]*AND v_satisfeito/)
    expect(funcao).toMatch(/SET status = 'pendente'[\s\S]*AND NOT v_satisfeito/)
  })

  it('escopo e sempre por nota_fiscal_id (a venda) e tipo_documento_codigo_snapshot=nf_remessa -- nunca cross-venda', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION private.reconciliar_requisito_nf_remessa'),
      migration.indexOf('$function$;'),
    )
    const ocorrencias = funcao.match(/nota_fiscal_id = p_nota_fiscal_venda_id/g) || []
    expect(ocorrencias.length).toBeGreaterThanOrEqual(2)
    expect(funcao).toContain("tipo_documento_codigo_snapshot = 'nf_remessa'")
  })

  it('trigger dispara em INSERT e em UPDATE de status_validacao (cobre uma futura revisao de remessa, ainda sem RPC hoje)', () => {
    expect(migration).toContain('AFTER INSERT OR UPDATE OF status_validacao ON public.nota_fiscal_remessas')
    expect(migration).toContain('DROP TRIGGER IF EXISTS nota_fiscal_remessas_reconciliar_requisito')
  })

  it('instanciar_requisitos_nota tambem reconcilia no momento da instanciacao (politica atualizada / NF reprocessada)', () => {
    const funcao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.instanciar_requisitos_nota'),
      migration.lastIndexOf('$$;'),
    )
    expect(funcao).toContain('PERFORM private.reconciliar_requisito_nf_remessa(p_nota_fiscal_id);')
  })

  it('nao cria documentos_repositorio, documento_versoes ou documento_analises fake para nf_remessa', () => {
    const funcaoReconciliacao = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION private.reconciliar_requisito_nf_remessa'),
      migration.indexOf('CREATE OR REPLACE FUNCTION private.trigger_reconciliar_requisito_nf_remessa'),
    )
    expect(funcaoReconciliacao).not.toContain('documentos_repositorio')
    expect(funcaoReconciliacao).not.toContain('documento_versoes')
    expect(funcaoReconciliacao).not.toContain('documento_analises')
  })

  it('private.reconciliar_requisito_nf_remessa nunca e concedido diretamente a authenticated/anon (so via trigger/instanciar_requisitos_nota, ja SECURITY DEFINER)', () => {
    expect(migration).toContain('REVOKE ALL ON FUNCTION private.reconciliar_requisito_nf_remessa(uuid) FROM PUBLIC, anon, authenticated')
  })
})

describe('gates de submissao/aprovacao: nf_remessa nunca depende de documentoId/versoes', () => {
  it('resolverSatisfacaoRequisitoParaSubmissao trata nf_remessa antes do fluxo generico de documento', () => {
    const trecho = satisfacaoRequisito.slice(0, satisfacaoRequisito.indexOf('export function resolverSatisfacaoRequisitoParaAprovacao'))
    const indiceEspecial = trecho.indexOf("tipoDocumento === TIPO_DOCUMENTO_DERIVADO_NF_REMESSA")
    const indiceGenerico = trecho.indexOf('estadoDaVersaoAtual(input)')
    expect(indiceEspecial).toBeGreaterThan(-1)
    expect(indiceEspecial).toBeLessThan(indiceGenerico)
  })

  it('resolverSatisfacaoRequisitoParaAprovacao tambem trata nf_remessa antes do fluxo generico', () => {
    const trecho = satisfacaoRequisito.slice(satisfacaoRequisito.indexOf('export function resolverSatisfacaoRequisitoParaAprovacao'))
    const indiceEspecial = trecho.indexOf("tipoDocumento === TIPO_DOCUMENTO_DERIVADO_NF_REMESSA")
    const indiceGenerico = trecho.indexOf('estadoDaVersaoAtual(input)')
    expect(indiceEspecial).toBeGreaterThan(-1)
    expect(indiceEspecial).toBeLessThan(indiceGenerico)
  })
})

describe('checklist (documento-v2.ts): nf_remessa nao duplica o card RemessaDaNota', () => {
  it('uploadPermitido e sempre false para nf_remessa, independente de documento_tipos', () => {
    expect(documentoV2Action).toContain('uploadPermitido: isNfRemessa ? false : !!type')
  })

  it('busca nota_fiscal_remessas apenas quando ha requisito nf_remessa no checklist (nao adiciona query no caminho comum)', () => {
    expect(documentoV2Action).toContain('temRequisitoNfRemessa')
    expect(documentoV2Action).toContain("row.tipo_documento_codigo_snapshot === TIPO_DOCUMENTO_NF_REMESSA")
  })
})
