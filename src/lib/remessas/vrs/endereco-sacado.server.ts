import 'server-only'
import { consultarCnpj, type CnpjConsultaResult } from '@/lib/cadastro/cnpj.server'
import type { RemessaNotaFiscalCanonica } from '../domain'

type Devedor = RemessaNotaFiscalCanonica['devedor']
const camposObrigatorios = ['cep', 'endereco', 'numero', 'bairro', 'municipio', 'uf'] as const
type CampoEndereco = typeof camposObrigatorios[number]

function valido(campo: CampoEndereco, valor: string | null) {
  const texto = valor?.trim() ?? ''
  if (campo === 'cep') return /^\d{5,9}$/.test(texto.replace(/\D/g, ''))
  if (campo === 'uf') return /^[A-Za-z]{2}$/.test(texto)
  return texto.length > 0
}

// Cache e limite pertencem a uma geracao, sem compartilhar dados de lotes futuros.
export function criarResolvedorEnderecoSacado(consulta = consultarCnpj) {
  const pendentes = new Map<string, Promise<CnpjConsultaResult>>()
  let emAndamento = 0
  const fila: Array<() => void> = []

  async function consultarLimitado(cnpj: string): Promise<CnpjConsultaResult> {
    if (emAndamento >= 4) await new Promise<void>(resolve => fila.push(resolve))
    else emAndamento++
    try {
      return await consulta(cnpj)
    } catch {
      return { ok: false, categoria: 'indisponivel', mensagem: 'Consulta indisponivel.' }
    } finally {
      const proxima = fila.shift()
      if (proxima) proxima()
      else emAndamento--
    }
  }

  return async function resolver(devedor: Devedor, numeroNf: string): Promise<Devedor> {
    devedor = { ...devedor }
    for (const campo of camposObrigatorios) devedor[campo] = devedor[campo]?.trim() || null
    const ausentes = camposObrigatorios.filter(campo => !valido(campo, devedor[campo]))
    if (ausentes.length === 0) return { ...devedor, fonteEndereco: 'xml' }
    const cnpj = devedor.cnpj.replace(/\D/g, '')
    let pending = pendentes.get(cnpj)
    if (!pending) {
      pending = consultarLimitado(cnpj)
      pendentes.set(cnpj, pending)
    }
    const resposta = await pending
    if (!resposta.ok) {
      throw new Error(`Endereco do sacado da NF ${numeroNf} incompleto (${ausentes.join(', ')}). Consulta de CNPJ: ${resposta.categoria}. Corrija os dados de origem ou tente novamente.`)
    }
    const dados = resposta.dados
    if (dados.cnpj.replace(/\D/g, '') !== cnpj) throw new Error(`Consulta do sacado da NF ${numeroNf} retornou outro CNPJ.`)
    const consultado: Record<CampoEndereco, string> = {
      cep: dados.cep, endereco: dados.logradouro, numero: dados.numero,
      bairro: dados.bairro, municipio: dados.cidade, uf: dados.uf,
    }
    const resolvido: Devedor = { ...devedor }
    for (const campo of ausentes) resolvido[campo] = consultado[campo]?.trim() || null
    const faltantes = camposObrigatorios.filter(campo => !valido(campo, resolvido[campo]))
    if (faltantes.length > 0) throw new Error(`Endereco do sacado da NF ${numeroNf} incompleto mesmo apos consulta de CNPJ (${faltantes.join(', ')}). Corrija os dados de origem.`)
    resolvido.fonteEndereco = ausentes.length === camposObrigatorios.length ? 'cnpj' : 'xml_cnpj'
    resolvido.camposEnderecoConsultados = [...ausentes]
    return resolvido
  }
}
