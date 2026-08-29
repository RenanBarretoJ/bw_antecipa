import 'server-only'
import type { AppSupabaseClient } from '@/lib/auth/authorization'
import { obterPoliticaAplicavelAoCedenteFundo } from '@/lib/operacoes/politica'
import { agregarDuplicatasDaNota, confrontarDuplicataComNotaFiscal } from './validacao'
import type { DuplicataRegistro, NotaFiscalParaConfronto } from './types'

export type GateDuplicata = { aplicavel: boolean; permitido: boolean; mensagem: string | null }

export async function avaliarGateDuplicatasDaNota({
  supabase,
  nota,
  etapa,
}: {
  supabase: AppSupabaseClient
  nota: NotaFiscalParaConfronto
  etapa: 'submissao' | 'aprovacao'
}): Promise<GateDuplicata> {
  if (!nota.cedente_fundo_id || !nota.fundo_id) return { aplicavel: false, permitido: true, mensagem: null }
  const politica = await obterPoliticaAplicavelAoCedenteFundo({
    cedenteId: nota.cedente_id,
    cedenteFundoId: nota.cedente_fundo_id,
    fundoId: nota.fundo_id,
  }, supabase)
  if ((politica.versao.tipo_ativo_financeiro || 'NOTA_FISCAL') !== 'DUPLICATA_MERCANTIL') {
    return { aplicavel: false, permitido: true, mensagem: null }
  }

  const { data, error } = await supabase.from('duplicatas').select('*').eq('nota_fiscal_id', nota.id)
  if (error) throw new Error(`Nao foi possivel validar as duplicatas da NF: ${error.message}`)
  const rows = (data || []) as unknown as DuplicataRegistro[]
  if (rows.length === 0) return { aplicavel: true, permitido: false, mensagem: 'Envie ao menos uma Duplicata Mercantil vinculada a esta NF.' }
  if (rows.some((row) => row.status_validacao === 'REJEITADA')) {
    return { aplicavel: true, permitido: false, mensagem: 'Existe duplicata rejeitada. Envie uma nova versao antes de continuar.' }
  }
  const confrontos = rows.map((row) => confrontarDuplicataComNotaFiscal(row, nota))
  if (confrontos.some((confronto) => confronto.resultado !== 'COERENTE')) {
    return { aplicavel: true, permitido: false, mensagem: 'Revise os campos e divergencias das duplicatas antes de continuar.' }
  }
  const agregado = agregarDuplicatasDaNota(rows, Number(nota.valor_bruto))
  if (agregado.resultado !== 'COERENTE') {
    return { aplicavel: true, permitido: false, mensagem: 'A soma dos valores nominais das duplicatas deve corresponder ao valor bruto da NF.' }
  }
  if (etapa === 'aprovacao' && rows.some((row) => row.status_validacao !== 'VALIDADA')) {
    return { aplicavel: true, permitido: false, mensagem: 'Todas as duplicatas devem ser validadas pelo gestor antes da aprovacao da NF.' }
  }
  return { aplicavel: true, permitido: true, mensagem: null }
}
