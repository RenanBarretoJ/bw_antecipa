import { describe, expect, it } from 'vitest'
import {
  mensagemErroSolicitacaoOperacao,
  NF_ALREADY_LINKED_TO_ACTIVE_OPERATION,
  NF_ALREADY_LINKED_TO_ACTIVE_OPERATION_SQLSTATE,
} from './erro-solicitacao'

describe('mensagemErroSolicitacaoOperacao', () => {
  it('mapeia o SQLSTATE P14 para mensagem de dominio amigavel', () => {
    expect(mensagemErroSolicitacaoOperacao({
      code: NF_ALREADY_LINKED_TO_ACTIVE_OPERATION_SQLSTATE,
      message: NF_ALREADY_LINKED_TO_ACTIVE_OPERATION,
    })).toBe('Uma ou mais NFs já estão vinculadas a uma operação ativa.')
  })

  it('aceita o identificador de dominio mesmo sem SQLSTATE', () => {
    expect(mensagemErroSolicitacaoOperacao({
      code: null,
      message: NF_ALREADY_LINKED_TO_ACTIVE_OPERATION,
    })).toBe('Uma ou mais NFs já estão vinculadas a uma operação ativa.')
  })

  it('preserva o tratamento atual dos demais erros do RPC', () => {
    expect(mensagemErroSolicitacaoOperacao({
      code: 'P0001',
      message: 'Conta escrow nao encontrada ou inativa',
    })).toBe('Erro ao criar operacao: Conta escrow nao encontrada ou inativa')
  })
})
