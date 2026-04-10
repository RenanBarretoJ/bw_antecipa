import Handlebars from 'handlebars'
import chromium from '@sparticuz/chromium'
import puppeteer from 'puppeteer-core'
import fs from 'fs'
import path from 'path'
import { buckets } from '@/lib/storage'

function formatarData(dataStr: string | null | undefined): string {
  if (!dataStr) return ''
  const data = new Date(dataStr)
  return data.toLocaleDateString('pt-BR')
}

function formatarDataExtenso(dataStr: string | null | undefined): string {
  if (!dataStr) return ''
  const data = new Date(dataStr)
  return data.toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function formatarMoeda(valor: number | null | undefined): string {
  if (valor == null) return 'R$ 0,00'
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(valor)
}

// Montar endereco completo a partir dos campos separados do cedente
function montarEndereco(ced: Record<string, unknown>): string {
  const partes = [
    ced.logradouro,
    ced.numero ? `n ${ced.numero}` : null,
    ced.complemento,
    ced.bairro,
    ced.cidade,
    ced.estado,
    ced.cep ? `CEP ${ced.cep}` : null,
  ].filter(Boolean)
  return partes.join(', ')
}

function compilarTemplate(nomeTemplate: string, dados: object): string {
  const caminhoTemplate = path.join(
    process.cwd(),
    'src',
    'templates',
    'contratos',
    nomeTemplate
  )
  const templateStr = fs.readFileSync(caminhoTemplate, 'utf-8')
  const template = Handlebars.compile(templateStr)
  return template(dados)
}

async function htmlParaPdf(html: string): Promise<Buffer> {
  const isLocal = process.env.NODE_ENV === 'development'

  const browser = isLocal
    ? await puppeteer.launch({
        executablePath:
          process.env.CHROME_PATH ||
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        headless: true,
      })
    : await puppeteer.launch({
        args: chromium.args,
        defaultViewport: { width: 1280, height: 720 },
        executablePath: await chromium.executablePath(
          process.env.CHROMIUM_BINARY_URL ||
          'https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.tar'
        ),
        headless: true,
      })

  try {
    const page = await browser.newPage()
    await page.setContent(html, { waitUntil: 'networkidle0' })
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    })
    return Buffer.from(pdfBuffer)
  } finally {
    await browser.close()
  }
}

async function salvarPdfStorage(
  buffer: Buffer,
  caminho: string
): Promise<string> {
  // Usar createClient do supabase-js diretamente com service role para Storage
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { error } = await supabase.storage
    .from(buckets.contratos)
    .upload(caminho, buffer, {
      contentType: 'application/pdf',
      upsert: true,
    })

  if (error) throw new Error(`Erro ao salvar PDF no Storage: ${error.message}`)

  // Gerar URL assinada (bucket privado) - 24h de validade
  const { data: signedData } = await supabase.storage
    .from(buckets.contratos)
    .createSignedUrl(caminho, 86400)

  return signedData?.signedUrl || caminho
}

// ============================================================
// Gerar Contrato Mae (1x por cedente)
// ============================================================
export async function gerarContratoCessao(
  cedenteId: string
): Promise<{ url: string; path: string }> {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Buscar cedente
  const { data: cedente, error: erroC } = await supabase
    .from('cedentes')
    .select('*')
    .eq('id', cedenteId)
    .single()

  if (erroC || !cedente) throw new Error('Cedente nao encontrado')
  const ced = cedente as Record<string, unknown>

  // Rep. legal: prioriza nome_representante, fallback para primeiro devedor solidário
  const { data: devedoresData } = await supabase
    .from('devedores_solidarios')
    .select('nome')
    .eq('cedente_id', cedenteId)
    .order('ordem', { ascending: true })
    .limit(1)
  const primeiroDevedor = ((devedoresData || []) as Array<{ nome: string }>)[0]?.nome || ''

  const dados = {
    cedente: {
      razao_social: ced.razao_social,
      cnpj: ced.cnpj,
      logradouro: ced.logradouro || '',
      numero: ced.numero || '',
      complemento: ced.complemento || '',
      bairro: ced.bairro || '',
      cidade: ced.cidade || '',
      estado: ced.estado || '',
      cep: ced.cep || '',
      telefone: ced.telefone_comercial || '',
      email: ced.email_comercial || '',
      rep_legal_nome: ced.nome_representante || primeiroDevedor,
      banco: ced.banco || '',
      agencia: ced.agencia || '',
      conta: ced.conta || '',
    },
    contrato: {
      data_assinatura_extenso: formatarDataExtenso(new Date().toISOString()),
    },
    testemunha_1: {
      nome: (ced.testemunha_1_nome as string) || 'BRENO JOSE ALVIM DA SILVA',
      cpf: (ced.testemunha_1_cpf as string) || '378.341.578-09',
    },
    testemunha_2: {
      nome: (ced.testemunha_2_nome as string) || 'KAIO MIGUEL RUIZ',
      cpf: (ced.testemunha_2_cpf as string) || '423.679.188-99',
    },
  }

  const html = compilarTemplate('contrato-cessao.html', dados)
  const pdfBuffer = await htmlParaPdf(html)
  const caminho = `cedentes/${cedenteId}/contrato-cessao.pdf`
  const url = await salvarPdfStorage(pdfBuffer, caminho)

  // Atualizar URL no banco
  await supabase
    .from('cedentes')
    .update({ contrato_url: caminho, contrato_gerado_em: new Date().toISOString() } as never)
    .eq('id', cedenteId)

  return { url, path: caminho }
}

// ============================================================
// Gerar Termo de Cessao (1x por operacao)
// ============================================================
export async function gerarTermoCessao(
  operacaoId: string
): Promise<{ url: string; path: string }> {
  const { createClient } = await import('@supabase/supabase-js')
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Buscar operacao
  const { data: operacao, error: erroO } = await supabase
    .from('operacoes')
    .select('*')
    .eq('id', operacaoId)
    .single()

  if (erroO || !operacao) throw new Error('Operacao nao encontrada')
  const op = operacao as Record<string, unknown>

  // Buscar cedente
  const { data: cedente } = await supabase
    .from('cedentes')
    .select('*')
    .eq('id', op.cedente_id)
    .single()

  if (!cedente) throw new Error('Cedente da operacao nao encontrado')
  const ced = cedente as Record<string, unknown>

  // Buscar NFs da operacao via tabela de juncao
  const { data: opNfs } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id')
    .eq('operacao_id', operacaoId)

  const nfIds = ((opNfs || []) as Array<{ nota_fiscal_id: string }>).map(n => n.nota_fiscal_id)

  let notas: Array<Record<string, unknown>> = []
  if (nfIds.length > 0) {
    const { data: nfsData } = await supabase
      .from('notas_fiscais')
      .select('*')
      .in('id', nfIds)
    notas = (nfsData || []) as Array<Record<string, unknown>>
  }

  const taxaDesagio = (op.taxa_desagio as number) || (op.taxa_desconto as number) || 0

  const precoAquisicaoTotal = notas.reduce(
    (acc, nf) => acc + ((nf.valor_antecipado as number) || (nf.valor_liquido as number) || 0),
    0
  )

  const dados = {
    cedente: {
      razao_social: ced.razao_social,
      cnpj: ced.cnpj,
      logradouro: ced.logradouro || '',
      numero: ced.numero || '',
      complemento: ced.complemento || '',
      bairro: ced.bairro || '',
      cidade: ced.cidade || '',
      estado: ced.estado || '',
      cep: ced.cep || '',
      telefone: ced.telefone_comercial || '',
      email: ced.email_comercial || '',
    },
    termo: {
      data_extenso: formatarDataExtenso(new Date().toISOString()),
      preco_aquisicao_formatado: formatarMoeda(precoAquisicaoTotal),
    },
    notas_fiscais: notas.map((nf) => ({
      numero: nf.numero_nf || '',
      sacado_cnpj: (nf.cnpj_destinatario as string) || (ced.sacado_cnpj as string) || '',
      data_emissao_formatada: formatarData(nf.data_emissao as string),
      data_vencimento_formatada: formatarData(nf.data_vencimento as string),
      valor_face_formatado: formatarMoeda((nf.valor_liquido as number) || (nf.valor_bruto as number)),
      taxa_desagio: ((nf.taxa_desagio as number) || taxaDesagio).toFixed(4),
      valor_antecipado_formatado: formatarMoeda((nf.valor_antecipado as number) || (nf.valor_liquido as number)),
    })),
    testemunha_1: {
      nome: (ced.testemunha_1_nome as string) || 'BRENO JOSE ALVIM DA SILVA',
      cpf: (ced.testemunha_1_cpf as string) || '378.341.578-09',
    },
    testemunha_2: {
      nome: (ced.testemunha_2_nome as string) || 'KAIO MIGUEL RUIZ',
      cpf: (ced.testemunha_2_cpf as string) || '423.679.188-99',
    },
  }

  const html = compilarTemplate('termo-cessao.html', dados)
  const pdfBuffer = await htmlParaPdf(html)
  const caminho = `operacoes/${operacaoId}/termo-cessao.pdf`
  const url = await salvarPdfStorage(pdfBuffer, caminho)

  // Atualizar URL no banco
  await supabase
    .from('operacoes')
    .update({
      termo_url: caminho,
      termo_gerado_em: new Date().toISOString(),
      preco_aquisicao: precoAquisicaoTotal,
      taxa_desagio: taxaDesagio,
    } as never)
    .eq('id', operacaoId)

  return { url, path: caminho }
}
