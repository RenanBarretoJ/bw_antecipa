import type { RemessaOperacao, ResultadoValidacao } from '@/lib/cnab/domain'
import { geradorCnab444, validarCnab444Conteudo } from '@/lib/cnab/layouts/cnab444'

export function validarRemessa(input: RemessaOperacao): ResultadoValidacao {
  if (input.configuracao.layout === 'cnab444') return geradorCnab444.validar(input)
  return { valido: false, erros: [`Layout nao suportado: ${input.configuracao.layout}`], avisos: [] }
}

export function validarRemessaGerada(conteudo: string, quantidadeTitulos: number, layout: string): ResultadoValidacao {
  if (layout === 'cnab444') return validarCnab444Conteudo(conteudo, quantidadeTitulos)
  return { valido: false, erros: [`Layout nao suportado: ${layout}`], avisos: [] }
}

