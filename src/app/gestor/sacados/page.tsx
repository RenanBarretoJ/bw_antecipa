import { GestaoSacadosPage } from '@/components/sacado/GestaoSacadosPage'

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <GestaoSacadosPage params={await searchParams} basePath="/gestor/sacados" />
}
