import JSZip from 'jszip'
import { createAdminClient } from '@/lib/supabase/server'
import { buckets } from '@/lib/storage'

const FROMTIS_URL = process.env.FROMTIS_URL!
const FROMTIS_USERNAME = process.env.FROMTIS_USERNAME!
const FROMTIS_PASSWORD = process.env.FROMTIS_PASSWORD!
const FROMTIS_TIPO_RECEBIVEL = process.env.FROMTIS_TIPO_RECEBIVEL ?? '01'

export async function enviarRemessaFromtis(operacaoId: string): Promise<{ idArquivo: string; mensagem: string }> {
  if (!FROMTIS_URL || !FROMTIS_USERNAME || !FROMTIS_PASSWORD) {
    throw new Error('Variáveis FROMTIS_URL, FROMTIS_USERNAME e FROMTIS_PASSWORD não configuradas')
  }

  const admin = createAdminClient()

  const { data: op, error } = await admin
    .from('operacoes')
    .select('remessa_url, cedente_id')
    .eq('id', operacaoId)
    .single()

  if (error || !op) throw new Error('Operação não encontrada')

  const opData = op as { remessa_url: string | null; cedente_id: string }
  if (!opData.remessa_url) throw new Error('CNAB não gerado para esta operação. Gere o CNAB primeiro.')

  const { data: cedente } = await admin
    .from('cedentes')
    .select('fundo_id, fundos(cnpj)')
    .eq('id', opData.cedente_id)
    .single()

  const cnpjFundo = (cedente as unknown as { fundo_id: string | null; fundos: { cnpj: string } | null } | null)?.fundos?.cnpj
  if (!cnpjFundo) throw new Error('CNPJ do fundo não encontrado para esta operação')

  const { data: fileData, error: storageErr } = await admin.storage
    .from(buckets.contratos)
    .download(opData.remessa_url)

  if (storageErr || !fileData) throw new Error('Arquivo CNAB não encontrado no storage')

  const cnabBuffer = Buffer.from(await fileData.arrayBuffer())

  const nomeRem = `REMESSA_${operacaoId.slice(0, 8).toUpperCase()}.REM`
  const nomeZip = `REMESSA_${operacaoId.slice(0, 8).toUpperCase()}.zip`
  const zip = new JSZip()
  zip.file(nomeRem, cnabBuffer)
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const arquivoBase64 = zipBuffer.toString('base64')

  // Ordem dos campos conforme WSDL: tipoRecebivel → caminho → cnpjFundo → arquivo
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>\
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://soap.consulta.servicos.portal.fidc.fromtis.com.br/">\
<soapenv:Header/>\
<soapenv:Body>\
<soap:importarArquivoRemessa>\
<arquivoCnab>\
<tipoRecebivel>${FROMTIS_TIPO_RECEBIVEL}</tipoRecebivel>\
<caminho>${nomeZip}</caminho>\
<cnpjFundo>${cnpjFundo.replace(/\D/g, '')}</cnpjFundo>\
<arquivo>${arquivoBase64}</arquivo>\
</arquivoCnab>\
</soap:importarArquivoRemessa>\
</soapenv:Body>\
</soapenv:Envelope>`

  const response = await fetch(FROMTIS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': '',
      'username': FROMTIS_USERNAME,
      'password': FROMTIS_PASSWORD,
    },
    body: envelope,
  })

  const responseText = await response.text()

  // Resposta pode ser MTOM — extrair o envelope SOAP antes de parsear
  const xmlMatch = responseText.match(/<[A-Za-z]+:Envelope[\s\S]*?<\/[A-Za-z]+:Envelope>/)
  const xmlContent = xmlMatch?.[0] ?? responseText

  const faultStringMatch = xmlContent.match(/<faultstring>([^<]+)<\/faultstring>/)

  if (!response.ok) {
    const detalhe = faultStringMatch?.[1] ?? xmlContent.slice(0, 1000)
    throw new Error(`Fromtis HTTP ${response.status}: ${detalhe}`)
  }

  const idArquivoMatch = xmlContent.match(/<idArquivo>(\d+)<\/idArquivo>/)
  const mensagemMatch = xmlContent.match(/<mensagem>([^<]+)<\/mensagem>/)

  if (!idArquivoMatch) {
    const erro = faultStringMatch?.[1] ?? mensagemMatch?.[1] ?? xmlContent.slice(0, 1000)
    throw new Error(`Fromtis SOAP: ${erro}`)
  }

  const idArquivo = idArquivoMatch[1]
  const mensagem = mensagemMatch?.[1] ?? 'Arquivo importado com sucesso'

  await admin.from('operacoes').update({
    remessa_enviado_em: new Date().toISOString(),
    remessa_fromtis_id: idArquivo,
    remessa_fromtis_retorno: mensagem,
  } as never).eq('id', operacaoId)

  return { idArquivo, mensagem }
}
