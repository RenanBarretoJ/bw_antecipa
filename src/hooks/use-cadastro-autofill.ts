'use client'

import { useCallback, useRef, useState } from 'react'
import { consultarCepCadastro, consultarCnpjCadastro } from '@/lib/actions/cadastro'
import type { CepDadosConsultados, CnpjDadosConsultados } from '@/lib/cadastro/types'

/**
 * Rastreia campos editados manualmente pelo usuario para que autofill de
 * CNPJ/CEP nunca sobrescreva uma edicao feita depois de uma consulta
 * (P0_Claude_Cadastro_Cedente_CNPJ_CEP_Bancos_Filiais, regra 1/3).
 * Compartilhado entre CadastroForm, AlteracaoForm e o formulario de Filial.
 */
export function useCamposEditadosManualmente() {
  const editadosRef = useRef<Set<string>>(new Set())

  const marcarEditado = useCallback((campo: string) => {
    editadosRef.current.add(campo)
  }, [])

  const filtrarNaoEditados = useCallback(<T extends Record<string, unknown>>(patch: T): Partial<T> => {
    const resultado: Partial<T> = {}
    for (const chave of Object.keys(patch) as (keyof T)[]) {
      if (editadosRef.current.has(String(chave))) continue
      const valor = patch[chave]
      if (valor === '' || valor === null || valor === undefined) continue
      resultado[chave] = valor
    }
    return resultado
  }, [])

  return { marcarEditado, filtrarNaoEditados }
}

export function useCnpjConsulta(onSucesso: (dados: CnpjDadosConsultados) => void) {
  const [consultando, setConsultando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const consultar = useCallback(async (cnpj: string) => {
    setConsultando(true)
    setErro(null)
    const resultado = await consultarCnpjCadastro(cnpj)
    setConsultando(false)
    if (!resultado.success) {
      setErro(resultado.message)
      return
    }
    onSucesso(resultado.dados)
  }, [onSucesso])

  return { consultar, consultando, erro }
}

export function useCepConsulta(onSucesso: (dados: CepDadosConsultados) => void) {
  const [consultando, setConsultando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  const consultar = useCallback(async (cep: string) => {
    setConsultando(true)
    setErro(null)
    const resultado = await consultarCepCadastro(cep)
    setConsultando(false)
    if (!resultado.success) {
      setErro(resultado.message)
      return
    }
    onSucesso(resultado.dados)
  }, [onSucesso])

  return { consultar, consultando, erro }
}
