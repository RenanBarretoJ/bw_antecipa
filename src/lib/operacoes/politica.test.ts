import { describe, expect, it } from 'vitest'
import { criarSnapshotPolitica, stableStringify, statusAceiteInicial, type PoliticaResolvida } from './politica'

const policy = (): PoliticaResolvida => ({
  cedenteFundo: { id: 'link-1', cedente_id: 'cedente-1', fundo_id: 'fundo-1', codigo_externo: null, status: 'ativo', vigente_desde: '2026-01-01T00:00:00Z', vigente_ate: null, observacoes: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  fundo: { id: 'fundo-1', nome: 'Fundo', cnpj: '123', administradora_nome: 'Adm', administradora_cnpj: '456', gestora_nome: 'Gestora', gestora_cnpj: '789', custodiante_nome: null, custodiante_cnpj: null, conta_vinculada: null, agencia: null, banco: null, administradora_endereco: null, administradora_ato_declaratorio: null, contato_nome: null, contato_email: null, ativo: true, created_at: '2026-01-01T00:00:00Z' },
  politica: { id: 'policy-1', cedente_fundo_id: 'link-1', codigo: 'POL-1', nome: 'Politica', descricao: null, status: 'ativa', created_by: 'user-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  versao: { id: 'version-1', politica_operacional_id: 'policy-1', cedente_fundo_id: 'link-1', versao: 1, vigente_desde: '2026-01-01T00:00:00Z', vigente_ate: null, aceite_sacado_obrigatorio: true, cessao_no_desembolso: true, cria_acompanhamento_entrega: false, configuracao: { limite: 100 }, conteudo_hash: 'draft-hash', publicada_por: 'user-1', publicada_em: '2026-01-01T00:00:00Z', created_at: '2026-01-01T00:00:00Z' },
  requisitos: [{ id: 'req-1', politica_operacional_versao_id: 'version-1', politica_operacional_id: 'policy-1', cedente_fundo_id: 'link-1', codigo: 'NF-XML', escopo: 'nf_pre_cessao', tipo_documento_codigo: 'nf_xml', obrigatorio: true, quantidade_minima: 1, formatos_aceitos: ['xml'], nivel_validacao: 'estrutural', prazo_dias_corridos: 2, responsavel_upload: 'cedente', responsavel_aprovacao: 'gestor', ordem: 1, ativo: true, created_at: '2026-01-01T00:00:00Z' }],
})

describe('snapshot de politica operacional', () => {
  it('serializa de forma deterministica e inclui prazos nos requisitos', () => {
    const first = criarSnapshotPolitica(policy())
    const second = criarSnapshotPolitica(policy())
    expect(first.hash).toBe(second.hash)
    expect(first.snapshot.requisitos[0].prazo_dias_corridos).toBe(2)
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
  })

  it('rejeita segredo na configuracao persistida', () => {
    const input = policy()
    input.versao.configuracao = { api_key: 'nao-persistir' }
    expect(() => criarSnapshotPolitica(input)).toThrow(/segredo/i)
  })

  it('rejeita dados bancarios ou payload externo na configuracao', () => {
    const input = policy()
    input.versao.configuracao = { conta_vinculada: 'nao-persistir' }
    expect(() => criarSnapshotPolitica(input)).toThrow(/segredo/i)
  })

  it('define aceite pendente ou dispensado conforme a versao', () => {
    expect(statusAceiteInicial(true)).toBe('pendente')
    expect(statusAceiteInicial(false)).toBe('dispensado')
  })
})
