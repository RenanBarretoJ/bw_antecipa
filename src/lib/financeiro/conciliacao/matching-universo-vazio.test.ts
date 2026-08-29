import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const originalMigration = readFileSync(resolve(root, 'supabase/migrations/20260814141629_p2_3_matching_conciliacao_rlx.sql'), 'utf8')
const semMovimentoMigration = readFileSync(resolve(root, 'supabase/migrations/20260813193629_p2_2_complemento_linhagem_sem_movimento_rlx.sql'), 'utf8')
const fixMigration = readFileSync(resolve(root, 'supabase/migrations/20260820180000_persistir_matching_execucao_universo_vazio.sql'), 'utf8')
const conciliacaoProcessor = readFileSync(resolve(root, 'src/lib/financeiro/conciliacao/processor.server.ts'), 'utf8')
const logisticaProcessor = readFileSync(resolve(root, 'src/lib/financeiro/logistica/processor.server.ts'), 'utf8')
const riscoProcessor = readFileSync(resolve(root, 'src/lib/financeiro/risco/processor.server.ts'), 'utf8')
const classificador = readFileSync(resolve(root, 'src/lib/financeiro/risco/classificador.ts'), 'utf8')

// P0 (P2.3 sem movimento / matching vazio): persistir_matching_execucao
// rejeitava QUALQUER execucao com resultados=[] como payload invalido, mesmo
// quando o universo pesquisado e legitimamente vazio (ex.: unica base
// publicada e uma declaracao_sem_movimento em AQUISICOES/LIQUIDACOES, ou uma
// base ESTOQUE publicada com zero linhas). Confirmado ao vivo em homologacao
// (fundo RLX FLUOROCHEMICAL, operacao d6afe2f3-dd0a-447a-b393-83f155c3f76b):
// apos a correcao, o matching passou a concluir com total=0 e a execucao
// evoluiu corretamente para o bloqueio real e distinto (Estoque D-1 ausente,
// P2.4/logistics), em vez de morrer com "Payload de matching invalido" no
// P2.3 sem qualquer diagnostico de estagio.
describe('P0 (correcao real): P2.3 aceita universo vazio legitimo sem afrouxar o fail-closed', () => {
  it('persistir_matching_execucao nao rejeita mais resultados=[] -- valida input_import_ids em vez disso', () => {
    expect(fixMigration).not.toContain("jsonb_array_length(coalesce(p_payload -> 'resultados', '[]'::jsonb)) = 0")
    expect(fixMigration).toContain("jsonb_array_length(coalesce(p_payload -> 'input_import_ids', '[]'::jsonb)) = 0")
    expect(fixMigration).toContain("MESSAGE = 'Payload de matching invalido'")
  })

  it('preserva a prova de legitimidade: todo input_import_ids continua obrigado a ser importacao PUBLICADA do mesmo fundo', () => {
    expect(fixMigration).toContain('Inputs de matching nao estao publicados no fundo informado')
    expect(fixMigration).toContain("i.fundo_id = v_fundo_id AND i.status = 'PUBLICADA'")
  })

  it('preserva integralmente o restante do corpo da funcao (autorizacao, idempotencia, insercoes) sem alterar mais nada', () => {
    expect(fixMigration).toContain('private.financeiro_chamada_service_role()')
    expect(fixMigration).toContain('IF FOUND THEN RETURN v_execucao_id; END IF;')
    expect(fixMigration).toContain("status = 'CONCLUIDA', total_registros = v_total")
  })

  it('a tabela matching_execucoes continua exigindo ao menos um input (cardinality > 0), nao afrouxado por esta correcao', () => {
    expect(originalMigration).toContain('CONSTRAINT rlx_matching_execucoes_inputs_check CHECK (cardinality(input_import_ids) > 0)')
  })

  it('o RPC irmao persistir_conciliacao_execucao (mesma migration de origem) ja tolerava resultados=[] -- precedente que evidencia a inconsistencia corrigida', () => {
    const start = originalMigration.indexOf('CREATE OR REPLACE FUNCTION public.rlx_persistir_conciliacao_execucao')
    const end = originalMigration.indexOf('CREATE OR REPLACE FUNCTION', start + 1)
    const body = originalMigration.slice(start, end === -1 ? undefined : end)
    expect(body).not.toMatch(/jsonb_array_length\(.*resultados.*\)\s*=\s*0/i)
    expect(body).toContain("jsonb_array_elements(coalesce(p_payload -> 'resultados', '[]'::jsonb))")
  })

  it('declaracao_sem_movimento so pode existir para AQUISICOES/LIQUIDACOES -- ESTOQUE nunca tem escape de "vazio legitimo" sem uma publicacao real', () => {
    expect(semMovimentoMigration).toMatch(/declaracao_sem_movimento\s*=\s*true[\s\S]*?tipo_base\s+IN\s*\(\s*'AQUISICOES'\s*,\s*'LIQUIDACOES'\s*\)/)
  })

  it('executarMatchingFinanceiro continua fail-closed quando NENHUMA base (ESTOQUE/AQUISICOES/LIQUIDACOES) foi publicada e o fundo NAO e virgem -- universo indeterminado permanece erro', () => {
    expect(conciliacaoProcessor).toContain("if (!bootstrap.fundoVirgem) throw new Error('Nenhuma base financeira publicada foi encontrada para a data informada.')")
    expect(conciliacaoProcessor).toContain('if (imports.length === 0) {')
  })

  it('executarPosicaoLogisticaFinanceira (P2.4) continua fail-closed quando o Estoque D-1 esta ausente -- nao fabrica ESTOQUE para destravar o gate', () => {
    expect(logisticaProcessor).toContain("throw new Error('Nenhum Estoque D-1 publicado foi encontrado para a data informada.')")
  })

  it('classificarGateRisco (P2.6) permanece fail-closed para qualquer status de exposicao nao suportado -- a correcao do P2.3 nao abre novo caminho de aprovacao indevida', () => {
    expect(classificador).toContain("new Set(['CALCULADA', 'PL_D2_INDISPONIVEL', 'PL_D2_INVALIDO', 'PL_OFICIAL_INDISPONIVEL'])")
    expect(classificador).toContain("technicalStatus: 'AVALIACAO_RISCO_INDISPONIVEL'")
    expect(classificador).toContain("decision: 'BLOQUEADO'")
  })

  it('o gate de risco agora rastreia e persiste em qual estagio um erro tecnico ocorreu (diagnostico aditivo, nao altera a decisao)', () => {
    expect(riscoProcessor).toContain('let lastStage: RiskGateDiagnosticStage | null = null')
    expect(riscoProcessor).toContain('const technicalErrorStage = technicalError ? lastStage : null')
    expect(riscoProcessor).toContain('technical_error_stage: technicalErrorStage')
  })
})
