import { redirect } from 'next/navigation'
import { destinoCentralBases } from '@/lib/navigation/central-bases'

/** Compatibility for saved links; authorization remains on the destination page. */
export default async function DadosFinanceirosLegadoPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  redirect(destinoCentralBases(await searchParams))
}
