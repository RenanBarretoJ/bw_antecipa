import { connection } from 'next/server'
import { AlertTriangle, FileText } from 'lucide-react'
import { assertRole, requireAuthenticated } from '@/lib/auth/authorization'
import { ConsultorCedenteSelector } from '@/components/operacoes/ConsultorCedenteSelector'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { carregarNotasFiscaisComResumoDocumental } from '@/lib/notas-fiscais/listagem.server'
import NotasFiscaisListagem from '@/app/cedente/notas-fiscais/notas-fiscais-listagem'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function primeiroValor(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function numeroOpcional(value: string | undefined) {
  if (!value?.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export default async function NotasFiscaisConsultorPage({ searchParams }: { searchParams: SearchParams }) {
  await connection()
  const auth = await requireAuthenticated()
  assertRole(auth.profile.role, ['consultor'])
  const params = await searchParams
  const cedenteId = primeiroValor(params.cedente) || null

  if (!cedenteId) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Notas Fiscais por Cedente</CardTitle>
          </CardHeader>
          <CardContent>
            <ConsultorCedenteSelector selecionado={null} />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center text-muted-foreground">
            <FileText className="size-10" />
            <p>Selecione um Cedente para visualizar e enviar Notas Fiscais.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

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

  let resultado
  let erro: unknown = null
  try {
    resultado = await carregarNotasFiscaisComResumoDocumental(filtros, { cedenteId })
  } catch (error) {
    erro = error
  }

  if (!resultado) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Card><CardContent className="py-4"><ConsultorCedenteSelector selecionado={null} /></CardContent></Card>
        <Card>
          <CardContent className="flex items-start gap-3 py-6 text-destructive">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" />
            <p>{erro instanceof Error ? erro.message : 'Nao foi possivel carregar as Notas Fiscais deste Cedente.'}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  const selecionado = {
    id: resultado.contexto.cedenteId,
    razaoSocial: resultado.contexto.cedenteRazaoSocial,
    nomeFantasia: resultado.contexto.cedenteNomeFantasia,
    cnpj: resultado.contexto.cedenteCnpj,
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Card>
        <CardContent className="py-4">
          <ConsultorCedenteSelector selecionado={selecionado} />
        </CardContent>
      </Card>
      <NotasFiscaisListagem
        key={[
          cedenteId,
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
        ].join(':')}
        resultado={resultado}
        filtros={filtros}
        basePath="/consultor/notas-fiscais"
        cedenteIdSelecionado={cedenteId}
      />
    </div>
  )
}

export const maxDuration = 300
