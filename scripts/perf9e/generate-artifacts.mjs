#!/usr/bin/env node
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { inventoryMigrations } from '../perf9d/audit-lib.mjs'
import { fileSha256, normalizeCatalogValue } from './clean-room-lib.mjs'

const repositoryRoot = process.cwd()
const docsDirectory = resolve(repositoryRoot, 'docs/database')
const candidatePath = resolve(repositoryRoot, 'scripts/perf9e/bootstrap/schema-base-candidate.sql')
const migrationDirectory = resolve(repositoryRoot, 'supabase/migrations')
const SOURCE_COMMIT = '94e84e618fa0fbc96312441c847a37aa44afc744'
const SOURCE_BLOB = '06f6c4f4d1b6c12d1f7afb60f3cd451042503a07'
const EXPECTED_MIGRATIONS = 74

const cleanEvidence = readLatestCleanEvidence()
const auditEvidence = readLatestAuditEvidence()
assertEvidenceSafety()

const cleanCatalog = cleanEvidence.cycles[1].catalog
const remoteCatalog = auditEvidence.remote
const comparisons = compareCatalogs(remoteCatalog, cleanCatalog)
const manifest = buildBootstrapManifest()

mkdirSync(docsDirectory, { recursive: true })
writeJson('bootstrap-candidate-manifest.json', manifest)
writeText('schema-diff-homolog-vs-clean-final.md', buildSchemaDiff())
writeText('relatorio-escopo-9e-bootstrap-clean-room.md', buildReport())
append9dLink()

console.log('\nArtefatos do Escopo 9E gerados a partir de evidencias locais validadas:')
for (const name of [
  'bootstrap-candidate-manifest.json',
  'schema-diff-homolog-vs-clean-final.md',
  'relatorio-escopo-9e-bootstrap-clean-room.md',
]) console.log(`- docs/database/${name}`)
console.log('Nenhuma conexao ou mutacao remota foi executada.')

function readLatestCleanEvidence() {
  const root = resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa/perf9e/database-clean-room')
  const run = readdirSync(root).sort().at(-1)
  return JSON.parse(readFileSync(resolve(root, run, 'database-clean-room-evidence.json'), 'utf8'))
}

function readLatestAuditEvidence() {
  const root = resolve(process.env.LOCALAPPDATA || tmpdir(), 'BWAntecipa/perf9d/evidence')
  const filename = readdirSync(root).filter((name) => name.startsWith('migration-audit-') && name.endsWith('.json')).sort().at(-1)
  return JSON.parse(readFileSync(resolve(root, filename), 'utf8'))
}

function assertEvidenceSafety() {
  if (!cleanEvidence.metadata.success || !cleanEvidence.metadata.reproducible || cleanEvidence.cycles.length !== 2) {
    throw new Error('Evidencia clean-room nao possui dois ciclos reproduziveis e aprovados.')
  }
  if (cleanEvidence.metadata.remoteConnectionUsed || cleanEvidence.metadata.remoteMutationExecuted) {
    throw new Error('Evidencia clean-room indica uso remoto e foi recusada.')
  }
  if (!auditEvidence.metadata.remoteReadOnly || auditEvidence.metadata.mutationExecuted) {
    throw new Error('Evidencia de homologacao nao e estritamente read-only.')
  }
  if (auditEvidence.metadata.appEnv !== 'homolog') throw new Error('Evidencia remota nao pertence a homologacao.')
  const active = readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql')).sort()
  if (active.length !== EXPECTED_MIGRATIONS) throw new Error(`Esperadas ${EXPECTED_MIGRATIONS} migrations ativas; encontradas ${active.length}.`)
  if (active.some((name) => /^(001|002)_/.test(name))) throw new Error('001/002 nao podem integrar a cadeia ativa.')
}

function buildBootstrapManifest() {
  const temporary = mkdtempSync(join(tmpdir(), 'bw-perf9e-manifest-'))
  try {
    copyFileSync(candidatePath, resolve(temporary, '001_schema_base_candidate.sql'))
    const inventory = inventoryMigrations(temporary)
    const [candidate] = inventory.migrations
    const grouped = countBy(candidate.expectations, (item) => item.kind)
    const active = readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql')).sort()
    return {
      format: 'bw-antecipa-perf9e-bootstrap-candidate-manifest-v1',
      generatedAt: new Date().toISOString(),
      source: {
        path: 'supabase/schema.sql',
        gitCommit: SOURCE_COMMIT,
        gitBlobSha1: SOURCE_BLOB,
        provenance: 'Fonte historica local versionada; o commit consolidou o estado anterior de 002_contratos.sql ao introduzir 003_storage_buckets_env.sql.',
        copiedFromRemote: false,
      },
      candidate: {
        path: 'scripts/perf9e/bootstrap/schema-base-candidate.sql',
        sha256: fileSha256(candidatePath),
        outsideActiveMigrationChain: true,
        intendedUse: 'Somente bootstrap descartavel e definicao futura de cutover; nunca aplicar diretamente em ambiente existente.',
        statements: candidate.statements,
        expectationCounts: grouped,
        expectations: candidate.expectations.map((item) => ({
          kind: item.kind,
          schema: item.schema ?? null,
          table: item.table ?? null,
          name: item.name ?? null,
          operation: item.operation ?? null,
          persistent: item.persistent ?? null,
          comparable: item.comparable ?? null,
          source: item.source ?? 'static-sql-parser',
          confidence: item.confidence ?? 'static',
        })),
      },
      activeMigrationChain: {
        count: active.length,
        startsAt: active[0],
        endsAt: active.at(-1),
        contains001Or002: active.some((name) => /^(001|002)_/.test(name)),
        sourceManifestSha256: cleanEvidence.metadata.sourceManifestSha256,
      },
      platformPrerequisites: [
        'PostgreSQL/Supabase platform schemas and roles must exist before the candidate.',
        'The standard auth.jwt() helper is required by the MFA migration.',
        'Storage core schema must be provisioned before application Storage policies are applied.',
      ],
      legacyFixedDefaults: [
        { object: 'public.cedentes', fields: ['testemunha_1_nome', 'testemunha_1_cpf', 'testemunha_2_nome', 'testemunha_2_cpf'], classification: 'PII/business default inherited from historical source' },
        { object: 'public.fundos', fields: ['gestora_nome', 'gestora_cnpj', 'custodiante_nome', 'custodiante_cnpj'], classification: 'business default inherited from historical source' },
      ],
      warnings: [
        'O candidato preserva defaults historicos para manter rastreabilidade e equivalencia; saneamento exige migration incremental separada.',
        'O candidato nao e uma migration ativa e nao corrige o historico remoto.',
        'A cadeia reproduz o banco limpo, mas o diff final registra desvios materiais em relacao a homologacao.',
      ],
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

function compareCatalogs(remote, clean) {
  const result = {}
  for (const category of categories()) {
    const remoteMap = mapRows(remote[category.name] ?? [], category)
    const cleanMap = mapRows(clean[category.name] ?? [], category)
    const keys = [...new Set([...remoteMap.keys(), ...cleanMap.keys()])].sort()
    const rows = { same: [], presentationOnly: [], different: [], onlyRemote: [], onlyClean: [], ownerOnly: [] }
    for (const key of keys) {
      const left = remoteMap.get(key)
      const right = cleanMap.get(key)
      if (!left) rows.onlyClean.push(key)
      else if (!right) rows.onlyRemote.push(key)
      else if (JSON.stringify(exactComparable(left)) === JSON.stringify(exactComparable(right))) rows.same.push(key)
      else if (JSON.stringify(semanticComparable(left, category.name)) === JSON.stringify(semanticComparable(right, category.name))) rows.presentationOnly.push(key)
      else if (ownerComparable(left, right)) rows.ownerOnly.push(key)
      else rows.different.push(key)
    }
    result[category.name] = { ...rows, remoteCount: remoteMap.size, cleanCount: cleanMap.size }
  }
  return result
}

function categories() {
  return [
    { name: 'schemas', key: (r) => r.schema_name },
    { name: 'relations', key: (r) => `${r.schema_name}.${r.relation_name}` },
    { name: 'columns', key: (r) => `${r.schema_name}.${r.table_name}.${r.column_name}` },
    { name: 'enums', key: (r) => `${r.schema_name}.${r.type_name}` },
    { name: 'constraints', key: (r) => `${r.schema_name}.${r.table_name}.${r.constraint_name}` },
    { name: 'indexes', key: (r) => `${r.schema_name}.${r.index_name}` },
    { name: 'routines', key: (r) => `${r.schema_name}.${r.routine_name}(${normalizeIdentity(r.identity_arguments)})` },
    { name: 'triggers', key: (r) => `${r.schema_name}.${r.table_name}.${r.trigger_name}` },
    { name: 'policies', key: (r) => `${r.schema_name}.${r.table_name}.${r.policy_name}` },
    { name: 'tableGrants', key: (r) => `${r.schema_name}.${r.table_name}.${r.grantee}.${r.privilege_type}` },
    { name: 'routineGrants', key: (r) => `${r.schema_name}.${r.routine_name}(${normalizeIdentity(r.identity_arguments)}).${r.grantee}.${r.privilege_type}` },
    { name: 'schemaGrants', key: (r) => `${r.schema_name}.${r.grantee}.${r.privilege_type}` },
    { name: 'extensions', key: (r) => r.extension_name },
    { name: 'buckets', key: (r) => r.id },
  ]
}

function mapRows(rows, category) {
  return new Map(rows.map((row) => [category.key(row), normalizeCatalogValue(row)]))
}

function exactComparable(row) {
  const comparable = { ...row }
  delete comparable.owner
  return comparable
}

function semanticComparable(row, category) {
  const value = exactComparable(row)
  const transform = (item) => {
    if (Array.isArray(item)) return item.map(transform).sort()
    if (item && typeof item === 'object') return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, transform(child)]))
    if (typeof item !== 'string') return item
    let text = item.toLowerCase().replace(/\s+/g, ' ').trim()
    text = text.replaceAll('auth.uid()', 'uid()').replaceAll('auth.users', 'users')
    text = text.replace(/\(select uid\(\)\)/g, 'uid()').replace(/\(+/g, '(').replace(/\)+/g, ')')
    if (['policies', 'constraints', 'indexes', 'triggers'].includes(category)) text = text.replace(/\b(public|storage)\./g, '')
    return text.replace(/\s*([=,()])\s*/g, '$1')
  }
  return transform(value)
}

function ownerComparable(left, right) {
  const leftWithoutOwner = exactComparable(left)
  const rightWithoutOwner = exactComparable(right)
  if (JSON.stringify(leftWithoutOwner) === JSON.stringify(rightWithoutOwner)) return true
  if ('is_grantable' in leftWithoutOwner && 'is_grantable' in rightWithoutOwner) {
    const leftRest = { ...leftWithoutOwner }
    const rightRest = { ...rightWithoutOwner }
    delete leftRest.is_grantable
    delete rightRest.is_grantable
    return JSON.stringify(leftRest) === JSON.stringify(rightRest)
  }
  return false
}

function normalizeIdentity(value = '') {
  return String(value).replace(/\s+/g, ' ').trim().toLowerCase()
}

function buildSchemaDiff() {
  const appRows = differenceRows(false)
  const platformRows = differenceRows(true)
  const relationRls = comparisons.relations
  const rlsDrift = relationRls.different.filter((key) => key === 'public.devedores_solidarios')
  return `# Escopo 9E — schema diff homologação versus clean-room final

## Resultado executivo

Os dois ciclos limpos produziram o mesmo dump normalizado e o mesmo catálogo. O lado clean-room é, portanto, reproduzível. A comparação com a evidência read-only mais recente de homologação identificou pelo menos um desvio material de segurança: **\`public.devedores_solidarios\` possui RLS habilitada em homologação e desabilitada na instalação limpa**.

Esse desvio impede declarar equivalência e sustenta o parecer **NO-GO para definição de cutover** até existir correção incremental e nova execução completa.

## Evidências e método

- Evidência remota: catálogo 9D read-only, SHA-256 \`${auditEvidence.metadata.payloadSha256}\`.
- Evidência clean-room: SHA-256 \`${cleanEvidence.metadata.payloadSha256}\`.
- Bootstrap candidato: SHA-256 \`${cleanEvidence.metadata.bootstrapCandidateSha256}\`.
- Cadeia ativa: ${cleanEvidence.metadata.activeMigrationCount} migrations, SHA-256 de manifest \`${cleanEvidence.metadata.sourceManifestSha256}\`.
- Ciclos: 2/2 aprovados; dump e catálogo reproduzíveis: **sim**.
- Comparação: chave estável por objeto; owner removido da igualdade estrutural; diferenças de qualificação \`public.\`/\`auth.\`, espaços e forma equivalente de \`auth.uid()\` classificadas como apresentação; objetos \`storage\` separados da aplicação.

## Resumo — aplicação (public/private)

${markdownTable(['Categoria', 'Homolog', 'Clean', 'Iguais', 'Apresentação', 'Owner/grant', 'Diferentes', 'Só homolog', 'Só clean'], appRows)}

## Resumo — plataforma Storage

${markdownTable(['Categoria', 'Homolog', 'Clean', 'Iguais', 'Apresentação', 'Owner/grant', 'Diferentes', 'Só homolog', 'Só clean'], platformRows)}

As diferenças de Storage refletem principalmente a versão local \`${cleanEvidence.metadata.storagePlatformImage}\` e recursos opcionais (analytics/Iceberg). Elas não foram misturadas com objetos da aplicação.

## Desvios materiais da aplicação

### Segurança / RLS

${rlsDrift.length ? '- `public.devedores_solidarios`: homologação `rls_enabled=true`; clean-room `rls_enabled=false`. A cadeia ativa não reproduz o estado de segurança hospedado.' : '- Nenhum desvio material de RLS detectado.'}

Homologação ainda possui três policies nessa tabela (\`devedores_cedente_select\`, \`devedores_gestor_all\` e \`devedores_gestor_select\`) que não existem no clean-room. A combinação de RLS desligada e policies ausentes é um desvio material, não uma diferença cosmética.

### Regras e rotinas com semântica diferente

- \`public.notas_fiscais.notas_fiscais_valor_bruto_check\`: homologação aceita \`valor_bruto >= 0\`; o clean-room exige \`valor_bruto > 0\`.
- \`public.registrar_cte_documento(...)\`: assinatura e atributos de segurança coincidem, mas o corpo normalizado diverge (SHA-256 homologação \`c6ffacfa…7ec29\`; clean-room \`087ac0a8…035b\`). O conteúdo integral permanece apenas na evidência restrita.
- \`public.eventos_dominio.eventos_dominio_insert\`: o clean-room inclui autorização explícita para o perfil sacado; a policy de homologação contém somente os ramos gestor e cedente.
- \`public.remessas_cnab.remessas_cnab_integracao_fundo_versao_id_fkey\`: existe somente no clean-room e aplica \`ON DELETE RESTRICT\`.
- \`public.update_updated_at_column()\`: helper legado existe somente no clean-room; precisa ser classificado como dependência necessária ou resíduo antes do cutover.
- \`public.logs_auditoria\`: homologação mantém as policies amplas \`logs_auditoria_gestor_all\` e \`logs_auditoria_insert\`; o clean-room termina com \`logs_auditoria_gestor_select\` e \`logs_auditoria_insert_usuario\`, ambas limitadas a \`authenticated\` e com validação de ator.

### Objetos diferentes

${renderDifferenceLists(false, ['relations', 'columns', 'constraints', 'routines', 'triggers', 'policies', 'tableGrants', 'routineGrants', 'schemaGrants'])}

### Objetos presentes em apenas um lado

${renderOnlyLists(false, ['relations', 'columns', 'constraints', 'indexes', 'routines', 'triggers', 'policies', 'tableGrants', 'routineGrants', 'schemaGrants'])}

## Diferenças da plataforma Storage

${renderDifferenceLists(true, Object.keys(comparisons))}

${renderOnlyLists(true, Object.keys(comparisons))}

## Interpretação

- Diferenças marcadas como **apresentação** não alteram a semântica detectável do objeto.
- Diferenças de **owner/grantability** decorrem do executor local \`supabase_admin\` versus owner hospedado \`postgres\`; permanecem registradas porque grants precisam ser revalidados no ambiente de cutover.
- Diferenças materiais não são corrigidas neste escopo. A correção deve ocorrer por migration incremental nova e ser revalidada em dois ciclos.
- O diff não autoriza \`migration repair\`, alteração de histórico ou aplicação do bootstrap em homologação.
`
}

function differenceRows(platform) {
  return categories().map(({ name }) => {
    const item = comparisons[name]
    const remoteCount = countScoped(auditEvidence.remote[name] ?? [], name, platform)
    const cleanCount = countScoped(cleanCatalog[name] ?? [], name, platform)
    return [name, remoteCount, cleanCount, ...['same', 'presentationOnly', 'ownerOnly', 'different', 'onlyRemote', 'onlyClean'].map((type) => item[type].filter((key) => isPlatformKey(key) === platform).length)]
  })
}

function countScoped(rows, category, platform) {
  const config = categories().find((item) => item.name === category)
  return rows.filter((row) => isPlatformKey(config.key(row)) === platform).length
}

function isPlatformKey(key) {
  return key === 'storage' || key.startsWith('storage.') || key.includes('.storage.')
}

function renderDifferenceLists(platform, names) {
  const blocks = []
  for (const name of names) {
    const item = comparisons[name]
    if (!item) continue
    const actual = item.different.filter((key) => isPlatformKey(key) === platform)
    const presentation = item.presentationOnly.filter((key) => isPlatformKey(key) === platform)
    const owner = item.ownerOnly.filter((key) => isPlatformKey(key) === platform)
    if (!actual.length && !presentation.length && !owner.length) continue
    blocks.push(`#### ${name}\n\n- Materiais (${actual.length}): ${inlineList(actual)}\n- Apresentação (${presentation.length}): ${inlineList(presentation)}\n- Owner/grantability (${owner.length}): ${inlineList(owner)}`)
  }
  return blocks.join('\n\n') || 'Nenhuma diferença nesta classe.'
}

function renderOnlyLists(platform, names) {
  const blocks = []
  for (const name of names) {
    const item = comparisons[name]
    if (!item) continue
    const remote = item.onlyRemote.filter((key) => isPlatformKey(key) === platform)
    const clean = item.onlyClean.filter((key) => isPlatformKey(key) === platform)
    if (!remote.length && !clean.length) continue
    blocks.push(`#### ${name}\n\n- Só homologação (${remote.length}): ${inlineList(remote)}\n- Só clean-room (${clean.length}): ${inlineList(clean)}`)
  }
  return blocks.join('\n\n') || 'Nenhum objeto exclusivo nesta classe.'
}

function buildReport() {
  const partial = auditEvidence.comparison.migrations.filter((item) => item.classification === 'materially_partially_applied')
  const divergent = auditEvidence.comparison.migrations.filter((item) => item.classification === 'divergent')
  const checks = cleanEvidence.cycles[0].functionalChecks.map((item) => `${item.passed ? '☑' : '☐'} ${item.name}`).join('\n')
  return `# Escopo 9E — reconstrução do schema-base e clean-room

## Parecer executivo

**NO-GO PARA CUTOVER DEFINITION.**

A origem histórica do schema-base foi reconstruída, o candidato foi mantido fora da cadeia ativa e a instalação \`bootstrap + ${EXPECTED_MIGRATIONS} migrations\` foi concluída com sucesso em **dois bancos descartáveis independentes**. Os dumps e catálogos finais são idênticos entre os ciclos.

O cutover ainda não pode ser definido porque a instalação limpa não reproduz integralmente homologação. O desvio mais crítico é RLS desabilitada em \`public.devedores_solidarios\` no clean-room, embora esteja habilitada em homologação. Além disso, o stack Supabase completo não pôde ser iniciado no Docker Desktop desta estação; a prova executada cobre PostgreSQL, schema Storage e checks funcionais reduzidos, mas não comprova Auth/Storage API em execução integrada.

## 1. Escopo e garantias

- Nenhuma migration ativa foi editada.
- Nenhum arquivo \`001\`/\`002\` foi adicionado a \`supabase/migrations\`.
- Nenhuma conexão remota foi usada pelo clean-room.
- A evidência de homologação utilizada é somente leitura e vem do Escopo 9D.
- Nenhum \`migration repair\`, alteração de histórico ou mutation remota foi executado.
- O bootstrap candidato está em \`scripts/perf9e/bootstrap/schema-base-candidate.sql\`.

## 2. Reconstrução da fonte

O arquivo \`supabase/schema.sql\` foi localizado no histórico Git. O commit \`${SOURCE_COMMIT}\` removeu a antiga migration \`002_contratos.sql\`, introduziu \`003_storage_buckets_env.sql\` e consolidou o estado-base no schema. O blob atual de \`supabase/schema.sql\` é o mesmo blob histórico \`${SOURCE_BLOB}\`; portanto, a fonte não foi copiada do estado atual de homologação.

O candidato é uma cópia mecânica rastreável dessa fonte, acrescida apenas de cabeçalho de segurança e transação explícita. O manifest completo está em [bootstrap-candidate-manifest.json](./bootstrap-candidate-manifest.json).

### Defaults legados preservados

O schema histórico contém nomes/CPFs default de testemunhas e razão social/CNPJ default de gestora e custodiante. Eles foram preservados para não alterar silenciosamente o baseline. Isso é dívida de dados/privacidade e deve ser saneado por migration incremental específica, inclusive porque migrations posteriores também inserem testemunhas.

## 3. Procedimento clean-room

Cada ciclo:

1. criou um container PostgreSQL novo, sem volume persistente;
2. provisionou o núcleo Storage compatível com a configuração local;
3. criou o helper padrão de plataforma \`auth.jwt()\` exigido pelo fluxo MFA;
4. aplicou o bootstrap candidato;
5. aplicou as ${EXPECTED_MIGRATIONS} migrations ativas na ordem canônica;
6. registrou o histórico local;
7. executou checks funcionais reduzidos de RLS/multifundo/Storage;
8. gerou dump e catálogo normalizados;
9. destruiu o container.

Comando reproduzível, protegido por confirmação explícita:

\`npm run perf9e:clean-room -- --confirm DISPOSABLE_LOCAL_ONLY\`

O runner recusa argumentos remotos, arquivos de ambiente, project ref e qualquer número de ciclos diferente de dois.

## 4. Resultado dos ciclos

${markdownTable(['Ciclo', 'Bootstrap + migrations', 'Checks', 'Dump SHA-256', 'Catálogo SHA-256', 'Resultado'], cleanEvidence.cycles.map((cycle) => [cycle.cycle, `${cycle.applicationMigrations.filter((item) => item.success).length}/${EXPECTED_MIGRATIONS + 1}`, `${cycle.functionalChecks.filter((item) => item.passed).length}/${cycle.functionalChecks.length}`, cycle.schemaDump.sha256, cycle.catalog.sha256, cycle.success ? 'Aprovado' : 'Falhou']))}

- Dump normalizado reproduzível: **sim**.
- Catálogo reproduzível: **sim**.
- Seed de aplicação executado: **não**.
- Conexão remota: **não**.

### Checks funcionais reduzidos

${checks}

Os checks incluem cenário real de dois fundos, bloqueio de acesso cruzado, filtro RLS e recusa de objeto Storage sem autorização.

## 5. Limitação do stack completo

O runner \`perf9e:clean-room:full-stack\` foi mantido como diagnóstico. O Supabase CLI 2.111.0 não concluiu \`supabase start\` nesta estação por falhas internas do Docker Desktop/containerd (metadata read-only) e, após reinício, falha no helper de setup do Realtime. Nenhuma migration chegou a ser executada nessa modalidade.

O clean-room de banco usa imagens oficiais Supabase e é evidência válida para DDL, RLS, grants, funções, triggers e schema Storage. Ainda é necessário repetir o stack completo em um host Docker saudável para validar Auth, PostgREST, Realtime e Storage API em conjunto.

## 6. Migrations parciais e divergentes do Escopo 9D

### Oito parcialmente materializadas

${markdownTable(['Versão', 'Nome', 'Parecer 9E'], partial.map((item) => [item.version, item.name, 'A cadeia limpa aplica integralmente e converge nos dois ciclos; homologação permanece sem histórico/evidência integral e não deve ser reparada automaticamente.']))}

### Duas divergentes

${markdownTable(['Versão', 'Nome', 'Divergência 9D', 'Parecer 9E'], divergent.map((item) => [item.version, item.name, item.evidence.filter((e) => e.status === 'divergent').map((e) => `${e.kind}:${e.object}`).join(', '), 'Clean-room é estável, mas não prova equivalência retroativa com homologação; requer reconciliação explícita e read-only antes de qualquer plano de repair.']))}

A classificação 9D não foi reescrita. O 9E demonstra que a cadeia, quando parte do baseline candidato, alcança um estado determinístico; isso não autoriza inferir que migrations sem histórico foram aplicadas corretamente em homologação.

## 7. Referências futuras na RPC de reset

A migration \`20260723182639_reset_operacional_fundo_homolog_rpc.sql\` referencia objetos criados posteriormente, incluindo \`eventos_dominio\` e \`cedente_fundo_politicas\`. Ela aplica porque PL/pgSQL posterga parte da resolução de relações até a execução da função. No estado intermediário da cadeia, porém, a RPC não é segura para execução. Ao final dos ${EXPECTED_MIGRATIONS} arquivos as referências existem e o schema converge.

Recomendação: em evolução futura, mover a criação/substituição final da RPC para depois das dependências ou adicionar uma migration incremental que a recrie no ponto correto. Não reordenar migrations já aplicadas.

## 8. Schema diff final

O diff completo e classificado está em [schema-diff-homolog-vs-clean-final.md](./schema-diff-homolog-vs-clean-final.md).

Achados centrais:

- \`public.devedores_solidarios\`: RLS ligada em homologação e desligada no clean-room;
- a constraint de valor bruto, a função \`registrar_cte_documento\`, a policy de eventos e as policies de auditoria terminam com semântica diferente;
- uma FK de remessa CNAB e o helper \`update_updated_at_column()\` existem somente no clean-room;
- diferenças exclusivas de \`storage\` foram separadas por versão de plataforma;
- diferenças de owner e grantability foram registradas como artefatos do executor, não descartadas.

## 9. Segurança e segredos

- Os artefatos não contêm URLs de banco, tokens, JWTs ou senhas.
- Evidências brutas e dumps permanecem fora do repositório, em diretório local restrito.
- O candidato contém PII/defaults de negócio históricos, explicitamente inventariados; não contém credenciais.
- Os runners sanitizam variáveis remotas e exigem confirmação fechada.

## 10. Próximas ações obrigatórias

1. criar migration incremental para habilitar e testar RLS em \`public.devedores_solidarios\`;
2. reconciliar cada diferença material de aplicação listada no diff, sem editar migrations aplicadas;
3. alinhar/pinar a versão da plataforma Storage usada no teste com a versão de destino;
4. executar o stack Supabase completo em host Docker saudável;
5. repetir dois ciclos e o diff até não existir desvio material;
6. somente então definir estratégia de cutover e eventual reconciliação do histórico 9D.

## 11. Critérios de aceite do 9E

- ☑ origem histórica do baseline comprovada;
- ☑ candidato fora da cadeia ativa;
- ☑ ${EXPECTED_MIGRATIONS} migrations aplicadas duas vezes do zero;
- ☑ dumps e catálogos reproduzíveis;
- ☑ checks reduzidos 9B/9C aprovados;
- ☑ diff homologação versus clean-room concluído;
- ☐ equivalência material com homologação;
- ☐ RLS integralmente reproduzida;
- ☐ stack Supabase completo aprovado;
- ☐ elegibilidade para cutover.

## Conclusão

A cadeia tornou-se **reproduzível a partir do bootstrap candidato**, um avanço material sobre o diagnóstico 9D. Ela ainda não é equivalente ao estado de homologação e não reproduz uma proteção RLS existente. O resultado oficial é **NO-GO PARA CUTOVER DEFINITION**. Nenhuma alteração remota foi realizada.
`
}

function append9dLink() {
  const path = resolve(docsDirectory, 'relatorio-escopo-9d-reconciliacao-migrations.md')
  const current = readFileSync(path, 'utf8')
  const heading = '## Atualização — Escopo 9E'
  if (current.includes(heading)) return
  const addition = `\n\n${heading}\n\nA reconstrução do schema-base, os dois ciclos clean-room e o diff final estão documentados em [relatorio-escopo-9e-bootstrap-clean-room.md](./relatorio-escopo-9e-bootstrap-clean-room.md). O resultado 9E é NO-GO para definição de cutover; esta atualização não altera as classificações históricas do 9D.\n`
  writeFileSync(path, `${current.trimEnd()}${addition}`, 'utf8')
}

function writeJson(name, value) {
  writeFileSync(resolve(docsDirectory, name), `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function writeText(name, value) {
  writeFileSync(resolve(docsDirectory, name), value.trimStart(), 'utf8')
}

function countBy(items, classifier) {
  return items.reduce((result, item) => {
    const key = classifier(item)
    result[key] = (result[key] ?? 0) + 1
    return result
  }, {})
}

function inlineList(items) {
  if (!items.length) return 'nenhum'
  return items.map((item) => `\`${item}\``).join(', ')
}

function markdownTable(headers, rows) {
  const render = (values) => `| ${values.map((value) => String(value ?? '').replaceAll('|', '\\|')).join(' | ')} |`
  return [render(headers), render(headers.map(() => '---')), ...rows.map(render)].join('\n')
}
