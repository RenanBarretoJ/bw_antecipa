import { NextRequest, NextResponse } from 'next/server'
import { executarCicloFinanceiroRlx } from '@/lib/rlx/ingestao/cron.server'
import { ehDiaUtilAnbima } from '@/lib/operacoes/calculo'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected || request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Nao autorizado.' }, { status: 401 })
  }
  const dataOperacional = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  if (!ehDiaUtilAnbima(dataOperacional)) {
    return NextResponse.json({ dataOperacional, ignorado: true, motivo: 'DIA_NAO_UTIL_ANBIMA', providers: 0, arquivos: 0, publicados: 0, falhas: 0 })
  }
  const result = await executarCicloFinanceiroRlx(dataOperacional)
  return NextResponse.json({ dataOperacional, ...result })
}
