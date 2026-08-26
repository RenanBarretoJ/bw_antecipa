import 'server-only'
import type { CnpjDadosConsultados } from './types'

export type { CnpjDadosConsultados }

export type CnpjConsultaResult =
  | { ok: true; dados: CnpjDadosConsultados }
  | { ok: false; categoria: 'cnpj_invalido' | 'nao_encontrado' | 'indisponivel' | 'timeout'; mensagem: string }

const BRASILAPI_BASE_URL = 'https://brasilapi.com.br/api/cnpj/v1'
const TIMEOUT_MS = 8_000

function normalizarCnpj(valor: string): string {
  return (valor || '').replace(/\D/g, '')
}

export function validarCnpjServer(cnpj: string): boolean {
  const nums = normalizarCnpj(cnpj)
  if (nums.length !== 14 || /^(\d)\1+$/.test(nums)) return false
  const calc = (weights: number[]) => weights.reduce((sum, w, i) => sum + Number(nums[i]) * w, 0)
  const r1 = calc([5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) % 11
  const d1 = r1 < 2 ? 0 : 11 - r1
  if (Number(nums[12]) !== d1) return false
  const r2 = calc([6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]) % 11
  const d2 = r2 < 2 ? 0 : 11 - r2
  return Number(nums[13]) === d2
}

type BrasilApiCnpjResponse = {
  razao_social?: string
  nome_fantasia?: string
  cnae_fiscal_descricao?: string
  descricao_situacao_cadastral?: string
  cep?: string
  logradouro?: string
  numero?: string
  complemento?: string
  bairro?: string
  municipio?: string
  uf?: string
  ddd_telefone_1?: string
  email?: string
}

/**
 * Consulta CNPJ na BrasilAPI, sempre server-side. A UI nunca deve chamar a
 * BrasilAPI diretamente (P0_Claude_Cadastro_Cedente_CNPJ_CEP_Bancos_Filiais).
 */
export async function consultarCnpj(cnpjBruto: string, fetchFn: typeof fetch = fetch): Promise<CnpjConsultaResult> {
  const cnpj = normalizarCnpj(cnpjBruto)
  if (!validarCnpjServer(cnpj)) {
    return { ok: false, categoria: 'cnpj_invalido', mensagem: 'CNPJ invalido.' }
  }

  let response: Response
  try {
    response = await fetchFn(`${BRASILAPI_BASE_URL}/${cnpj}`, {
      method: 'GET',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: 'application/json' },
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      return { ok: false, categoria: 'timeout', mensagem: 'A consulta de CNPJ demorou demais para responder. Tente novamente ou preencha manualmente.' }
    }
    return { ok: false, categoria: 'indisponivel', mensagem: 'Nao foi possivel consultar o CNPJ agora. Preencha os dados manualmente.' }
  }

  if (response.status === 404) {
    return { ok: false, categoria: 'nao_encontrado', mensagem: 'CNPJ nao encontrado na Receita Federal.' }
  }
  if (!response.ok) {
    return { ok: false, categoria: 'indisponivel', mensagem: 'Servico de consulta de CNPJ indisponivel no momento. Preencha os dados manualmente.' }
  }

  let payload: BrasilApiCnpjResponse
  try {
    payload = await response.json()
  } catch {
    return { ok: false, categoria: 'indisponivel', mensagem: 'Resposta invalida do servico de CNPJ. Preencha os dados manualmente.' }
  }

  return {
    ok: true,
    dados: {
      cnpj,
      razao_social: payload.razao_social || '',
      nome_fantasia: payload.nome_fantasia || '',
      cnae_principal: payload.cnae_fiscal_descricao || '',
      situacao_cadastral: payload.descricao_situacao_cadastral || '',
      cep: (payload.cep || '').replace(/\D/g, ''),
      logradouro: payload.logradouro || '',
      numero: payload.numero || '',
      complemento: payload.complemento || '',
      bairro: payload.bairro || '',
      cidade: payload.municipio || '',
      uf: payload.uf || '',
      telefone: payload.ddd_telefone_1 || '',
      email: payload.email || '',
    },
  }
}
