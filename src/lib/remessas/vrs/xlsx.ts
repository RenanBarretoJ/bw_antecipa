import JSZip from 'jszip'
import { gerarXlsxAbas, fixarDatasZip } from '../xlsx'
import type { VrsInclusaoMapeada } from './mapper'
import { VRS_XLSX_COLUNAS } from './xlsx-layout'

export const VRS_LAYOUT_VERSION = 'inclusao_v3_chaves_estaveis_xlsx'
export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function gerarVrsInclusaoXlsx(input: VrsInclusaoMapeada) {
  const registros = {
    HEADER: [input.header],
    ATIVO: input.ativos.map(ativo => ativo.campos),
    FLUXO: input.fluxos.map(fluxo => fluxo.campos),
    PAGAMENTO: [input.pagamento],
  }
  return gerarXlsxAbas((Object.keys(VRS_XLSX_COLUNAS) as Array<keyof typeof VRS_XLSX_COLUNAS>).map(nome => {
    const colunas = VRS_XLSX_COLUNAS[nome]
    const linhas = registros[nome].map(campos => {
      if (campos[0] !== nome || campos.length !== colunas.length + 1) throw new Error(`Registro ${nome} diverge do layout XLSX VRS.`)
      // No XLSX o tipo de registro e o nome da aba, nao uma coluna de dados.
      return campos.slice(1)
    })
    return { nome, linhas: [[...colunas], ...linhas] }
  }), true)
}

export async function gerarDownloadExcelVrs(grupos: VrsInclusaoMapeada[]) {
  if (grupos.length === 0) throw new Error('Nenhum Cedente para gerar XLSX VRS.')
  const arquivos = await Promise.all(grupos.map(async grupo => ({
    nome: `${grupo.cedenteCnpj}.xlsx`, conteudo: await gerarVrsInclusaoXlsx(grupo),
  })))
  if (new Set(arquivos.map(arquivo => arquivo.nome)).size !== arquivos.length) throw new Error('Cedentes com CNPJ repetido no lote VRS.')
  if (arquivos.length === 1) return { ...arquivos[0], contentType: XLSX_CONTENT_TYPE }
  // Um HEADER por Cedente: nunca misturar Cedentes numa planilha de importacao.
  const zip = new JSZip()
  for (const arquivo of arquivos) zip.file(arquivo.nome, arquivo.conteudo)
  fixarDatasZip(zip)
  return { nome: 'remessas_vrs_xlsx.zip', conteudo: await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }), contentType: 'application/zip' }
}
