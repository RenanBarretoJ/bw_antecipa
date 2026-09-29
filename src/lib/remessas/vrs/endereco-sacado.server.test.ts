import { describe, expect, it, vi } from 'vitest'
import type { CnpjConsultaResult } from '@/lib/cadastro/cnpj.server'
import type { RemessaNotaFiscalCanonica } from '../domain'
import { criarResolvedorEnderecoSacado } from './endereco-sacado.server'

const completo: RemessaNotaFiscalCanonica['devedor'] = {
  cnpj: '68522785000104', nome: 'Sacado do XML', cep: '01310100', endereco: 'Endereco XML',
  numero: '10', bairro: 'Centro', municipio: 'Sao Paulo', uf: 'SP', complemento: null, email: null, telefone: null,
}
const dados = {
  cnpj: completo.cnpj, razao_social: 'Nome da consulta', nome_fantasia: '', cnae_principal: '', situacao_cadastral: '',
  cep: '20040002', logradouro: 'Endereco consulta', numero: '20', bairro: 'Outro bairro', cidade: 'Rio de Janeiro', uf: 'RJ',
  complemento: '', email: '', telefone: '',
}
const resposta: CnpjConsultaResult = { ok: true, dados }

describe('endereco VRS: XML prioritario e complemento por CNPJ', () => {
  it('nao consulta quando XML possui endereco obrigatorio completo', async () => {
    const consulta = vi.fn().mockResolvedValue(resposta)
    expect(await criarResolvedorEnderecoSacado(consulta)(completo, '10')).toEqual({ ...completo, fonteEndereco: 'xml' })
    expect(consulta).not.toHaveBeenCalled()
  })

  it('completa somente campos faltantes, preservando nome, CNPJ e endereco do XML', async () => {
    const entrada = { ...completo, numero: null, uf: '' }
    const resolved = await criarResolvedorEnderecoSacado(vi.fn().mockResolvedValue(resposta))(entrada, '10')
    expect(resolved).toEqual({ ...entrada, numero: '20', uf: 'RJ', fonteEndereco: 'xml_cnpj', camposEnderecoConsultados: ['numero', 'uf'] })
    expect(entrada.numero).toBeNull()
  })

  it('resolve NF sem XML e compartilha uma unica consulta entre NFs do mesmo sacado', async () => {
    const consulta = vi.fn().mockResolvedValue(resposta)
    const resolver = criarResolvedorEnderecoSacado(consulta)
    const entrada = { ...completo, cep: null, endereco: null, numero: null, bairro: null, municipio: null, uf: null }
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => resolver(entrada, String(i))))
    expect(consulta).toHaveBeenCalledTimes(1)
    expect(results[0]).toMatchObject({ cep: dados.cep, endereco: dados.logradouro, municipio: dados.cidade, fonteEndereco: 'cnpj' })
  })

  it.each(['timeout', 'indisponivel', 'nao_encontrado', 'cnpj_invalido'] as const)('bloqueia sem fabricar endereco se consulta falhar: %s', categoria => {
    const consulta = vi.fn().mockResolvedValue({ ok: false, categoria, mensagem: 'Falha de teste' })
    return expect(criarResolvedorEnderecoSacado(consulta)({ ...completo, cep: null }, '10')).rejects.toThrow(categoria)
  })

  it('bloqueia resposta incompleta ou de outro CNPJ', async () => {
    await expect(criarResolvedorEnderecoSacado(vi.fn().mockResolvedValue({ ok: true, dados: { ...dados, cep: '' } }))({ ...completo, cep: null }, '10')).rejects.toThrow(/mesmo apos consulta/)
    await expect(criarResolvedorEnderecoSacado(vi.fn().mockResolvedValue({ ok: true, dados: { ...dados, cnpj: '12345678000195' } }))({ ...completo, cep: null }, '10')).rejects.toThrow(/outro CNPJ/)
  })

  it('limita consultas concorrentes a quatro e compartilha falhas no mesmo lote', async () => {
    let ativas = 0
    let maximo = 0
    const consulta = vi.fn(async (): Promise<CnpjConsultaResult> => {
      ativas++
      maximo = Math.max(maximo, ativas)
      await new Promise(resolve => setTimeout(resolve, 5))
      ativas--
      return { ok: false, categoria: 'indisponivel', mensagem: '' }
    })
    const resolver = criarResolvedorEnderecoSacado(consulta)
    const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => resolver({ ...completo, cnpj: String(i), cep: null }, String(i))))
    expect(maximo).toBe(4)
    expect(results.every(result => result.status === 'rejected')).toBe(true)
    await expect(resolver({ ...completo, cnpj: '0', cep: null }, '0')).rejects.toThrow(/indisponivel/)
    expect(consulta).toHaveBeenCalledTimes(12)
  })
})
