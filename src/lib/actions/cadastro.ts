'use server'

import { requireAuthenticated, requireRole } from '@/lib/auth/authorization'
import { consultarCnpj, type CnpjDadosConsultados } from '@/lib/cadastro/cnpj.server'
import { consultarCep, type CepDadosConsultados } from '@/lib/cadastro/cep.server'
import { buscarBancos, sincronizarBancosBrasilApi, type BancoCatalogo } from '@/lib/cadastro/bancos.server'

export type ConsultaAction<T> =
  | { success: true; dados: T }
  | { success: false; message: string }

export async function consultarCnpjCadastro(cnpj: string): Promise<ConsultaAction<CnpjDadosConsultados>> {
  await requireAuthenticated()
  const resultado = await consultarCnpj(cnpj)
  if (!resultado.ok) return { success: false, message: resultado.mensagem }
  return { success: true, dados: resultado.dados }
}

export async function consultarCepCadastro(cep: string): Promise<ConsultaAction<CepDadosConsultados>> {
  await requireAuthenticated()
  const resultado = await consultarCep(cep)
  if (!resultado.ok) return { success: false, message: resultado.mensagem }
  return { success: true, dados: resultado.dados }
}

export async function buscarBancosCadastro(termo: string): Promise<ConsultaAction<BancoCatalogo[]>> {
  const context = await requireAuthenticated()
  try {
    const dados = await buscarBancos(context.supabase, termo)
    return { success: true, dados }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Nao foi possivel consultar o catalogo de bancos.' }
  }
}

export async function sincronizarBancosCadastroAdmin(): Promise<ConsultaAction<{ totalRecebido: number; totalUpsertado: number }>> {
  const context = await requireRole('super_admin')
  try {
    const dados = await sincronizarBancosBrasilApi(context.supabase)
    return { success: true, dados }
  } catch (error) {
    return { success: false, message: error instanceof Error ? error.message : 'Nao foi possivel sincronizar o catalogo de bancos.' }
  }
}
