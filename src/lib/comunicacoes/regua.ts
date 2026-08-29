import { adicionarDiasCivis, ajustarDataEnvio, diferencaDiasCivis } from './calendario'
import type { EtapaRegua, ReguaComunicacao } from './tipos'

export function validarRegua(regua: ReguaComunicacao): ReguaComunicacao {
  const offsets = [...new Set(regua.offsets)].sort((a, b) => a - b)
  if (!offsets.length || offsets.some((value) => !Number.isInteger(value))) throw new Error('A regua deve possuir offsets inteiros.')
  if (!Number.isInteger(regua.recorrenciaDias) || regua.recorrenciaDias < 1) throw new Error('A recorrencia minima e de um dia.')
  if (!Number.isInteger(regua.recorrenciaApos) || regua.recorrenciaApos < 0) throw new Error('Inicio da recorrencia invalido.')
  return { offsets, recorrenciaApos: regua.recorrenciaApos, recorrenciaDias: regua.recorrenciaDias }
}
function etapa(dataObrigacao: string, offset: number, recorrente: boolean): EtapaRegua {
  const dataNominal = adicionarDiasCivis(dataObrigacao, offset)
  const ajuste = ajustarDataEnvio(dataNominal, offset)
  return {
    chave: `${recorrente ? 'R' : 'D'}${offset >= 0 ? '+' : ''}${offset}`,
    offset,
    dataObrigacao,
    dataNominal,
    dataEfetiva: ajuste.dataEfetiva,
    motivoAjuste: ajuste.motivoAjuste,
    recorrente,
  }
}

export function listarEtapasAte(dataObrigacao: string, dataLimite: string, input: ReguaComunicacao): EtapaRegua[] {
  const regua = validarRegua(input)
  const limiteOffset = diferencaDiasCivis(dataObrigacao, dataLimite) + 7
  const offsets = [...regua.offsets]
  for (let offset = regua.recorrenciaApos + regua.recorrenciaDias; offset <= limiteOffset; offset += regua.recorrenciaDias) {
    if (!offsets.includes(offset)) offsets.push(offset)
  }
  return offsets.sort((a, b) => a - b).map((offset) => etapa(dataObrigacao, offset, offset > regua.recorrenciaApos))
}

export function colapsarEtapasNaMesmaData(etapas: EtapaRegua[]): EtapaRegua[] {
  const byDate = new Map<string, EtapaRegua>()
  for (const item of etapas) {
    const atual = byDate.get(item.dataEfetiva)
    if (!atual || item.offset > atual.offset) byDate.set(item.dataEfetiva, item)
  }
  return [...byDate.values()].sort((a, b) => a.dataEfetiva.localeCompare(b.dataEfetiva))
}

export function resolverEtapaAcionavel(input: {
  dataObrigacao: string
  dataExecucao: string
  ativadaEm: string
  regua: ReguaComunicacao
  etapasComunicadas?: ReadonlySet<string>
}): EtapaRegua | null {
  if (input.dataExecucao < input.ativadaEm) return null
  const comunicadas = input.etapasComunicadas ?? new Set<string>()
  const etapas = colapsarEtapasNaMesmaData(listarEtapasAte(input.dataObrigacao, input.dataExecucao, input.regua))
  const exata = etapas
    .filter((item) => item.dataEfetiva === input.dataExecucao && !comunicadas.has(item.chave))
    .sort((a, b) => b.offset - a.offset)[0]
  if (exata) return exata

  // Catch-up controlado: uma obrigacao ja acionavel na ativacao recebe somente
  // o estagio mais critico aplicavel, nunca a sequencia historica completa.
  const nenhumaComunicada = etapas.every((item) => !comunicadas.has(item.chave))
  if (nenhumaComunicada && input.dataExecucao >= input.ativadaEm) {
    return etapas
      .filter((item) => item.dataEfetiva <= input.dataExecucao)
      .sort((a, b) => b.offset - a.offset)[0] ?? null
  }
  return null
}
