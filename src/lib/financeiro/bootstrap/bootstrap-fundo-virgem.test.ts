import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const migration = readFileSync(join(root, 'supabase/migrations/20260821000000_bootstrap_fundo_virgem_carteira_qa.sql'), 'utf8')
const exposicaoFix = readFileSync(join(root, 'supabase/migrations/20260821020000_bootstrap_exposicao_flag_persistido.sql'), 'utf8')
const motivosFix = readFileSync(join(root, 'supabase/migrations/20260821010000_bootstrap_risco_motivos_pl_oficial_indisponivel.sql'), 'utf8')
const evidenciaEconomica = readFileSync(join(root, 'supabase/migrations/20260821030000_bootstrap_fundo_virgem_evidencia_economica.sql'), 'utf8')
const detector = readFileSync(join(root, 'src/lib/financeiro/bootstrap/detector.server.ts'), 'utf8')
const matchingProcessor = readFileSync(join(root, 'src/lib/financeiro/conciliacao/processor.server.ts'), 'utf8')
const logisticaProcessor = readFileSync(join(root, 'src/lib/financeiro/logistica/processor.server.ts'), 'utf8')
const exposicaoProcessor = readFileSync(join(root, 'src/lib/financeiro/exposicao/processor.server.ts'), 'utf8')
const exposicaoTypes = readFileSync(join(root, 'src/lib/financeiro/exposicao/types.ts'), 'utf8')
const riscoTypes = readFileSync(join(root, 'src/lib/financeiro/risco/types.ts'), 'utf8')
const classificador = readFileSync(join(root, 'src/lib/financeiro/risco/classificador.ts'), 'utf8')

// P0/P1 (bootstrap fundo virgem + Carteira QA): confirmado ao vivo em
// homologacao (fundo QA BOOTSTRAP FUNDO VIRGEM FIDC) que, antes da primeira
// Carteira oficial, o gate agora bloqueia com PL_OFICIAL_INDISPONIVEL (nao
// AVALIACAO_RISCO_INDISPONIVEL); e que, apos publicar a Carteira QA via o
// caminho canonico (ingerirArquivoFinanceiro + publicarImportacaoFinanceira),
// o gate conclui CALCULADA/APTO usando o PL dessa Carteira.
//
// P0 (ajuste final, 20260821030000): financeiro_fundo_virgem originalmente
// confundia MERA EXISTENCIA de importacoes_financeiras PUBLICADA com
// evidencia economica real -- uma declaracao_sem_movimento ou um ESTOQUE
// publicado com zero posicoes tiravam o fundo do bootstrap so por existir,
// mesmo sem nenhuma linha real em estoque_posicoes/aquisicao_movimentos/
// liquidacao_movimentos. Confirmado ao vivo: o fundo real RLX
// FLUOROCHEMICAL (que so tem uma declaracao_sem_movimento em AQUISICOES e
// NUNCA teve operacao incorporada) estava classificado como NAO-virgem so
// por essa declaracao vazia existir -- corrigido para checar as tabelas
// canonicas de posicao/movimento diretamente; RLX FLUOROCHEMICAL agora e
// corretamente reclassificado como virgem (fundo_virgem=true).
describe('P0 (correcao real): bootstrap de fundo virgem + Carteira QA', () => {
  it('estado de bootstrap e inteiramente derivado de evidencia ECONOMICA real: operacao incorporada/desembolsada OU linha real em estoque/aquisicao/liquidacao -- nunca mera existencia de importacao publicada', () => {
    expect(evidenciaEconomica).toContain('CREATE OR REPLACE FUNCTION private.financeiro_fundo_virgem(p_fundo_id uuid)')
    expect(evidenciaEconomica).toContain("o.status IN ('em_andamento', 'inadimplente', 'liquidada')")
    expect(evidenciaEconomica).toContain('o.cessao_efetivada_em IS NOT NULL')
    expect(evidenciaEconomica).toContain('EXISTS (SELECT 1 FROM public.estoque_posicoes p WHERE p.fundo_id = p_fundo_id)')
    expect(evidenciaEconomica).toContain('EXISTS (SELECT 1 FROM public.aquisicao_movimentos m WHERE m.fundo_id = p_fundo_id)')
    expect(evidenciaEconomica).toContain('EXISTS (SELECT 1 FROM public.liquidacao_movimentos m WHERE m.fundo_id = p_fundo_id)')
    const inicioFuncao = evidenciaEconomica.indexOf('AS $$')
    const corpoFuncao = evidenciaEconomica.slice(inicioFuncao, evidenciaEconomica.indexOf('$$;', inicioFuncao))
    expect(corpoFuncao).not.toContain('importacoes_financeiras')
  })

  it('a versao original (superada) checava importacoes_financeiras PUBLICADA -- documentado para nao confundir com o comportamento vigente', () => {
    expect(migration).toContain("i.tipo_base IN ('ESTOQUE', 'AQUISICOES', 'LIQUIDACOES')")
  })

  it('resolver_bootstrap_financeiro so retorna carteira_oficial com PL>0 da primeira Carteira publicada, ordenada pela data mais antiga', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.resolver_bootstrap_financeiro(p_fundo_id uuid)')
    expect(migration).toContain("s.patrimonio_liquido > 0")
    expect(migration).toContain('ORDER BY i.data_referencia ASC, i.publicada_em ASC')
    expect(migration).toContain("private.financeiro_chamada_service_role()")
  })

  it('persistir_matching_execucao/persistir_conciliacao_execucao/persistir_posicao_logistica_execucao aceitam bootstrap apenas apos re-verificar financeiro_fundo_virgem server-side (nunca confiam so no flag do chamador)', () => {
    const ocorrencias = migration.split('NOT private.financeiro_fundo_virgem(v_fundo_id)').length - 1
    expect(ocorrencias).toBeGreaterThanOrEqual(3)
    expect(migration).toContain("MESSAGE = 'Bootstrap invalido: fundo possui historico financeiro'")
  })

  it('matching_execucoes/conciliacao_execucoes/posicao_logistica_execucoes ganham coluna bootstrap e as constraints so relaxam quando bootstrap=true', () => {
    expect(migration).toContain('CHECK (bootstrap OR cardinality(input_import_ids) > 0)')
    expect(migration).toContain('CHECK (bootstrap OR (estoque_importacao_id IS NOT NULL AND matching_execucao_id IS NOT NULL))')
    expect(migration).toContain('ALTER TABLE public.posicao_logistica_execucoes ALTER COLUMN estoque_importacao_id DROP NOT NULL')
  })

  it('novo status PL_OFICIAL_INDISPONIVEL e aceito por persistir_exposicao_execucao e pela constraint da tabela', () => {
    expect(migration).toContain("'PL_OFICIAL_INDISPONIVEL'")
    expect(exposicaoTypes).toContain("| 'PL_OFICIAL_INDISPONIVEL'")
  })

  it('a coluna exposicao_execucoes.bootstrap e de fato gravada por persistir_exposicao_execucao (fix confirmado ao vivo apos a coluna existir mas nunca ser escrita)', () => {
    expect(exposicaoFix).toContain("coalesce((p_payload->>'bootstrap')::boolean,false)")
    expect(exposicaoFix).toContain('flags_qualidade,detalhes,correlation_id,criado_por,bootstrap')
  })

  it('risco_motivos_codigo_check foi alargado para aceitar PL_OFICIAL_INDISPONIVEL (fix confirmado ao vivo apos a insercao do motivo falhar)', () => {
    expect(motivosFix).toContain("'PL_OFICIAL_INDISPONIVEL'")
    expect(riscoTypes).toContain("'PL_OFICIAL_INDISPONIVEL'")
  })

  it('resolverBootstrapFinanceiro (TS) chama a RPC e nunca deriva o estado localmente -- fonte unica de verdade no banco', () => {
    expect(detector).toContain("client.rpc('resolver_bootstrap_financeiro'")
    expect(detector).toContain('fundoVirgem: result.fundo_virgem === true')
  })

  it('executarMatchingFinanceiro so aceita universo totalmente ausente (imports.length===0) como bootstrap quando o fundo e comprovadamente virgem; senao permanece fail-closed', () => {
    const inicio = matchingProcessor.indexOf('if (imports.length === 0) {')
    expect(inicio).toBeGreaterThan(-1)
    const corpo = matchingProcessor.slice(inicio, matchingProcessor.indexOf('\n  }\n\n  const [notes', inicio))
    expect(corpo).toContain('resolverBootstrapFinanceiro(admin(), input.fundoId)')
    expect(corpo).toContain("if (!bootstrap.fundoVirgem) throw new Error('Nenhuma base financeira publicada foi encontrada para a data informada.')")
    expect(corpo).toContain('bootstrap: true')
  })

  it('executarConciliacaoFinanceira so trata as 4 bases ausentes (missing.length===4) como bootstrap CONCLUIDA quando o fundo e virgem; base parcialmente incompleta continua BASE_INCOMPLETA sempre', () => {
    expect(matchingProcessor).toContain('if (missing.length === 4) {')
    const inicio = matchingProcessor.indexOf('if (missing.length === 4) {')
    const corpo = matchingProcessor.slice(inicio, matchingProcessor.indexOf("if (missing.length > 0) {", inicio))
    expect(corpo).toContain("status: 'CONCLUIDA'")
    expect(corpo).toContain('resolverBootstrapFinanceiro')
  })

  it('executarPosicaoLogisticaFinanceira (P2.4) so aceita ausencia de Estoque D-1 como bootstrap quando o fundo e virgem; senao continua lancando o erro real', () => {
    expect(logisticaProcessor).toContain('const bootstrap = await resolverBootstrapFinanceiro(client, input.fundoId)')
    expect(logisticaProcessor).toContain("if (!bootstrap.fundoVirgem) throw new Error('Nenhum Estoque D-1 publicado foi encontrado para a data informada.')")
    expect(logisticaProcessor).toContain('bootstrap: true as const')
  })

  it('executarExposicaoFinanceira usa a Carteira/PL da primeira publicacao oficial (nao a data D-2 temporal) quando o fundo e virgem, e bloqueia com PL_OFICIAL_INDISPONIVEL quando ainda nao ha Carteira nenhuma', () => {
    expect(exposicaoProcessor).toContain('const bootstrap = await resolverBootstrapFinanceiro(client, input.fundoId)')
    expect(exposicaoProcessor).toContain("status: 'PL_OFICIAL_INDISPONIVEL'")
    expect(exposicaoProcessor).toContain('d2Efetivo = bootstrap.carteiraOficial.dataReferencia')
    expect(exposicaoProcessor).toContain('pl = new Decimal(bootstrap.carteiraOficial.patrimonioLiquido)')
  })

  it('a consulta de liquidacoes parciais nao tenta comparar matching_execucao_id nulo (bootstrap) com uuid -- bug real encontrado ao vivo e corrigido', () => {
    const indice = exposicaoProcessor.indexOf('const reconciliationPromise =')
    expect(indice).toBeGreaterThan(-1)
    const corpo = exposicaoProcessor.slice(indice, indice + 400)
    expect(corpo).toContain('position.matching_execucao_id')
    expect(corpo).toContain('Promise.resolve({ data: null, error: null })')
  })

  it('classificarGateRisco trata PL_OFICIAL_INDISPONIVEL como um motivo de bloqueio distinto de PL_D2_INDISPONIVEL (nao cai no fallback generico de PL ausente)', () => {
    expect(classificador).toContain("new Set(['CALCULADA', 'PL_D2_INDISPONIVEL', 'PL_D2_INVALIDO', 'PL_OFICIAL_INDISPONIVEL'])")
    const indice = classificador.indexOf("if (input.exposureStatus === 'PL_OFICIAL_INDISPONIVEL')")
    expect(indice).toBeGreaterThan(-1)
    expect(classificador.slice(indice, indice + 120)).toContain("reason('PL_OFICIAL_INDISPONIVEL', 'BLOQUEIO')")
  })
})
