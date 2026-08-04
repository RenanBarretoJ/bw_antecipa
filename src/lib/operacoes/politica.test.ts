import { describe, expect, it } from 'vitest'
import { criarSnapshotPolitica, stableStringify, statusAceiteInicial, type PoliticaResolvida } from './politica'

const policy = (): PoliticaResolvida => ({
  cedenteFundo: { id: 'link-1', cedente_id: 'cedente-1', fundo_id: 'fundo-1', codigo_externo: null, status: 'ativo', vigente_desde: '2026-01-01T00:00:00Z', vigente_ate: null, observacoes: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  fundo: { id: 'fundo-1', nome: 'Fundo', cnpj: '123', administradora_nome: 'Adm', administradora_cnpj: '456', gestora_nome: 'Gestora', gestora_cnpj: '789', custodiante_nome: null, custodiante_cnpj: null, conta_vinculada: null, agencia: null, banco: null, administradora_endereco: null, administradora_ato_declaratorio: null, contato_nome: null, contato_email: null, ativo: true, created_at: '2026-01-01T00:00:00Z' },
  atribuicao: { id: 'assignment-1', cedente_fundo_id: 'link-1', politica_operacional_id: 'policy-1', status: 'ativa', vigente_desde: '2026-01-01T00:00:00Z', vigente_ate: null, atribuido_por: 'user-1', motivo: 'teste', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  politica: { id: 'policy-1', fundo_id: 'fundo-1', codigo: 'POL-1', nome: 'Politica', descricao: null, status: 'ativa', padrao: true, created_by: 'user-1', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  versao: { id: 'version-1', politica_operacional_id: 'policy-1', fundo_id: 'fundo-1', cedente_fundo_id: null, versao: 1, status: 'publicada', vigente_desde: '2026-01-01T00:00:00Z', vigente_ate: null, aceite_sacado_obrigatorio: true, cessao_no_desembolso: true, cria_acompanhamento_entrega: false, permite_postergacao_upload_canhoto: true, limite_postergacao_upload_canhoto_dias: 5, configuracao: { limite: 100 }, regras: {}, parametros: {}, conteudo_hash: 'draft-hash', publicada_por: 'user-1', publicada_em: '2026-01-01T00:00:00Z', substituida_em: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' },
  requisitos: [{ id: 'req-1', politica_operacional_versao_id: 'version-1', politica_operacional_id: 'policy-1', fundo_id: 'fundo-1', cedente_fundo_id: null, codigo: 'NF-XML', escopo: 'nf_pre_cessao', tipo_documento_codigo: 'nf_xml', documento_tipo_id: null, obrigatorio: true, quantidade_minima: 1, formatos_aceitos: ['xml'], nivel_validacao: 'estrutural', prazo_dias_corridos: 2, momento_obrigatorio: 'nf_pre_cessao', categoria: 'nf_pre_cessao', bloqueia_fluxo: true, observacoes: null, responsavel_upload: 'cedente', responsavel_aprovacao: 'gestor', ordem: 1, ativo: true, created_at: '2026-01-01T00:00:00Z' }],
})

describe('snapshot de politica operacional', () => {
  it('serializa de forma deterministica e inclui prazos nos requisitos', () => {
    const first = criarSnapshotPolitica(policy())
    const second = criarSnapshotPolitica(policy())
    expect(first.hash).toBe(second.hash)
    expect(first.snapshot.politica_atribuicao_id).toBe('assignment-1')
    expect(first.snapshot.requisitos[0].prazo_dias_corridos).toBe(2)
    expect(first.snapshot.permite_postergacao_upload_canhoto).toBe(true)
    expect(first.snapshot.limite_postergacao_upload_canhoto_dias).toBe(5)
    expect(stableStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}')
  })

  it('congela a configuração de postergação no hash da operação', () => {
    const first = criarSnapshotPolitica(policy())
    const changed = policy()
    changed.versao.limite_postergacao_upload_canhoto_dias = 8
    const second = criarSnapshotPolitica(changed)
    expect(second.snapshot.limite_postergacao_upload_canhoto_dias).toBe(8)
    expect(second.hash).not.toBe(first.hash)
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

  it('preserva o snapshot historico quando a politica recebe requisitos posteriores', () => {
    const configuracao = policy()
    const historico = criarSnapshotPolitica(configuracao)

    configuracao.requisitos.push({
      ...configuracao.requisitos[0],
      id: 'req-2',
      codigo: 'PEDIDO-COMPRA',
      tipo_documento_codigo: 'nf_pedido_compra',
      ordem: 2,
    })
    const atual = criarSnapshotPolitica(configuracao)

    expect(historico.snapshot.requisitos.map((item) => item.id)).toEqual(['req-1'])
    expect(atual.snapshot.requisitos.map((item) => item.id)).toEqual(['req-1', 'req-2'])
    expect(historico.hash).not.toBe(atual.hash)
  })
})
