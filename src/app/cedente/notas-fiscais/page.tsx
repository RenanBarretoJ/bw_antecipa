import { connection } from 'next/server'
import { carregarNotasFiscaisComResumoDocumental } from '@/lib/notas-fiscais/listagem.server'
import NotasFiscaisListagem from './notas-fiscais-listagem'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function primeiroValor(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function numeroOpcional(value: string | undefined) {
  if (!value?.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export default async function NotasFiscaisCedentePage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  await connection()
  const params = await searchParams
  const filtros = {
    pagina: Number(primeiroValor(params.pagina) || 1),
    limite: Number(primeiroValor(params.limite) || 10),
    busca: primeiroValor(params.busca) || '',
    status: primeiroValor(params.status) || 'todos',
    ordenacao: primeiroValor(params.ordenacao) || 'created_at',
    direcao: primeiroValor(params.direcao) || 'desc',
    valorMin: numeroOpcional(primeiroValor(params.valorMin)),
    valorMax: numeroOpcional(primeiroValor(params.valorMax)),
    emissaoDe: primeiroValor(params.emissaoDe) || '',
    emissaoAte: primeiroValor(params.emissaoAte) || '',
    vencimentoDe: primeiroValor(params.vencimentoDe) || '',
    vencimentoAte: primeiroValor(params.vencimentoAte) || '',
  }
  const resultado = await carregarNotasFiscaisComResumoDocumental(filtros)

  return (
    <NotasFiscaisListagem
      key={[
        resultado.pagina,
        resultado.limite,
        filtros.busca,
        filtros.status,
        filtros.ordenacao,
        filtros.direcao,
        filtros.valorMin,
        filtros.valorMax,
        filtros.emissaoDe,
        filtros.emissaoAte,
        filtros.vencimentoDe,
        filtros.vencimentoAte,
        resultado.total,
        resultado.itens.map((item) => `${item.id}:${item.status}:${item.estadoSubmissao}`).join(','),
      ].join(':')}
      resultado={resultado}
      filtros={filtros}
    />
  )
}
