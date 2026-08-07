import { connection } from 'next/server'
import { CentralLogisticaView } from '@/components/logistica/CentralLogisticaView'
import { carregarCentralLogistica } from '@/lib/logistica/central/central-logistica.server'
import { parseFiltrosCentralLogistica } from '@/lib/logistica/central/filtros'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function LogisticaGestorPage({ searchParams }: { searchParams: SearchParams }) {
  await connection()
  const filtros = parseFiltrosCentralLogistica(await searchParams)
  const data = await carregarCentralLogistica(filtros)
  return <CentralLogisticaView data={data} />
}
