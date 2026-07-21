import JSZip from 'jszip'
import { createAdminClient } from '@/lib/supabase/server'
import { buckets } from '@/lib/storage'

type IntegracaoFromtisResolvida = {
  id: string
  endpointBase: string
  identificadorCliente: string
  credentialRef: string
  secretName: string | null
  vaultKey: string | null
  configuracao: Record<string, unknown>
}

function envName(base: string, suffix: string) {
  return `${base.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()}_${suffix}`
}

async function resolverIntegracaoFromtisFundo(admin: ReturnType<typeof createAdminClient>, fundoId: string): Promise<IntegracaoFromtisResolvida> {
  const { data, error } = await admin
    .from('integracoes_fundo')
    .select('id, integracao_fundo_versoes(*)')
    .eq('fundo_id', fundoId)
    .eq('provedor', 'fromtis')
    .eq('status', 'ativa')
    .maybeSingle()

  if (error) throw new Error(`Erro ao resolver integracao Fromtis do fundo: ${error.message}`)
  const integracao = data as unknown as { integracao_fundo_versoes?: Array<Record<string, unknown>> } | null
  const versoes = (integracao?.integracao_fundo_versoes || [])
    .filter((versao) => versao.status === 'publicada')
    .filter((versao) => new Date(String(versao.vigente_desde)).getTime() <= Date.now())
    .filter((versao) => !versao.vigente_ate || new Date(String(versao.vigente_ate)).getTime() > Date.now())
    .sort((a, b) => Number(b.versao) - Number(a.versao))

  const vigente = versoes[0]
  if (!vigente) throw new Error('Integracao Fromtis publicada e vigente nao encontrada para o fundo.')

  return {
    id: String(vigente.id),
    endpointBase: String(vigente.endpoint_base),
    identificadorCliente: String(vigente.identificador_cliente),
    credentialRef: String(vigente.credential_ref),
    secretName: vigente.secret_name ? String(vigente.secret_name) : null,
    vaultKey: vigente.vault_key ? String(vigente.vault_key) : null,
    configuracao: (vigente.configuracao_nao_sensivel as Record<string, unknown> | null) || {},
  }
}

function resolverCredenciaisFromtis(integracao: IntegracaoFromtisResolvida) {
  const secretBase = integracao.secretName || integracao.credentialRef
  const username = process.env[envName(secretBase, 'USERNAME')]
  const password = process.env[envName(secretBase, 'PASSWORD')]
  if (!username || !password) {
    throw new Error(`Credenciais Fromtis nao encontradas para a referencia ${integracao.credentialRef}.`)
  }
  return { username, password }
}

export async function enviarRemessaFromtis(operacaoId: string): Promise<{ idArquivo: string; mensagem: string }> {
  const admin = createAdminClient()

  const { data: op, error } = await admin
    .from('operacoes')
    .select('remessa_url, cedente_id')
    .eq('id', operacaoId)
    .single()

  if (error || !op) throw new Error('Operacao nao encontrada')

  const opData = op as { remessa_url: string | null; cedente_id: string }
  if (!opData.remessa_url) throw new Error('CNAB nao gerado para esta operacao. Gere o CNAB primeiro.')

  const { data: remessa } = await admin
    .from('remessas_cnab_operacoes')
    .select('remessa:remessas_cnab(id, fundo_id, bucket, storage_path, nome_arquivo, fundo:fundos(cnpj), configuracao:configuracao_cnab_versoes(tipo_recebivel))')
    .eq('operacao_id', operacaoId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const remessaData = remessa as unknown as {
    remessa: {
      id: string
      bucket: string
      storage_path: string
      nome_arquivo: string
      fundo_id: string
      fundo: { cnpj: string } | null
      configuracao: { tipo_recebivel: string } | null
    } | null
  } | null

  let cnpjFundo = remessaData?.remessa?.fundo?.cnpj
  let fundoId = remessaData?.remessa?.fundo_id
  let bucket = remessaData?.remessa?.bucket || buckets.remessasCnab
  let storagePath = remessaData?.remessa?.storage_path || opData.remessa_url

  if (!remessaData?.remessa) {
    const { data: cedente } = await admin
      .from('cedentes')
      .select('fundo_id, fundos(cnpj)')
      .eq('id', opData.cedente_id)
      .single()
    const cedenteData = cedente as unknown as { fundo_id: string | null; fundos: { cnpj: string } | null } | null
    cnpjFundo = cedenteData?.fundos?.cnpj
    fundoId = cedenteData?.fundo_id || undefined
    bucket = buckets.contratos
    storagePath = opData.remessa_url
  }

  if (!cnpjFundo) throw new Error('CNPJ do fundo nao encontrado para esta operacao')
  if (!fundoId) throw new Error('Fundo nao encontrado para resolver integracao Fromtis')
  if (!storagePath) throw new Error('Path da remessa CNAB nao encontrado para esta operacao')

  const integracaoFromtis = await resolverIntegracaoFromtisFundo(admin, fundoId)
  const credenciais = resolverCredenciaisFromtis(integracaoFromtis)
  const tipoRecebivel = remessaData?.remessa?.configuracao?.tipo_recebivel || String(integracaoFromtis.configuracao.tipoRecebivel || '01')

  const { data: fileData, error: storageErr } = await admin.storage
    .from(bucket)
    .download(storagePath)

  if (storageErr || !fileData) throw new Error('Arquivo CNAB nao encontrado no storage')

  const cnabBuffer = Buffer.from(await fileData.arrayBuffer())

  const nomeRem = remessaData?.remessa?.nome_arquivo || `REMESSA_${operacaoId.slice(0, 8).toUpperCase()}.REM`
  const nomeZip = nomeRem.replace(/\.REM$/i, '.zip')
  const zip = new JSZip()
  zip.file(nomeRem, cnabBuffer)
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  const arquivoBase64 = zipBuffer.toString('base64')

  const envelope = `<?xml version="1.0" encoding="UTF-8"?>\
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:soap="http://soap.consulta.servicos.portal.fidc.fromtis.com.br/">\
<soapenv:Header/>\
<soapenv:Body>\
<soap:importarArquivoRemessa>\
<arquivoCnab>\
<tipoRecebivel>${tipoRecebivel}</tipoRecebivel>\
<caminho>${nomeZip}</caminho>\
<cnpjFundo>${cnpjFundo.replace(/\D/g, '')}</cnpjFundo>\
<arquivo>${arquivoBase64}</arquivo>\
</arquivoCnab>\
</soap:importarArquivoRemessa>\
</soapenv:Body>\
</soapenv:Envelope>`

  const response = await fetch(integracaoFromtis.endpointBase, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
      'SOAPAction': '',
      'username': credenciais.username,
      'password': credenciais.password,
    },
    body: envelope,
  })

  const responseText = await response.text()
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

  if (remessaData?.remessa) {
    await admin
      .from('remessas_cnab')
      .update({ status: 'enviada', enviado_em: new Date().toISOString(), retorno_resumido: mensagem, integracao_fundo_versao_id: integracaoFromtis.id } as never)
      .eq('id', remessaData.remessa.id)
  }

  return { idArquivo, mensagem }
}
