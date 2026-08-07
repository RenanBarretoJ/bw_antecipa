import { NextResponse } from 'next/server'
import { carregarCentralLogistica } from '@/lib/logistica/central/central-logistica.server'
import { parseFiltrosCentralLogistica } from '@/lib/logistica/central/filtros'

function csv(value: unknown) {
  const text = String(value ?? '').replaceAll('"', '""')
  return `"${text}"`
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const filtros = parseFiltrosCentralLogistica(url.searchParams)
  const data = await carregarCentralLogistica({ ...filtros, tab: 'notas' }, { semPaginacao: true })
  const linhas = [
    ['NF', 'Chave de acesso', 'Cedente', 'CNPJ cedente', 'Sacado', 'CNPJ sacado', 'Valor', 'Operação', 'Status operação', 'Status logístico atual', 'Status na criação', 'Status na aprovação', 'CT-e', 'Momento CT-e', 'Comprovante de entrega', 'Momento comprovante', 'Prazo efetivo', 'Situação do prazo', 'Criticidade'],
    ...data.notas.map((nota) => [
      nota.numeroNf, nota.chaveAcesso, nota.cedente, nota.cedenteCnpj, nota.sacado, nota.sacadoCnpj,
      nota.valor.toFixed(2), nota.operacao ? `#${nota.operacao.id.slice(0, 8)}` : '', nota.operacao?.status || '',
      nota.statusAtual, nota.statusCriacao || '', nota.statusAprovacao || '', nota.cte.status, nota.cte.momento,
      nota.comprovante.status, nota.comprovante.momento, nota.prazoRelevante.data || '',
      nota.prazoRelevante.situacao, nota.criticidade,
    ]),
  ]
  const content = `\uFEFF${linhas.map((linha) => linha.map(csv).join(';')).join('\r\n')}`
  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="central-logistica-${new Date().toISOString().slice(0, 10)}.csv"`,
      'Cache-Control': 'private, no-store',
    },
  })
}
