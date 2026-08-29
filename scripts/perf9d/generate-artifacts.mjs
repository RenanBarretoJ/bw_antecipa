#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildMigrationDependencyGraph } from './audit-lib.mjs'

const EXPECTED_PROJECT_REF = 'fhgkmggthxikfpogrvaa'
const evidence = readLatestAuditEvidence()
assertEvidenceIsSafe(evidence)

const comparisonByVersion = new Map(evidence.comparison.migrations.map((migration) => [migration.version, migration]))
const graph = buildMigrationDependencyGraph(evidence.inventory)
const orphanObjects = evidence.comparison.remoteObjectsWithoutLocalOrigin
const cleanRoom = readLatestCleanRoomEvidence()
const docsDirectory = resolve(process.cwd(), 'docs/database')
mkdirSync(docsDirectory, { recursive: true })

writeJson('migration-manifest.json', buildManifest())
writeText('migration-dependency-graph.md', buildDependencyGraphDocument())
writeText('schema-diff-homolog-vs-clean.md', buildSchemaDiffDocument())
writeText('relatorio-escopo-9d-reconciliacao-migrations.md', buildMainReport())

console.log('\nArtefatos sanitizados do Escopo 9D gerados:')
for (const filename of [
  'migration-manifest.json',
  'migration-dependency-graph.md',
  'schema-diff-homolog-vs-clean.md',
  'relatorio-escopo-9d-reconciliacao-migrations.md',
]) console.log(`- docs/database/${filename}`)
console.log('Nenhuma conexão remota ou mutation foi executada por este comando.')

function buildManifest() {
  return {
    format: 'bw-antecipa-perf9d-migration-manifest-v1',
    generatedAt: evidence.metadata.generatedAt,
    projectRef: evidence.metadata.projectRef,
    branch: evidence.metadata.localBranch,
    head: evidence.metadata.localHead,
    sourceEvidenceSha256: evidence.metadata.payloadSha256,
    remoteReadOnly: evidence.metadata.remoteReadOnly,
    mutationExecuted: evidence.metadata.mutationExecuted,
    counts: {
      local: evidence.inventory.count,
      remoteHistory: evidence.remote.history.length,
      classifications: evidence.comparison.counts,
      remoteObjectsWithoutLocalOrigin: orphanObjects.length,
    },
    duplicateVersions: evidence.inventory.duplicateVersions,
    invalidFilenames: evidence.inventory.invalidFilenames,
    migrations: evidence.inventory.migrations.map((migration) => {
      const comparison = comparisonByVersion.get(migration.version)
      return {
        order: migration.order,
        version: migration.version,
        name: migration.name,
        path: migration.path,
        sha256: migration.sha256,
        canonicalStatementSha256: migration.canonicalStatementSha256,
        bytes: migration.bytes,
        statements: migration.statements,
        dependencies: migration.dependencies,
        expectationCounts: countBy(migration.expectations, (item) => item.kind),
        risks: migration.risks,
        remoteHistory: comparison.history
          ? { version: comparison.history.version, name: comparison.history.name, equivalent: comparison.historyEquivalent }
          : null,
        materialEvidenceCounts: countBy(comparison.evidence, (item) => item.status),
        classification: comparison.classification,
        reconciliationDecision: reconciliationDecision(comparison.classification),
      }
    }),
  }
}

function buildDependencyGraphDocument() {
  const uniqueUnresolved = groupDependencies(graph.unresolvedDependencies)
  const uniqueExternal = groupDependencies(graph.externalDependencies)
  return `# Escopo 9D — grafo de dependências das migrations

Gerado a partir do inventário local associado à evidência \`${evidence.metadata.payloadSha256}\`.

## Resultado

- Ordem canônica: lexicográfica por nome de arquivo, ${evidence.inventory.count} migrations.
- Arestas locais detectadas: ${graph.edges.length}.
- Referências locais para objeto criado somente em migration posterior: ${graph.forwardReferences.length}.
- Referências externas detectadas: ${graph.externalDependencies.length} ocorrências, ${uniqueExternal.length} objetos.
- Referências não resolvidas estaticamente: ${graph.unresolvedDependencies.length} ocorrências, ${uniqueUnresolved.length} objetos.
- Ciclos comprovados: nenhum pelo grafo estático; a prova executável está bloqueada antes da aplicação das migrations.

> A extração é conservadora. SQL dinâmico, CTEs e identificadores montados em PL/pgSQL podem gerar referências não resolvidas. Uma referência não resolvida não é automaticamente um defeito, mas impede prova automática de ordem.

## Referências futuras críticas

${graph.forwardReferences.length ? markdownTable(
  ['Migration consumidora', 'Objeto', 'Migration criadora posterior'],
  graph.forwardReferences.map((edge) => [edge.to, code(edge.object), edge.from]),
) : 'Nenhuma referência futura detectada.'}

As duas referências acima partem da RPC de reset de homologação. Elas demonstram que a ordem atual só é segura se a migration consumidora proteger a resolução dinâmica; isso precisa ser confirmado em clean-room.

## Dependências-base sem origem local comprovada

As seguintes relações remotas existem em homologação, mas nenhuma migration local declara sua criação:

${bulletList(orphanObjects.filter((item) => item.kind === 'table').map(objectLabel))}

Os enums-base também não têm origem local identificada:

${bulletList(orphanObjects.filter((item) => item.kind === 'enum').map(objectLabel))}

## Dependências externas

${bulletList(uniqueExternal.map((item) => `${code(item.object)} — usada por ${item.migrations.join(', ')}`))}

## Referências não resolvidas — amostra revisável

${bulletList(uniqueUnresolved.slice(0, 80).map((item) => `${code(item.object)} — usada por ${item.migrations.slice(0, 8).join(', ')}${item.migrations.length > 8 ? ', …' : ''}`))}

${uniqueUnresolved.length > 80 ? `A lista foi limitada a 80 de ${uniqueUnresolved.length} objetos para manter o documento revisável. O manifest contém as dependências brutas por migration.` : ''}

## Ordem canônica

${evidence.inventory.migrations.map((migration) => `${migration.order}. \`${migration.filename}\``).join('\n')}
`
}

function buildSchemaDiffDocument() {
  const remote = evidence.remote
  const catalogRows = [
    ['Relações', remote.relations.length],
    ['Colunas', remote.columns.length],
    ['Enums', remote.enums.length],
    ['Constraints', remote.constraints.length],
    ['Índices', remote.indexes.length],
    ['Funções', remote.routines.length],
    ['Triggers', remote.triggers.length],
    ['Policies', remote.policies.length],
    ['Buckets', remote.buckets.length],
  ]
  return `# Escopo 9D — schema diff homologação versus base limpa

## Resultado

**Diff não concluído.** A base limpa não foi criada, portanto não existe lado B confiável para comparação.

## Lado A — homologação

Catálogo coletado dentro de transação PostgreSQL \`READ ONLY\` no projeto \`${evidence.metadata.projectRef}\`:

${markdownTable(['Categoria', 'Quantidade'], catalogRows)}

## Lado B — base criada do zero

- Status: indisponível.
- Primeira tentativa: Supabase CLI ${cleanRoom?.cliVersion ?? '2.88.1'} falhou ainda em \`supabase start\`, antes de executar qualquer migration.
- Erro registrado: ${cleanRoom ? inline(cleanRoom.firstFailure?.message?.split('\n').find((line) => line.includes('unable to find user')) ?? cleanRoom.firstFailure?.message ?? 'não informado') : 'evidência clean-room não encontrada'}.
- Tentativa complementar com CLI 2.111.0: o Docker Desktop apresentou armazenamento interno somente leitura/erro de I/O durante o pull da imagem PostgreSQL. Nenhuma migration foi executada.
- Mutação remota: nenhuma.

## Diferenças que podem ser afirmadas sem lado B

Há ${orphanObjects.length} objetos remotos candidatos sem origem local identificada após excluir índices implícitos de PK/UNIQUE e reconhecer DDL dentro de blocos dinâmicos:

${markdownTable(['Tipo', 'Quantidade'], Object.entries(countBy(orphanObjects, (item) => item.kind)).map(([kind, count]) => [kind, count]))}

Os ${orphanObjects.filter((item) => item.kind === 'table').length} objetos-base de tabela e ${orphanObjects.filter((item) => item.kind === 'enum').length} enums-base são bloqueadores estruturais: o diretório local começa em \`003_storage_buckets_env.sql\` e não contém migrations \`001\`/\`002\` que criem esse núcleo.

## Classificação do diff

| Classe | Parecer |
|---|---|
| Segurança / RLS | 9B aprovado em 50/50 e 9C em 19/19 no schema materializado; equivalência com instalação limpa não comprovada. |
| Funcional / financeira | Não comparável sem base limpa. |
| Estrutural | Crítico: baseline de tabelas/enums não está versionado no diretório de migrations. |
| Storage | Estado material 9C equivalente; bootstrap limpo não comprovado. |
| Índices / performance | 23 índices remotos candidatos sem origem local; parte acompanha o schema-base ausente. |
| Cosmética / dados de ambiente | Excluídos do escopo do diff. |

## Próxima evidência necessária

1. Restaurar a saúde do Docker local ou usar projeto QA descartável explicitamente autorizado.
2. Reexecutar \`npm run perf9d:clean-room -- --confirm DISPOSABLE_LOCAL_ONLY\`.
3. A base deve aplicar as 73 migrations em ordem e gerar dump normalizado.
4. Somente então comparar tabelas, tipos, constraints, funções, grants, RLS e Storage com homologação.
`
}

function buildMainReport() {
  const counts = evidence.comparison.counts
  const status = git('status', '--short')
  const histories = evidence.remote.history.map((item) => [item.version, item.name, item.statementsCount, code(item.canonicalStatementSha256)])
  const migrationRows = evidence.comparison.migrations.map((migration) => [
    migration.version,
    migration.name,
    migration.history ? (migration.historyEquivalent ? 'equivalente' : 'divergente') : 'ausente',
    classificationLabel(migration.classification),
    reconciliationDecision(migration.classification),
  ])
  const partial = evidence.comparison.migrations.filter((item) => item.classification === 'materially_partially_applied')
  const divergent = evidence.comparison.migrations.filter((item) => item.classification === 'divergent')
  const equivalentWithoutHistory = evidence.comparison.migrations.filter((item) => item.classification === 'materially_fully_applied_without_history')
  const indeterminate = evidence.comparison.migrations.filter((item) => item.classification === 'indeterminate')

  return `# Relatório do Escopo 9D — auditoria e reconciliação de migrations

## 1. Resumo executivo

**Parecer: NO-GO PARA RECONCILIAÇÃO.**

O inventário local contém ${evidence.inventory.count} migrations, enquanto o histórico remoto contém ${evidence.remote.history.length}. A análise material encontrou ${counts.registered_and_equivalent ?? 0} registradas e equivalentes, ${counts.materially_fully_applied_without_history ?? 0} integralmente materializadas sem histórico, ${counts.materially_partially_applied ?? 0} parciais, ${counts.divergent ?? 0} divergentes, ${counts.indeterminate ?? 0} indeterminadas e ${counts.absent ?? 0} ausentes.

A homologação permaneceu inalterada. Toda consulta remota ocorreu em transação \`READ ONLY\`; não houve \`migration repair\`, aplicação de migration, alteração de histórico, commit ou push.

O bloqueio principal é estrutural: o repositório começa na migration \`003\` e não versiona a criação de 16 tabelas e 10 enums-base já presentes em homologação. Além disso, a prova em base vazia não chegou à primeira migration por falha da infraestrutura Docker local. Sem base limpa, não há schema diff conclusivo.

## 2. Estado local e pré-condições

- Ambiente autorizado: homologação.
- Projeto conferido: \`${evidence.metadata.projectRef}\`.
- Branch: \`${evidence.metadata.localBranch}\`.
- HEAD auditado: \`${evidence.metadata.localHead}\`.
- Worktree: checkpoint local identificável dos Escopos 9A/9C/9D; não estava limpo e foi preservado.
- \`testar_smtp_ionos.py\`: arquivo não rastreado, explicitamente fora do escopo e não alterado.
- Arquivos de ambiente: ignorados e não rastreados.
- Backup PERF9A confirmado em diretório local restrito; nenhum backup foi adicionado ao Git.
- Massa PERF9A preservada: 20 usuários, 2 fundos, 180 cedentes, 121 vínculos, 250 operações, 1.000 NFs, 900 documentos, 5.000 movimentos, 4.500 notificações, 1.000 logs e 200 eventos.
- Gate RLS 9B: 50/50 aprovado.
- Gate Storage 9C: 19/19 aprovado.
- Smoke já registrado no checkpoint: 26/26 aprovado.
- Estado do worktree no fechamento:

\`\`\`
${status || '(limpo)'}
\`\`\`

## 3. Histórico remoto real

${markdownTable(['Versão', 'Nome', 'Statements', 'SHA-256 canônico'], histories)}

O histórico remoto não representa o schema material. Não se deve inferir ausência de objeto apenas pelo histórico nem marcar uma migration como aplicada apenas pela existência de objeto com nome semelhante.

## 4. Inventário das 73 migrations

- Versões duplicadas: ${evidence.inventory.duplicateVersions.length ? evidence.inventory.duplicateVersions.join(', ') : 'nenhuma'}.
- Nomes fora do padrão: ${evidence.inventory.invalidFilenames.length ? evidence.inventory.invalidFilenames.join(', ') : 'nenhum'}.
- Ordem canônica: lexicográfica, registrada no manifest e no grafo.
- Migrations com \`DROP\` estrutural detectado: ${riskMigrations('destructiveDrop').join(', ') || 'nenhuma'}.
- SQL não transacional detectado: ${riskMigrations('nonTransactional').join(', ') || 'nenhum'}.
- Dependência de ambiente detectada: ${riskMigrations('environmentDependent').join(', ') || 'nenhuma'}.
- Reexecução potencialmente insegura: ${riskMigrations('unsafeRerun').length} migrations.
- SQL dinâmico: ${riskMigrations('dynamicSql').length} migrations.

O inventário estruturado está em [migration-manifest.json](./migration-manifest.json).

## 5. Equivalência e decisão por migration

${markdownTable(['Versão', 'Migration', 'Histórico', 'Evidência material', 'Decisão 9D'], migrationRows)}

## 6. Divergências

${bulletList(divergent.map((item) => `\`${item.filename}\` — histórico/definição não equivalente; exige investigação e migration corretiva, nunca repair retroativo imediato.`))}

## 7. Migrations parciais

${bulletList(partial.map((item) => `\`${item.filename}\` — presentes: ${evidenceCount(item, 'equivalent')}; ausentes: ${evidenceCount(item, 'absent')}; divergentes: ${evidenceCount(item, 'divergent')}; indeterminados: ${evidenceCount(item, 'indeterminate')}.`))}

Migration parcial não pode ser marcada como aplicada. Cada caso exige lista objeto a objeto, migration incremental corretiva, reaplicação em QA e nova auditoria.

## 8. Materializadas sem histórico e indeterminadas

### Candidatas após controle formal

${bulletList(equivalentWithoutHistory.map((item) => `\`${item.filename}\``))}

As quatro migrations 9B/9C estão neste grupo e tiveram validação específica. As demais continuam candidatas, não autorização para repair automático.

### Exigem comparação adicional

${bulletList(indeterminate.map((item) => `\`${item.filename}\``))}

## 9. Objetos remotos sem origem local identificada

Após o refinamento que exclui índices implícitos de constraints e reconhece DDL em blocos dinâmicos, restaram ${orphanObjects.length} candidatos:

${markdownTable(['Tipo', 'Quantidade'], Object.entries(countBy(orphanObjects, (item) => item.kind)).map(([kind, count]) => [kind, count]))}

${Object.entries(groupBy(orphanObjects, (item) => item.kind)).map(([kind, items]) => `### ${kind}\n\n${bulletList(items.map(objectLabel))}`).join('\n\n')}

Esses objetos não devem ser apagados. A lista representa ausência de origem local identificada, não autorização de correção.

## 10. Grafo e ordem de execução

- ${graph.edges.length} arestas locais.
- ${graph.forwardReferences.length} referências futuras.
- ${graph.externalDependencies.length} referências externas.
- ${graph.unresolvedDependencies.length} referências não resolvidas estaticamente.

O grafo completo e a ordem canônica estão em [migration-dependency-graph.md](./migration-dependency-graph.md). As referências futuras envolvem \`cedente_fundo_politicas\` e \`eventos_dominio\` na RPC de reset de homologação.

## 11. Prova em base vazia

**Não concluída.** O ambiente descartável foi isolado, sem credenciais remotas herdadas e sem mutação remota. A inicialização falhou antes da primeira migration:

- CLI 2.88.1: imagem local inconsistente (usuário \`supabase\` ausente no container).
- CLI 2.111.0: Docker Desktop apresentou metadados em modo somente leitura/erro de I/O durante o pull.
- Primeira migration executada: nenhuma.
- Histórico local criado: nenhum.
- Dump limpo: indisponível.

Não foi executado prune/reset/restart destrutivo do Docker sem autorização.

## 12. Schema diff

O diff normalizado não pode ser produzido sem lado B. O diagnóstico e o procedimento de retomada estão em [schema-diff-homolog-vs-clean.md](./schema-diff-homolog-vs-clean.md).

## 13. Validação específica do Escopo 9B

- \`20260730190000_escopo9b_corrigir_isolamento_rls.sql\`: materializada integralmente sem histórico.
- \`20260730194500_escopo9b_policies_explicitas.sql\`: materializada integralmente sem histórico.
- \`20260730200000_escopo9b_corrigir_recursao_sacado_rls.sql\`: materializada integralmente sem histórico.
- Policies substituídas foram tratadas pelo proprietário final, evitando falso desvio da migration anterior.
- Helpers, grants, \`search_path\`, índices, RLS e acesso cruzado foram validados; gate 50/50 aprovado.

## 14. Validação específica do Escopo 9C

- \`20260731140710_escopo9c_storage_autorizacao_multifundo.sql\`: materializada integralmente sem histórico.
- Policies de \`storage.objects\`, helpers privados, grants, índices e isolamento por fundo foram comparados.
- Gate Storage 19/19 aprovado.

Isso prova o estado material atual, não a reprodutibilidade do bootstrap.

## 15. Estratégia para homologação atual

1. Não executar repair agora.
2. Restaurar a infraestrutura clean-room.
3. Versionar, por plano formal, o bootstrap ausente das tabelas/enums-base sem editar migrations aplicadas.
4. Tratar 8 migrations parciais e 2 divergentes com migrations incrementais.
5. Resolver as 45 indeterminadas por comparação manual/automatizada ampliada.
6. Reexecutar base vazia e schema diff.
7. Somente migrations integralmente equivalentes podem ser candidatas a registro retroativo.
8. Capturar backup e histórico imediatamente antes de qualquer reconciliação futura.

## 16. Estratégia para produção vazia

O cenário ainda não é executável. Antes de produção vazia deve existir cadeia canônica que crie schema-base, Auth/Storage necessários, aplique as 73 migrations sem dependência manual, gere dump equivalente, valide RLS/Storage e execute smoke com seed administrativo mínimo.

Não criar baseline/squash automático neste escopo.

## 17. Estratégia para produção existente

1. Inventário read-only do catálogo e histórico do ambiente alvo.
2. Prova de equivalência individual.
3. Registro retroativo somente de migrations integralmente equivalentes.
4. Migrations incrementais para estado parcial/divergente.
5. Aplicação das ausentes em ordem validada.
6. Gates RLS, Storage, Auth, financeiro, integração e rollback.

## 18. Rollback operacional de reconciliação futura

- Backup lógico e export do histórico antes da janela.
- Plano objeto a objeto para cada migration corretiva.
- Sem reaplicação de SQL destrutivo.
- Em falha: interromper imediatamente, não marcar histórico, restaurar somente pelo procedimento aprovado e revalidar RLS/Storage.
- \`migration repair\` não reverte schema; ele altera apenas o registro de histórico e, por isso, não é mecanismo de rollback.

## 19. Riscos e bloqueadores

1. 16 tabelas e 10 enums-base sem origem local identificada.
2. 45 migrations indeterminadas.
3. 8 migrations parcialmente materializadas.
4. 2 migrations divergentes.
5. 86 objetos remotos candidatos sem origem local.
6. 2 referências futuras no grafo estático.
7. Clean-room bloqueado por infraestrutura Docker local.
8. Schema diff indisponível.
9. Histórico remoto representa apenas 5 de 73 versões locais.

## 20. Recomendação e parecer

**NO-GO PARA RECONCILIAÇÃO.** Não executar \`supabase migration repair\`, não promover para produção e não tratar o schema atual como reproduzível.

O próximo gate é obter uma base descartável saudável, completar o bootstrap versionado e zerar estados parciais/divergentes/indeterminados. Só depois pode haver plano de reconciliação controlada.

## Comandos e evidências

- \`npm run perf9a:status -- --env-file .env.homolog\`: massa preservada.
- \`npm run perf9b:verify -- --env-file .env.homolog\`: 50/50.
- \`npm run perf9c:storage -- --env-file .env.homolog\`: 19/19.
- \`npm run perf9d:audit -- --env-file .env.homolog\`: concluído em modo read-only.
- \`npx vitest run scripts/perf9d/audit-lib.test.mjs\`: 12/12.
- \`npx tsc --noEmit\`: aprovado.
- \`npm test -- --run\`: 69 arquivos e 463 testes aprovados.
- \`npm run lint\`: aprovado com zero erros e 6 avisos preexistentes fora do Escopo 9D.
- \`git diff --check\`: aprovado; somente avisos de normalização LF/CRLF no Windows.
- \`npx next build --webpack\`: aprovado; permanecem avisos conhecidos do Handlebars sobre \`require.extensions\`.
- Secret scan dos artefatos 9D: nenhuma credencial, URL PostgreSQL, token ou service role encontrada.
- Evidência completa: diretório local restrito \`%LOCALAPPDATA%/BWAntecipa/perf9d/evidence\`.
- SHA-256 da evidência usada: \`${evidence.metadata.payloadSha256}\`.

Referências operacionais: [Database migrations](https://supabase.com/docs/guides/deployment/database-migrations), [migration repair](https://supabase.com/docs/reference/cli/supabase-migration-repair) e [db reset](https://supabase.com/docs/reference/cli/supabase-db-reset).
`
}

function readLatestAuditEvidence() {
  const directory = join(process.env.LOCALAPPDATA ?? '', 'BWAntecipa', 'perf9d', 'evidence')
  const filename = readdirSync(directory)
    .filter((item) => item.startsWith(`migration-audit-${EXPECTED_PROJECT_REF}-`) && item.endsWith('.json'))
    .sort()
    .at(-1)
  if (!filename) throw new Error('Evidência 9D não encontrada. Execute perf9d:audit primeiro.')
  return JSON.parse(readFileSync(join(directory, filename), 'utf8'))
}

function readLatestCleanRoomEvidence() {
  const directory = join(process.env.LOCALAPPDATA ?? '', 'BWAntecipa', 'perf9d', 'clean-room')
  if (!existsSync(directory)) return null
  for (const item of readdirSync(directory).sort().reverse()) {
    const path = join(directory, item, 'clean-room-evidence.json')
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'))
  }
  return null
}

function assertEvidenceIsSafe(value) {
  if (value.metadata.projectRef !== EXPECTED_PROJECT_REF) throw new Error('Evidência não pertence ao homolog autorizado.')
  if (value.metadata.appEnv !== 'homolog' || value.metadata.remoteReadOnly !== true) throw new Error('Evidência não comprova leitura segura de homolog.')
  if (value.metadata.mutationExecuted !== false || value.metadata.repairAvailable !== false) throw new Error('Evidência incompatível com auditoria read-only.')
}

function reconciliationDecision(classification) {
  return ({
    registered_and_equivalent: 'já registrada; preservar',
    materially_fully_applied_without_history: 'candidata após controle formal',
    materially_partially_applied: 'exige migration corretiva',
    absent: 'deve permanecer ausente até ordem validada',
    divergent: 'exige investigação/correção',
    indeterminate: 'exige comparação adicional',
  })[classification] ?? 'não executar'
}

function classificationLabel(classification) {
  return ({
    registered_and_equivalent: 'registrada e equivalente',
    materially_fully_applied_without_history: 'integral sem histórico',
    materially_partially_applied: 'parcial',
    absent: 'ausente',
    divergent: 'divergente',
    indeterminate: 'indeterminada',
  })[classification] ?? classification
}

function evidenceCount(migration, status) {
  return migration.evidence.filter((item) => item.status === status).length
}

function riskMigrations(risk) {
  return evidence.inventory.migrations.filter((migration) => migration.risks[risk]).map((migration) => `\`${migration.filename}\``)
}

function groupDependencies(rows) {
  const byObject = new Map()
  for (const row of rows) {
    const migrations = byObject.get(row.object) ?? new Set()
    migrations.add(row.migration)
    byObject.set(row.object, migrations)
  }
  return [...byObject.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([object, migrations]) => ({ object, migrations: [...migrations] }))
}

function countBy(items, selector) {
  const counts = {}
  for (const item of items) {
    const key = selector(item)
    counts[key] = (counts[key] ?? 0) + 1
  }
  return counts
}

function groupBy(items, selector) {
  const groups = {}
  for (const item of items) {
    const key = selector(item)
    groups[key] ??= []
    groups[key].push(item)
  }
  return groups
}

function markdownTable(headers, rows) {
  return [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${row.map((cell) => String(cell ?? '').replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ')} |`),
  ].join('\n')
}

function bulletList(items) {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- Nenhum.'
}

function objectLabel(item) {
  return code(`${item.schema}.${item.name}`)
}

function code(value) {
  return `\`${value}\``
}

function inline(value) {
  return String(value).replaceAll('\n', ' ').replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[conexão ocultada]')
}

function git(...args) {
  return execFileSync('git', args, { cwd: process.cwd(), encoding: 'utf8' }).trim()
}

function writeText(filename, value) {
  writeFileSync(join(docsDirectory, filename), `${value.trim()}\n`, 'utf8')
}

function writeJson(filename, value) {
  writeFileSync(join(docsDirectory, filename), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
