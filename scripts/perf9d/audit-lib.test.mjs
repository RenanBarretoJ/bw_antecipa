import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertReadOnlyAuditArguments,
  assertSafeAuditTarget,
  buildMigrationDependencyGraph,
  canonicalStatementHash,
  classifyEvidence,
  extractDeclaredObjectKeys,
  findRemoteObjectsWithoutLocalOrigin,
  inventoryMigrations,
  normalizeSql,
  redactSensitiveText,
  sha256,
} from './audit-lib.mjs'

const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('inventario de migrations do Escopo 9D', () => {
  it('detecta versoes duplicadas sem depender do nome', () => {
    const directory = temporaryDirectory()
    writeFileSync(join(directory, '001_primeira.sql'), 'CREATE TABLE public.a(id uuid);')
    writeFileSync(join(directory, '001_segunda.sql'), 'CREATE TABLE public.b(id uuid);')

    const inventory = inventoryMigrations(directory)

    expect(inventory.duplicateVersions).toEqual(['001'])
  })

  it('mantem ordem canonica lexicografica e identifica nome invalido', () => {
    const directory = temporaryDirectory()
    writeFileSync(join(directory, '20260731100000_segunda.sql'), 'SELECT 2;')
    writeFileSync(join(directory, '003_primeira.sql'), 'SELECT 1;')
    writeFileSync(join(directory, 'nome-invalido.sql'), 'SELECT 3;')

    const inventory = inventoryMigrations(directory)

    expect(inventory.migrations.map((migration) => migration.filename)).toEqual([
      '003_primeira.sql',
      '20260731100000_segunda.sql',
      'nome-invalido.sql',
    ])
    expect(inventory.invalidFilenames).toEqual(['nome-invalido.sql'])
  })

  it('calcula SHA-256 do arquivo e dos statements normalizados', () => {
    const directory = temporaryDirectory()
    const sql = '-- comentario\nBEGIN; CREATE TABLE public.t (id uuid); COMMIT;'
    writeFileSync(join(directory, '001_teste.sql'), sql)

    const [migration] = inventoryMigrations(directory).migrations

    expect(migration.sha256).toBe(sha256(sql))
    expect(migration.canonicalStatementSha256).toBe(canonicalStatementHash('CREATE TABLE public.t(id uuid);'))
    expect(migration.bytes).toBeGreaterThan(0)
    expect(migration.expectations.some((item) => item.kind === 'table')).toBe(true)
  })

  it('normaliza comentarios e espacamento sem alterar literais', () => {
    expect(normalizeSql("SELECT  'a--b'  AS valor; -- comentario\n")).toBe("select 'a--b' as valor")
    expect(canonicalStatementHash('BEGIN; SELECT 1; COMMIT;')).toBe(canonicalStatementHash('SELECT 1;'))
  })

  it('reconhece objetos declarados dentro de bloco dinamico', () => {
    const keys = extractDeclaredObjectKeys(`DO $$ BEGIN
      CREATE TABLE public.interna(id uuid);
      CREATE UNIQUE INDEX interna_id_idx ON public.interna(id);
    END $$;`)

    expect(keys).toContain('table:public.interna')
    expect(keys).toContain('index:public.interna_id_idx')
  })

  it('separa dependencias locais futuras e nao resolvidas', () => {
    const directory = temporaryDirectory()
    writeFileSync(join(directory, '001_consumidor.sql'), 'ALTER TABLE public.base ADD COLUMN nome text;')
    writeFileSync(join(directory, '002_base.sql'), 'CREATE TABLE public.base(id uuid);')
    const graph = buildMigrationDependencyGraph(inventoryMigrations(directory))

    expect(graph.forwardReferences).toEqual([{ from: '002', to: '001', object: 'public.base' }])
    expect(graph.unresolvedDependencies).toEqual([])
  })

  it('nao trata indice de constraint como objeto remoto sem origem', () => {
    const directory = temporaryDirectory()
    writeFileSync(join(directory, '001_base.sql'), 'CREATE TABLE public.base(id uuid);')
    const inventory = inventoryMigrations(directory)
    const remote = {
      relations: [{ schema_name: 'public', relation_name: 'base' }],
      enums: [], routines: [], triggers: [], policies: [],
      constraints: [{ schema_name: 'public', constraint_name: 'base_pkey', contype: 'p' }],
      indexes: [{ schema_name: 'public', index_name: 'base_pkey' }],
    }

    expect(findRemoteObjectsWithoutLocalOrigin(inventory, remote)).toEqual([])
  })
})

describe('classificacao de evidencia material', () => {
  it('prioriza equivalencia ou divergencia do historico registrado', () => {
    expect(classifyEvidence({ historyPresent: true, historyEquivalent: true, evidenceStatuses: [] }))
      .toBe('registered_and_equivalent')
    expect(classifyEvidence({ historyPresent: true, historyEquivalent: false, evidenceStatuses: ['equivalent'] }))
      .toBe('divergent')
  })

  it('detecta aplicacao parcial e nao promove evidencia indeterminada', () => {
    expect(classifyEvidence({ historyPresent: false, historyEquivalent: false, evidenceStatuses: ['equivalent', 'absent'] }))
      .toBe('materially_partially_applied')
    expect(classifyEvidence({ historyPresent: false, historyEquivalent: false, evidenceStatuses: ['equivalent', 'indeterminate'] }))
      .toBe('indeterminate')
  })
})

describe('travas de seguranca da auditoria', () => {
  it('recusa producao, project ref diferente e conexao sem read-only', () => {
    const valid = { appEnv: 'homolog', projectRef: 'homolog-ref', expectedProjectRef: 'homolog-ref', readOnly: true }
    expect(assertSafeAuditTarget(valid)).toBe(true)
    expect(() => assertSafeAuditTarget({ ...valid, appEnv: 'production' })).toThrow(/homologacao/)
    expect(() => assertSafeAuditTarget({ ...valid, projectRef: 'production-ref' })).toThrow(/project ref/)
    expect(() => assertSafeAuditTarget({ ...valid, readOnly: false })).toThrow(/read-only/)
  })

  it('torna repair, apply e escrita impossiveis por argumento', () => {
    expect(assertReadOnlyAuditArguments({ 'env-file': '.env.homolog' })).toBe(true)
    for (const argument of ['repair', 'apply', 'push', 'reset', 'write', 'execute', 'prod', 'production']) {
      expect(() => assertReadOnlyAuditArguments({ [argument]: true })).toThrow(/proibido/)
    }
  })

  it('redige senha de URL e valores sensiveis em texto', () => {
    const redacted = redactSensitiveText('postgresql://user:minha-senha@db.local/postgres password=abc token=xyz')
    expect(redacted).not.toContain('minha-senha')
    expect(redacted).not.toContain('password=abc')
    expect(redacted).not.toContain('token=xyz')
    expect(redacted).toContain('***')
  })
})

function temporaryDirectory() {
  const directory = mkdtempSync(join(tmpdir(), 'bw-antecipa-perf9d-'))
  temporaryDirectories.push(directory)
  return directory
}
