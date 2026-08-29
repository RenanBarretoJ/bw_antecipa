import { describe, expect, it, vi } from 'vitest'
import { processarArquivoRlx } from '../ingestao/parser'
import {
  construirCarteiraQaCsv,
  decidirPublicacaoPl,
  executarPublicacaoPlSintetico,
  HOMOLOG_PROJECT_REF,
  QA_PL_ORIGIN,
  QA_PL_PROVIDER,
  validarAlvoExclusivoHomolog,
  validarEntradaPlSintetico,
  type PipelinePlSintetico,
  type RepositorioPlSintetico,
} from './pl-sintetico'

const fundoId = 'a4eb203b-ca53-40fa-8701-e453720bb15b'
const importacaoId = '56b6d639-d4fa-4c90-840a-b4e01a2a3f67'

function homologEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_SUPABASE_URL: `https://${HOMOLOG_PROJECT_REF}.supabase.co`,
    SUPABASE_DB_URL: `postgresql://postgres.${HOMOLOG_PROJECT_REF}:secret@aws-1-us-east-1.pooler.supabase.com:5432/postgres`,
    SUPABASE_SERVICE_ROLE_KEY: 'test-only',
    SUPABASE_PRODUCTION_PROJECT_REF: 'producao-ref-diferente',
    ...overrides,
  }
}

function dependencies(existing: Awaited<ReturnType<RepositorioPlSintetico['listarImportacoesNaData']>> = []) {
  const repositorio: RepositorioPlSintetico = {
    obterFundo: vi.fn().mockResolvedValue({ id: fundoId, nome: 'Fundo QA', cnpj: '12345678000190', ativo: true }),
    listarImportacoesNaData: vi.fn().mockResolvedValue(existing),
    listarBasesFinanceiras: vi.fn().mockResolvedValue([]),
    confirmarPl: vi.fn().mockResolvedValue({
      importacaoId,
      fundoId,
      dataReferencia: '2026-08-23',
      patrimonioLiquido: '1000000.0000',
      provedor: QA_PL_PROVIDER,
      origem: QA_PL_ORIGIN,
      status: 'PUBLICADA',
      vigente: true,
    }),
    resolverBootstrap: vi.fn().mockResolvedValue({
      fundoVirgem: true,
      carteiraOficial: { importacaoId, dataReferencia: '2026-08-23', patrimonioLiquido: '1000000.0000' },
    }),
  }
  const pipeline: PipelinePlSintetico = {
    ingerir: vi.fn().mockResolvedValue({ importacaoId, status: 'VALIDA', duplicada: false }),
    publicar: vi.fn().mockResolvedValue({ status: 'PUBLICADA' }),
  }
  return { repositorio, pipeline }
}

describe('publicacao de PL sintetico em homologacao', () => {
  it('aceita exclusivamente o project ref de homologacao provado por API e banco', () => {
    expect(validarAlvoExclusivoHomolog(homologEnv())).toBe(HOMOLOG_PROJECT_REF)
    expect(() => validarAlvoExclusivoHomolog(homologEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'https://producao123.supabase.co',
    }))).toThrow('so pode executar em homologacao')
    expect(() => validarAlvoExclusivoHomolog(homologEnv({
      SUPABASE_DB_URL: 'postgresql://postgres.producao123:secret@pooler.supabase.com:5432/postgres',
    }))).toThrow('so pode executar em homologacao')
  })

  it('bloqueia antes do workflow quando credenciais ou prova de homologacao estao ausentes', () => {
    expect(() => validarAlvoExclusivoHomolog({})).toThrow('credenciais obrigatorias ausentes')
    expect(() => validarAlvoExclusivoHomolog(homologEnv({ SUPABASE_PRODUCTION_PROJECT_REF: HOMOLOG_PROJECT_REF })))
      .toThrow('conflita com a referencia de producao')
  })

  it('valida UUID, PL positivo e data civil real', () => {
    expect(validarEntradaPlSintetico({ fundoId, pl: '1000000', dataBase: '2026-08-23' })).toEqual({
      fundoId,
      pl: '1000000.0000',
      dataBase: '2026-08-23',
      replaceQa: false,
    })
    expect(() => validarEntradaPlSintetico({ fundoId, pl: '0', dataBase: '2026-08-23' })).toThrow('maior que zero')
    expect(() => validarEntradaPlSintetico({ fundoId, pl: '-1', dataBase: '2026-08-23' })).toThrow('numero positivo')
    expect(() => validarEntradaPlSintetico({ fundoId, pl: '1', dataBase: '2026-02-30' })).toThrow('data valida')
    expect(() => validarEntradaPlSintetico({ fundoId: 'invalido', pl: '1', dataBase: '2026-08-23' })).toThrow('UUID valido')
  })

  it('gera Carteira identificada como QA sem fabricar outras bases', () => {
    const input = validarEntradaPlSintetico({ fundoId, pl: '1000000', dataBase: '2026-08-23' })
    const csv = construirCarteiraQaCsv(input, { id: fundoId, nome: 'Fundo QA', cnpj: '11.222.333/0001-81', ativo: true }, '2026-08-24T12:00:00.000Z')
    expect(csv).toContain('QA_SYNTHETIC_PL_V1')
    expect(csv).toContain('1000000.0000')
    expect(csv).not.toContain('ESTOQUE')
    expect(csv).not.toContain('AQUISICOES')
    expect(csv).not.toContain('LIQUIDACOES')
    const parse = processarArquivoRlx({
      arquivo: new TextEncoder().encode(csv),
      tipoBase: 'CARTEIRA',
      fundoId,
      dataReferencia: input.dataBase,
      provedor: QA_PL_PROVIDER,
    })
    expect(parse.completude).toBe('COMPLETO_COM_DADOS')
    expect(parse.linhas).toHaveLength(1)
    expect(parse.linhas[0].status).toBe('VALIDA')
    expect(parse.linhas[0].dadosNormalizados.patrimonio_liquido).toBe('1000000.0000')
  })

  it('publica por ingestao e RPC canonicas e confirma que o resolvedor enxerga o PL', async () => {
    const deps = dependencies()
    const input = validarEntradaPlSintetico({ fundoId, pl: '1000000', dataBase: '2026-08-23' })
    const result = await executarPublicacaoPlSintetico(input, deps)
    expect(deps.pipeline.ingerir).toHaveBeenCalledOnce()
    expect(deps.pipeline.publicar).toHaveBeenCalledWith(importacaoId)
    expect(deps.repositorio.confirmarPl).toHaveBeenCalledWith(importacaoId)
    expect(result.bootstrap.carteiraOficial).toMatchObject({ importacaoId, patrimonioLiquido: '1000000.0000' })
  })

  it('aborta sem escrever quando o fundo nao existe', async () => {
    const deps = dependencies()
    vi.mocked(deps.repositorio.obterFundo).mockResolvedValue(null)
    const input = validarEntradaPlSintetico({ fundoId, pl: '1000000', dataBase: '2026-08-23' })
    await expect(executarPublicacaoPlSintetico(input, deps)).rejects.toThrow('Fundo nao encontrado')
    expect(deps.pipeline.ingerir).not.toHaveBeenCalled()
    expect(deps.pipeline.publicar).not.toHaveBeenCalled()
  })

  it('aborta PL QA duplicado por padrao', () => {
    expect(() => decidirPublicacaoPl([{
      id: importacaoId, provedor: QA_PL_PROVIDER, origem: QA_PL_ORIGIN, status: 'PUBLICADA', patrimonioLiquido: '1000000',
    }], false)).toThrow('Ja existe PL sintetico QA')
  })

  it('--replace-qa permite somente retificacao de registro QA', async () => {
    const existing = [{
      id: 'ef89d5df-9291-49cc-9e54-b05473048398', provedor: QA_PL_PROVIDER, origem: QA_PL_ORIGIN, status: 'PUBLICADA', patrimonioLiquido: '900000',
    }]
    const deps = dependencies(existing)
    const input = validarEntradaPlSintetico({ fundoId, pl: '1000000', dataBase: '2026-08-23', replaceQa: true })
    const result = await executarPublicacaoPlSintetico(input, deps)
    expect(result.substituiuQa).toBe(true)
    expect(deps.pipeline.publicar).toHaveBeenCalledOnce()
  })

  it('nunca substitui dado real/oficial, mesmo com --replace-qa', async () => {
    const deps = dependencies([{
      id: 'ef89d5df-9291-49cc-9e54-b05473048398', provedor: 'sinqia_portal_fidc', origem: 'CRON', status: 'PUBLICADA', patrimonioLiquido: '900000',
    }])
    const input = validarEntradaPlSintetico({ fundoId, pl: '1000000', dataBase: '2026-08-23', replaceQa: true })
    await expect(executarPublicacaoPlSintetico(input, deps)).rejects.toThrow('real/oficial')
    expect(deps.pipeline.ingerir).not.toHaveBeenCalled()
    expect(deps.pipeline.publicar).not.toHaveBeenCalled()
  })

  it('replace do mesmo PL QA ja publicado e um no-op auditavel, sem nova escrita', async () => {
    const deps = dependencies([{
      id: importacaoId, provedor: QA_PL_PROVIDER, origem: QA_PL_ORIGIN, status: 'PUBLICADA', patrimonioLiquido: '1000000.0000',
    }])
    const input = validarEntradaPlSintetico({ fundoId, pl: '1000000', dataBase: '2026-08-23', replaceQa: true })
    const result = await executarPublicacaoPlSintetico(input, deps)
    expect(result.idempotente).toBe(true)
    expect(deps.pipeline.ingerir).not.toHaveBeenCalled()
    expect(deps.pipeline.publicar).not.toHaveBeenCalled()
  })
})
