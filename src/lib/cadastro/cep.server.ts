import 'server-only'
import type { CepDadosConsultados } from './types'

export type { CepDadosConsultados }

export type CepConsultaResult =
  | { ok: true; dados: CepDadosConsultados }
  | { ok: false; categoria: 'cep_invalido' | 'nao_encontrado' | 'indisponivel' | 'timeout'; mensagem: string }

const VIACEP_BASE_URL = 'https://viacep.com.br/ws'
const TIMEOUT_MS = 6_000

function normalizarCep(valor: string): string {
  return (valor || '').replace(/\D/g, '')
}

type ViaCepResponse = {
  erro?: boolean
  cep?: string
  logradouro?: string
  bairro?: string
  localidade?: string
  uf?: string
}

/**
 * Consulta CEP no ViaCEP, sempre server-side. A UI nunca deve chamar o
 * ViaCEP diretamente (P0_Claude_Cadastro_Cedente_CNPJ_CEP_Bancos_Filiais).
 */
export async function consultarCep(cepBruto: string, fetchFn: typeof fetch = fetch): Promise<CepConsultaResult> {
  const cep = normalizarCep(cepBruto)
  if (cep.length !== 8) {
    return { ok: false, categoria: 'cep_invalido', mensagem: 'CEP invalido.' }
  }

  let response: Response
  try {
    response = await fetchFn(`${VIACEP_BASE_URL}/${cep}/json/`, {
      method: 'GET',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { ok: false, categoria: 'timeout', mensagem: 'A consulta de CEP demorou demais para responder. Tente novamente ou preencha manualmente.' }
    }
    return { ok: false, categoria: 'indisponivel', mensagem: 'Nao foi possivel consultar o CEP agora. Preencha o endereco manualmente.' }
  }

  if (!response.ok) {
    return { ok: false, categoria: 'indisponivel', mensagem: 'Servico de consulta de CEP indisponivel no momento. Preencha o endereco manualmente.' }
  }

  let payload: ViaCepResponse
  try {
    payload = await response.json()
  } catch {
    return { ok: false, categoria: 'indisponivel', mensagem: 'Resposta invalida do servico de CEP. Preencha o endereco manualmente.' }
  }

  if (payload.erro) {
    return { ok: false, categoria: 'nao_encontrado', mensagem: 'CEP nao encontrado.' }
  }

  return {
    ok: true,
    dados: {
      cep,
      logradouro: payload.logradouro || '',
      bairro: payload.bairro || '',
      cidade: payload.localidade || '',
      uf: payload.uf || '',
    },
  }
}
