import { carregarGestaoSacados } from '@/lib/sacado/gestao.server'
import { GestaoSacadosView } from './GestaoSacadosView'

export async function GestaoSacadosPage({ params, basePath }: { params: Record<string, string | string[] | undefined>; basePath: string }) {
  const result = await carregarGestaoSacados(params)
  return <GestaoSacadosView result={result} basePath={basePath} />
}
