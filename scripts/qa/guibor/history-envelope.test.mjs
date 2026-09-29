import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { normalizeSql, replaceSql, sqlLiteral } from './history-envelope.mjs'
describe('GUIBOR migration history SQL envelope', () => {
  const source = "begin;\r\nselect $$, $1, $&, $', $`;\r\ncommit;\r\n"
  it('preserves all replacement metacharacters byte for byte', () => {
    expect(replaceSql('prefix SOURCE suffix', /SOURCE/, source)).toBe(`prefix ${source} suffix`)
    expect('prefix SOURCE suffix'.replace(/SOURCE/, source)).not.toBe(`prefix ${source} suffix`)
  })
  it('normalizes only CRLF and preserves SQL contents', () => {
    const normalized = normalizeSql(source)
    expect(normalized).toBe("begin;\nselect $$, $1, $&, $', $`;\ncommit;\n")
    expect(sqlLiteral(normalized)).toBe(`$guibor_history$${normalized}$guibor_history$`)
  })
  it('avoids delimiter collisions', () => {
    expect(sqlLiteral('$guibor_history$')).toBe('$guibor_history_$$guibor_history$$guibor_history_$')
  })
  it('preserves the actual applied migration and expected hash', () => {
    const sql = normalizeSql(readFileSync('supabase/migrations/20260929154656_guibor_nfse_fiscal_provenance.sql', 'utf8'))
    expect(createHash('sha256').update(sql).digest('hex')).toBe('6764965cb3be144ff3604f7aa294aafc62e90270a72d2a4d7104689571e31d76')
    expect(replaceSql('SOURCE', 'SOURCE', sql)).toBe(sql)
    expect(sqlLiteral(sql).slice('$guibor_history$'.length, -'$guibor_history$'.length)).toBe(sql)
  })
})
