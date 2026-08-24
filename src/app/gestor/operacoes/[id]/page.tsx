import { AcompanhamentoLogisticoOperacao, normalizarFiltroLogistico } from '@/components/operacoes/AcompanhamentoLogisticoOperacao'
import { ExposicaoLogisticaOperacaoServer } from '@/components/operacoes/ExposicaoLogisticaOperacaoServer'
import { obterDataCivilOperacional } from '@/lib/operacoes/data-operacional.server'
import OperacaoDetalheGestorClient from './OperacaoDetalheGestorClient'

type SearchParams = Record<string, string | string[] | undefined>

function primeiro(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export default async function OperacaoDetalheGestorPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<SearchParams>
}) {
  const [{ id }, query] = await Promise.all([params, searchParams])
  const returnToParam = primeiro(query.returnTo)
  const returnTo = returnToParam === '/gestor/operacoes' || returnToParam?.startsWith('/gestor/operacoes?')
    ? returnToParam
    : '/gestor/operacoes'
  const pagina = Number(primeiro(query.logisticaPagina) || '1')
  const acompanhamentoQuery = {
    expandido: primeiro(query.logisticaExpandida) === '1',
    pagina: Number.isInteger(pagina) && pagina > 0 ? pagina : 1,
    filtro: normalizarFiltroLogistico(query.logisticaFiltro),
    busca: primeiro(query.logisticaBusca) || '',
  }

  return (
    <OperacaoDetalheGestorClient
      opId={id}
      returnTo={returnTo}
      dataBaseServidor={obterDataCivilOperacional()}
      acompanhamentoLogistico={(
        <AcompanhamentoLogisticoOperacao
          operacaoId={id}
          query={acompanhamentoQuery}
          returnTo={returnTo}
        />
      )}
      exposicaoLogistica={(
        <ExposicaoLogisticaOperacaoServer operacaoId={id} variante="gestor-operacao" />
      )}
    />
  )
}
