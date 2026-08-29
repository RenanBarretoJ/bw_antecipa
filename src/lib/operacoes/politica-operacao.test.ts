import { describe, expect, it } from 'vitest'
import {
  construirEtapasCronologicasOperacao,
  construirEtapasOperacao,
  construirPendenciasOperacao,
  normalizarSnapshotPoliticaOperacao,
  obterCapacidadesOperacao,
  type DocumentoOperacaoParaPolitica,
  type OperacaoParaPolitica,
} from './politica-operacao'

const requisitoPreCessao = {
  codigo: 'nf_xml',
  tipo_documento_codigo: 'nf_xml',
  escopo: 'nf_pre_cessao',
  obrigatorio: true,
  ativo: true,
}

const baseOperation: OperacaoParaPolitica = {
  status: 'em_andamento',
  created_at: '2026-07-28T10:00:00Z',
  aprovado_em: '2026-07-28T10:30:00Z',
  cessao_efetivada_em: '2026-07-28T11:00:00Z',
  liquidada_em: null,
  aceite_sacado_exigido: false,
  aceite_sacado_status: 'dispensado',
  conta_escrow_id: null,
  politica_snapshot: {
    schema: 'bw-antecipa.politica-operacional.v1',
    aceite_sacado_obrigatorio: false,
    cria_acompanhamento_entrega: false,
    requisitos: [requisitoPreCessao],
    configuracao: {},
  },
}

const documentoPreCessaoAprovado: DocumentoOperacaoParaPolitica = {
  id: 'documento-nf-xml',
  tipo_documento_codigo_snapshot: 'nf_xml',
  escopo_snapshot: 'nf_pre_cessao',
  status: 'satisfeito',
  versao_aprovada_id: 'versao-nf-xml',
  obrigatorio: true,
  analisado_em: '2026-07-28T09:55:00Z',
}

function construir(
  operacao: OperacaoParaPolitica = baseOperation,
  documentos: DocumentoOperacaoParaPolitica[] = [documentoPreCessaoAprovado],
  logistica: Array<{ status_entrega?: string | null; entrega_confirmada_em?: string | null }> = [],
) {
  const capacidades = obterCapacidadesOperacao(operacao, { documentos, logistica })
  return construirEtapasCronologicasOperacao({
    operacao,
    capacidades,
    documentos,
    logistica,
  })
}

describe('andamento cronológico da operação', () => {
  it('ordena os marcos pelo fluxo operacional e não por data de criação', () => {
    const etapas = construir()

    expect(etapas.map((item) => item.id)).toEqual([
      'documentacao',
      'solicitacao',
      'aprovacao',
      'desembolso',
      'liquidacao',
    ])
    expect(etapas.map((item) => item.ordem)).toEqual([10, 20, 50, 70, 110])
    expect(etapas.find((item) => item.id === 'documentacao')?.concluidaEm)
      .toBe('2026-07-28T09:55:00Z')
  })

  it('mantém no máximo uma etapa atual em uma operação em curso', () => {
    const etapas = construir()

    expect(etapas.filter((item) => item.status === 'atual')).toHaveLength(1)
    expect(etapas.find((item) => item.status === 'atual')?.id).toBe('liquidacao')
  })

  it('posiciona o aceite entre solicitação e análise quando ele é aplicável', () => {
    const operacao = {
      ...baseOperation,
      status: 'em_analise',
      aprovado_em: null,
      cessao_efetivada_em: null,
      aceite_sacado_exigido: true,
      aceite_sacado_status: 'aceito',
      aceite_sacado_em: '2026-07-28T10:10:00Z',
      politica_snapshot: {
        ...(baseOperation.politica_snapshot as Record<string, unknown>),
        aceite_sacado_obrigatorio: true,
      },
    }
    const etapas = construir(operacao)
    const ids = etapas.map((item) => item.id)

    expect(ids.indexOf('solicitacao')).toBeLessThan(ids.indexOf('aceite_sacado'))
    expect(ids.indexOf('aceite_sacado')).toBeLessThan(ids.indexOf('analise'))
    expect(etapas.find((item) => item.id === 'aceite_sacado')).toMatchObject({
      status: 'concluida',
      concluidaEm: '2026-07-28T10:10:00Z',
    })
    expect(etapas.find((item) => item.id === 'analise')?.status).toBe('atual')
  })

  it('oculta o aceite quando a política o dispensa', () => {
    expect(construir().some((item) => item.id === 'aceite_sacado')).toBe(false)
  })

  it('exibe documentos jurídicos somente quando previstos e antes do desembolso', () => {
    const operacao = {
      ...baseOperation,
      politica_snapshot: {
        ...(baseOperation.politica_snapshot as Record<string, unknown>),
        requisitos: [
          requisitoPreCessao,
          {
            codigo: 'termo_cessao',
            tipo_documento_codigo: 'termo_cessao',
            escopo: 'operacao',
            obrigatorio: true,
            ativo: true,
          },
        ],
      },
      termo_assinado_url: 'operacoes/termo-assinado.pdf',
    }
    const etapas = construir(operacao)
    const ids = etapas.map((item) => item.id)

    expect(ids.indexOf('aprovacao')).toBeLessThan(ids.indexOf('documentos_juridicos'))
    expect(ids.indexOf('documentos_juridicos')).toBeLessThan(ids.indexOf('desembolso'))
    expect(etapas.find((item) => item.id === 'documentos_juridicos')?.status)
      .toBe('concluida')
  })

  it('bloqueia os marcos posteriores depois de uma reprovação', () => {
    const etapas = construir({
      ...baseOperation,
      status: 'reprovada',
      aprovado_em: null,
      cessao_efetivada_em: null,
    })

    expect(etapas.find((item) => item.id === 'aprovacao')?.status).toBe('rejeitada')
    expect(etapas.find((item) => item.id === 'desembolso')?.status).toBe('bloqueada')
    expect(etapas.find((item) => item.id === 'liquidacao')?.status).toBe('bloqueada')
  })

  it('não duplica liquidação com uma etapa genérica de conclusão', () => {
    const etapas = construir({
      ...baseOperation,
      status: 'liquidada',
      liquidada_em: '2026-08-30T18:00:00Z',
    })

    expect(etapas.filter((item) => item.id === 'liquidacao')).toHaveLength(1)
    expect(etapas.some((item) => item.id === 'conclusao')).toBe(false)
    expect(etapas.find((item) => item.id === 'liquidacao')).toMatchObject({
      status: 'concluida',
      concluidaEm: '2026-08-30T18:00:00Z',
    })
  })
})

describe('momentos documentais da política', () => {
  it('consolida CT-e pré-cessão na documentação e não o repete após desembolso', () => {
    const operacao = {
      ...baseOperation,
      politica_snapshot: {
        ...(baseOperation.politica_snapshot as Record<string, unknown>),
        cria_acompanhamento_entrega: true,
        requisitos: [
          requisitoPreCessao,
          {
            codigo: 'cte_xml',
            tipo_documento_codigo: 'cte_xml',
            escopo: 'nf_pre_cessao',
            obrigatorio: true,
            ativo: true,
          },
        ],
      },
    }
    const documentos = [
      documentoPreCessaoAprovado,
      {
        id: 'cte-pre',
        tipo_documento_codigo_snapshot: 'cte_xml',
        escopo_snapshot: 'nf_pre_cessao',
        status: 'satisfeito',
        versao_aprovada_id: 'versao-cte-pre',
        obrigatorio: true,
      },
    ]
    const etapas = construir(operacao, documentos, [{ status_entrega: 'em_transito' }])

    expect(etapas.find((item) => item.id === 'documentacao')?.status).toBe('concluida')
    expect(etapas.some((item) => item.id === 'cte')).toBe(false)
  })

  it('posiciona CT-e pós-cessão depois do desembolso', () => {
    const operacao = {
      ...baseOperation,
      politica_snapshot: {
        ...(baseOperation.politica_snapshot as Record<string, unknown>),
        cria_acompanhamento_entrega: true,
        requisitos: [
          requisitoPreCessao,
          {
            codigo: 'cte_xml',
            tipo_documento_codigo: 'cte_xml',
            escopo: 'pos_cessao',
            obrigatorio: true,
            ativo: true,
          },
        ],
      },
    }
    const etapas = construir(operacao, [documentoPreCessaoAprovado], [
      { status_entrega: 'em_transito' },
    ])
    const ids = etapas.map((item) => item.id)

    expect(ids.indexOf('desembolso')).toBeLessThan(ids.indexOf('cte'))
    expect(etapas.find((item) => item.id === 'cte')?.status).toBe('atual')
  })

  it('mostra somente requisitos logísticos aplicáveis', () => {
    const operacao = {
      ...baseOperation,
      politica_snapshot: {
        ...(baseOperation.politica_snapshot as Record<string, unknown>),
        cria_acompanhamento_entrega: true,
        requisitos: [
          requisitoPreCessao,
          {
            codigo: 'comprovante_entrega',
            tipo_documento_codigo: 'comprovante_entrega',
            escopo: 'entrega',
            obrigatorio: true,
            ativo: true,
          },
        ],
      },
    }
    const ids = construir(
      operacao,
      [documentoPreCessaoAprovado],
      [{ status_entrega: 'em_transito' }],
    ).map((item) => item.id)

    expect(ids).toContain('entrega_acompanhamento')
    expect(ids).toContain('comprovante_entrega')
    expect(ids).toContain('entrega_confirmada')
    expect(ids).not.toContain('cte')
    expect(ids).not.toContain('dacte')
  })

  it('oculta todo o acompanhamento quando a política não o habilita', () => {
    const etapas = construir(baseOperation, [documentoPreCessaoAprovado], [
      { status_entrega: 'em_transito' },
    ])

    expect(etapas.some((item) => [
      'entrega_acompanhamento',
      'cte',
      'dacte',
      'comprovante_entrega',
      'entrega_confirmada',
    ].includes(item.id))).toBe(false)
  })
})

describe('compatibilidade e remoção de redundâncias', () => {
  it('não cria Pagamento identificado nem etapa técnica de CNAB', () => {
    const operacao = {
      ...baseOperation,
      conta_escrow_id: 'escrow-1',
      politica_snapshot: {
        ...(baseOperation.politica_snapshot as Record<string, unknown>),
        configuracao: { usa_cnab: true, usa_escrow: true },
      },
    }
    const capacidades = obterCapacidadesOperacao(operacao)
    const etapas = construir(operacao)

    expect(capacidades.usaEscrow).toBe(true)
    expect(capacidades.usaCnab).toBe(true)
    expect(etapas.some((item) => item.id === 'pagamento')).toBe(false)
    expect(etapas.some((item) => item.id === 'cnab')).toBe(false)
  })

  it('normaliza snapshot antigo sem alterar o objeto persistido', () => {
    const snapshot = { aceite_sacado_obrigatorio: true }
    const before = JSON.stringify(snapshot)
    const normalized = normalizarSnapshotPoliticaOperacao(snapshot)

    expect(normalized.avisos).toContain('requisitos_ausentes_no_snapshot')
    expect(normalized.aceiteSacadoObrigatorio).toBe(true)
    expect(JSON.stringify(snapshot)).toBe(before)
  })

  it('usa evidência persistida de operação antiga sem consultar política vigente', () => {
    const operacao = {
      ...baseOperation,
      politica_snapshot: null,
    }
    const documentos = [
      documentoPreCessaoAprovado,
      {
        id: 'cte-legado',
        tipo_documento_codigo_snapshot: 'cte_xml',
        escopo_snapshot: 'pos_cessao',
        status: 'pendente',
        obrigatorio: true,
      },
    ]
    const capacidades = obterCapacidadesOperacao(operacao, {
      documentos,
      logistica: [{ status_entrega: 'em_transito' }],
    })
    const etapas = construirEtapasOperacao({
      operacao,
      capacidades,
      documentos,
      logistica: [{ status_entrega: 'em_transito' }],
    })

    expect(capacidades.usaAcompanhamentoLogistico).toBe(true)
    expect(etapas.some((item) => item.id === 'cte')).toBe(true)
  })

  it('mantém o alias dos consumidores apontando para o builder central', () => {
    const capacidades = obterCapacidadesOperacao(baseOperation)
    const input = {
      operacao: baseOperation,
      capacidades,
      documentos: [documentoPreCessaoAprovado],
      logistica: [],
    }

    expect(construirEtapasOperacao(input)).toEqual(
      construirEtapasCronologicasOperacao(input),
    )
  })

  it('não cria pendência logística quando o módulo não é aplicável', () => {
    const capacidades = obterCapacidadesOperacao(baseOperation)
    const pending = construirPendenciasOperacao({
      capacidades,
      documentos: [
        {
          id: 'cte-1',
          tipo_documento_codigo_snapshot: 'cte',
          escopo_snapshot: 'entrega',
          status: 'pendente',
          obrigatorio: true,
          responsavel_upload_snapshot: 'cedente',
        },
        {
          id: 'nf-1',
          tipo_documento_codigo_snapshot: 'nf_xml',
          escopo_snapshot: 'nf_pre_cessao',
          status: 'pendente',
          obrigatorio: true,
          responsavel_upload_snapshot: 'cedente',
        },
      ],
    })

    expect(pending.map((item) => item.id)).toEqual(['nf-1'])
  })
})
