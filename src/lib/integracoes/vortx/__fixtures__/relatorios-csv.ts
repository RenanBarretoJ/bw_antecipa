import { LAYOUTS_CSV_VORTX, type TipoCsvVortx } from '../relatorios-layout'
import { processarCsvRelatorioVortx, type ContextoRelatorioVortx } from '../relatorios-parser'

export const CONTEXTO_CSV_QA: ContextoRelatorioVortx = {
  fundoId: '61f02178-58af-4bfa-9a33-f97ac5b3dd96', ambiente: 'homologacao',
  codigoCarteira: 'CARTEIRA-QA-01', dataReferencia: '2026-10-16',
  dataInicio: '2026-10-15', dataFim: '2026-10-16',
}
const valores: Record<string, string> = {
  codigo_carteira: CONTEXTO_CSV_QA.codigoCarteira,
  cedente_documento: '98992300000280', emissor_documento: '98992300000280',
  sacado_documento: '98992300000360', cedente_nome: 'CEDENTE SINTETICO', sacado_nome: 'SACADO SINTETICO',
  chave_ativo: 'QA-ATIVO-01', chave_parcela: 'QA-PARCELA-01', tipo_recebivel: 'DUPLICATA',
  valor_nominal: '100.00', valor_aquisicao: '90.00', valor_presente: '91.00', valor_pdd: '2.00',
  valor_emissao_total_ativo: '100.00', data_movimento: '15/10/2026', data_aquisicao: '15/10/2026',
  data_emissao: '01/10/2026', data_vencimento: '20/11/2026', data_vencimento_original: '20/11/2026',
}
const cell = (value: string) => `"${value.replace(/"/g, '""')}"`
export function csvVortxQa(tipo: TipoCsvVortx, linhas: Record<string, string>[] = [{}]): Uint8Array {
  const campos = LAYOUTS_CSV_VORTX[tipo]
  const rows = [campos.map((field) => cell(field.header)).join(';'), ...linhas.map((patch) => campos.map((field) => {
    const row: Record<string, string> = { ...valores, status_entrada_provedor: tipo === 'PosicaoAtivo' ? 'Em trânsito' : '', ...patch }
    return cell(row[field.nome] ?? '')
  }).join(';'))]
  return new TextEncoder().encode(rows.join('\r\n') + '\r\n')
}
export function relatorioVortxQa(tipo: TipoCsvVortx, linhas: Record<string, string>[] = [{}], contexto = CONTEXTO_CSV_QA) {
  return processarCsvRelatorioVortx({ tipoRelatorio: tipo, contexto, arquivo: csvVortxQa(tipo, linhas) })
}
