'use client'

import { Eye, Link2, ShieldCheck, SlidersHorizontal } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatCnpj } from './utils'
import type { FundoResumo, OnboardingCedente } from './types'

type Props = {
  rows: OnboardingCedente[]
  fundos: FundoResumo[]
  onVincularFundo: (cedente: OnboardingCedente) => void
  onDefinirPolitica: (cedente: OnboardingCedente) => void
  onDetalhes: (cedente: OnboardingCedente) => void
}

const statusMeta = {
  aguardando_vinculo_fundo: { label: 'Sem fundo', variant: 'destructive' },
  aguardando_politica: { label: 'Sem politica', variant: 'outline' },
  apto_operar: { label: 'Apto', variant: 'secondary' },
  suspenso: { label: 'Suspenso', variant: 'outline' },
} as const

function nextActionLabel(row: OnboardingCedente) {
  if (row.onboardingStatus === 'aguardando_vinculo_fundo') return 'Vincular fundo'
  if (row.onboardingStatus === 'aguardando_politica') return 'Definir politica'
  if (row.onboardingStatus === 'apto_operar') return 'Ver vinculos'
  return 'Revisar'
}

function fundoLabel(row: OnboardingCedente, fundos: FundoResumo[]) {
  if (row.fundoPrincipal) return row.fundoPrincipal.nome
  const link = row.activeLinks[0] || row.suspendedLinks[0]
  if (!link) return 'Nao definido'
  return fundos.find((fundo) => fundo.id === link.fundo_id)?.nome || 'Fundo sem acesso'
}

function RowActions({ row, onVincularFundo, onDefinirPolitica, onDetalhes }: Props & { row: OnboardingCedente }) {
  if (row.onboardingStatus === 'aguardando_vinculo_fundo') {
    return (
      <Button type="button" size="sm" onClick={() => onVincularFundo(row)} title="Vincular fundo">
        <Link2 className="size-3.5" aria-hidden="true" />
        Vincular
      </Button>
    )
  }

  if (row.onboardingStatus === 'aguardando_politica') {
    return (
      <Button type="button" size="sm" onClick={() => onDefinirPolitica(row)} title="Definir politica">
        <ShieldCheck className="size-3.5" aria-hidden="true" />
        Definir
      </Button>
    )
  }

  return (
    <Button type="button" variant="outline" size="sm" onClick={() => onDetalhes(row)} title={row.onboardingStatus === 'apto_operar' ? 'Ver vinculos' : 'Revisar'}>
      <Eye className="size-3.5" aria-hidden="true" />
      {row.onboardingStatus === 'apto_operar' ? 'Ver' : 'Revisar'}
    </Button>
  )
}

export function OnboardingCedentesTable(props: Props) {
  const { rows, fundos, onDetalhes } = props

  return (
    <>
      <Card className="hidden overflow-hidden md:block">
        <CardContent className="p-0">
          <Table className="w-full table-fixed">
            <colgroup>
              <col className="w-[28%]" />
              <col className="w-[11%]" />
              <col className="w-[18%]" />
              <col className="w-[18%]" />
              <col className="w-[12%]" />
              <col className="w-[13%]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">Cedente</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead>Fundo</TableHead>
                <TableHead>Política</TableHead>
                <TableHead>Próxima ação</TableHead>
                <TableHead className="px-4 text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const status = statusMeta[row.onboardingStatus]
                const fundo = fundoLabel(row, fundos)
                const nextAction = nextActionLabel(row)
                return (
                  <TableRow key={row.id}>
                    <TableCell className="overflow-hidden px-4">
                      <button type="button" className="block w-full min-w-0 text-left" onClick={() => onDetalhes(row)}>
                        <div className="min-w-0">
                          <p className="truncate font-semibold leading-5" title={row.razao_social}>{row.razao_social}</p>
                          <p className="truncate text-xs leading-4 text-muted-foreground" title={formatCnpj(row.cnpj)}>{formatCnpj(row.cnpj)}</p>
                        </div>
                      </button>
                    </TableCell>
                    <TableCell className="overflow-hidden">
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell className="overflow-hidden">
                      <span className="block truncate" title={fundo}>{fundo}</span>
                    </TableCell>
                    <TableCell className="overflow-hidden">
                      {row.politicaPrincipal ? (
                        <span className="block truncate" title={`${row.politicaPrincipal.nome} · v${row.versaoPrincipal?.versao || '-'}`}>
                          {row.politicaPrincipal.nome} · v{row.versaoPrincipal?.versao || '-'}
                        </span>
                      ) : (
                        <span className="block truncate text-muted-foreground">Nao definida</span>
                      )}
                    </TableCell>
                    <TableCell className="overflow-hidden">
                      <span className="block truncate" title={nextAction}>{nextAction}</span>
                    </TableCell>
                    <TableCell className="px-4">
                      <div className="flex min-w-0 justify-end gap-1.5">
                        <Button type="button" variant="ghost" size="icon-sm" onClick={() => onDetalhes(row)} aria-label="Ver detalhes do cedente">
                          <SlidersHorizontal className="size-4" aria-hidden="true" />
                        </Button>
                        <RowActions {...props} row={row} />
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid gap-3 md:hidden">
        {rows.map((row) => {
          const status = statusMeta[row.onboardingStatus]
          const fundo = fundoLabel(row, fundos)
          return (
            <Card key={row.id} className="overflow-hidden">
              <CardContent className="space-y-3 p-4">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold" title={row.razao_social}>{row.razao_social}</p>
                    <p className="truncate text-xs text-muted-foreground" title={formatCnpj(row.cnpj)}>{formatCnpj(row.cnpj)}</p>
                  </div>
                  <Badge variant={status.variant} className="shrink-0">{status.label}</Badge>
                </div>
                <div className="grid min-w-0 gap-2 text-sm">
                  <p className="min-w-0 truncate" title={fundo}><span className="text-muted-foreground">Fundo:</span> {fundo}</p>
                  <p className="min-w-0 truncate" title={row.politicaPrincipal?.nome || undefined}>
                    <span className="text-muted-foreground">Politica:</span> {row.politicaPrincipal?.nome || 'Nao definida'}
                  </p>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => onDetalhes(row)}>Detalhes</Button>
                  <RowActions {...props} row={row} />
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </>
  )
}
