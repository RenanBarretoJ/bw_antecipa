import { z } from 'zod'

export const codigoCotaCarteiraSchema = z.string().trim().regex(/^[A-Za-z0-9._-]{1,100}$/, 'Informe um código de até 100 caracteres, usando letras, números, ponto, hífen ou sublinhado.')
const cotaEsperadaSchema = z.object({
  codigoCarteira: codigoCotaCarteiraSchema,
  rotulo: z.string().trim().min(1, 'Informe o nome da cota.').max(100, 'Use até 100 caracteres para o nome da cota.'),
}).strict()

/** Lista explícita da versão técnica do Fundo; não é o UUID da carteira VRS. */
export const configuracaoCarteiraConsolidadaSchema = z.object({
  versao: z.literal(1),
  cotas: z.array(cotaEsperadaSchema).min(1, 'Adicione pelo menos uma cota.').max(100, 'São permitidas até 100 cotas.'),
}).strict().superRefine((value, ctx) => {
  const contagens = new Map<string, number>()
  for (const cota of value.cotas) contagens.set(cota.codigoCarteira, (contagens.get(cota.codigoCarteira) ?? 0) + 1)
  value.cotas.forEach((cota, index) => {
    if (contagens.get(cota.codigoCarteira)! > 1) {
      ctx.addIssue({ code: 'custom', path: ['cotas', index, 'codigoCarteira'], message: 'Este código já foi informado em outra cota.' })
    }
  })
})

export type ConfiguracaoCarteiraConsolidada = z.infer<typeof configuracaoCarteiraConsolidadaSchema>
export type CotaEsperadaVortx = z.infer<typeof cotaEsperadaSchema>
export const ERRO_CONFIGURACAO_COTAS = 'Revise as cotas esperadas da carteira: informe código e nome para todas as cotas, sem códigos repetidos.'

export type LeituraConfiguracaoCarteiraVortx =
  | { estado: 'NAO_CONFIGURADA' }
  | { estado: 'INVALIDA' }
  | { estado: 'CONFIGURADA'; configuracao: ConfiguracaoCarteiraConsolidada }

export function lerConfiguracaoCarteiraVortx(configuracao: Record<string, unknown>): LeituraConfiguracaoCarteiraVortx {
  if (!Object.hasOwn(configuracao, 'carteira_consolidada')) return { estado: 'NAO_CONFIGURADA' }
  const parsed = configuracaoCarteiraConsolidadaSchema.safeParse(configuracao.carteira_consolidada)
  return parsed.success ? { estado: 'CONFIGURADA', configuracao: parsed.data } : { estado: 'INVALIDA' }
}

/** undefined preserva; null remove explicitamente, deixando a consolidação bloqueada. */
export function prepararConfiguracaoCarteiraVortx(configuracao: Record<string, unknown>, valor?: unknown): Record<string, unknown> {
  const proxima = { ...configuracao }
  if (valor === null) {
    delete proxima.carteira_consolidada
    return proxima
  }
  if (valor !== undefined) proxima.carteira_consolidada = valor
  const leitura = lerConfiguracaoCarteiraVortx(proxima)
  if (leitura.estado === 'INVALIDA') throw new Error(ERRO_CONFIGURACAO_COTAS)
  if (leitura.estado === 'CONFIGURADA') proxima.carteira_consolidada = leitura.configuracao
  return proxima
}

export function validarConfiguracaoCarteiraVortx(configuracao: Record<string, unknown>): string | null {
  return lerConfiguracaoCarteiraVortx(configuracao).estado === 'INVALIDA' ? ERRO_CONFIGURACAO_COTAS : null
}
