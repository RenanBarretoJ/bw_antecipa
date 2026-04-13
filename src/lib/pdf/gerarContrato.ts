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

function formatarDataHora(dataStr: string | null | undefined): string {
  if (!dataStr) return ''
  const data = new Date(dataStr)
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: 'America/Sao_Paulo',
  })
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
          'https://github.com/Sparticuz/chromium/releases/download/v143.0.4/chromium-v143.0.4-pack.x64.tar'
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

  // Rep. legal: prioriza representante principal da tabela representantes
  const { data: repPrincipalData } = await supabase
    .from('representantes')
    .select('nome, email')
    .eq('cedente_id', cedenteId)
    .eq('principal', true)
    .limit(1)
    .maybeSingle()
  const repPrincipal = repPrincipalData as { nome: string; email: string | null } | null

  // Fallback: primeiro representante (sem filtro principal), depois nome_representante do cedente
  const { data: primeiroRepData } = !repPrincipal ? await supabase
    .from('representantes')
    .select('nome, email')
    .eq('cedente_id', cedenteId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle() : { data: null }
  const primeiroRep = primeiroRepData as { nome: string; email: string | null } | null

  const repNome = repPrincipal?.nome || primeiroRep?.nome || (ced.nome_representante as string) || ''
  const repEmail = repPrincipal?.email || primeiroRep?.email || (ced.email_comercial as string) || ''

  // Buscar as 2 primeiras testemunhas ativas da tabela global
  const { data: testemunhasGlobais } = await supabase
    .from('testemunhas')
    .select('nome, cpf')
    .eq('ativo', true)
    .order('created_at', { ascending: true })
    .limit(2)
  const tg = (testemunhasGlobais || []) as Array<{ nome: string; cpf: string }>

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
      email: repEmail,
      rep_legal_nome: repNome,
      banco: ced.banco || '',
      agencia: ced.agencia || '',
      conta: ced.conta || '',
    },
    contrato: {
      data_assinatura_extenso: formatarDataExtenso(new Date().toISOString()),
    },
    testemunha_1: {
      nome: tg[0]?.nome || (ced.testemunha_1_nome as string) || 'BRENO JOSE ALVIM DA SILVA',
      cpf: tg[0]?.cpf || (ced.testemunha_1_cpf as string) || '378.341.578-09',
    },
    testemunha_2: {
      nome: tg[1]?.nome || (ced.testemunha_2_nome as string) || 'DAVI DE PAULA YANG',
      cpf: tg[1]?.cpf || (ced.testemunha_2_cpf as string) || '469.942.738-30',
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

  // Buscar testemunhas: prioriza seleção da operação, depois as 2 primeiras ativas da tabela global
  let test1: { nome: string; cpf: string } | null = null
  let test2: { nome: string; cpf: string } | null = null

  if (op.testemunha_1_id) {
    const { data: t1 } = await supabase.from('testemunhas').select('nome, cpf').eq('id', op.testemunha_1_id as string).single()
    test1 = t1 as { nome: string; cpf: string } | null
  }
  if (op.testemunha_2_id) {
    const { data: t2 } = await supabase.from('testemunhas').select('nome, cpf').eq('id', op.testemunha_2_id as string).single()
    test2 = t2 as { nome: string; cpf: string } | null
  }

  if (!test1 || !test2) {
    const { data: tGlobais } = await supabase
      .from('testemunhas')
      .select('nome, cpf')
      .eq('ativo', true)
      .order('created_at', { ascending: true })
      .limit(2)
    const tg = (tGlobais || []) as Array<{ nome: string; cpf: string }>
    if (!test1) test1 = tg[0] || null
    if (!test2) test2 = tg[1] || null
  }

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
      solicitacao_data: formatarDataHora(op.created_at as string),
      quantidade: notas.length,
      total_face_formatado: formatarMoeda(
        notas.reduce((acc, nf) => acc + ((nf.valor_liquido as number) || (nf.valor_bruto as number) || 0), 0)
      ),
    },
    notas_fiscais: notas.map((nf) => ({
      numero: nf.numero_nf || '',
      sacado_cnpj: (nf.cnpj_destinatario as string) || (ced.sacado_cnpj as string) || '',
      data_emissao_formatada: formatarData(nf.data_emissao as string),
      data_vencimento_formatada: formatarData(nf.data_vencimento as string),
      valor_face_formatado: formatarMoeda((nf.valor_liquido as number) || (nf.valor_bruto as number)),
      taxa_desagio: ((nf.taxa_desagio as number) || taxaDesagio).toFixed(4),
      valor_antecipado_formatado: formatarMoeda((nf.valor_antecipado as number) || (nf.valor_liquido as number)),
      // Trilha de auditoria para APENSO B
      id_curto: (nf.id as string).slice(0, 8).toUpperCase(),
      inclusao_data: formatarDataHora(nf.created_at as string),
      aprovacao_gestor_data: nf.aprovada_gestor_em ? formatarDataHora(nf.aprovada_gestor_em as string) : '—',
      aceite_sacado_data: nf.aceite_sacado_em ? formatarDataHora(nf.aceite_sacado_em as string) : '—',
    })),
    testemunha_1: {
      nome: test1?.nome || (ced.testemunha_1_nome as string) || 'BRENO JOSE ALVIM DA SILVA',
      cpf: test1?.cpf || (ced.testemunha_1_cpf as string) || '378.341.578-09',
    },
    testemunha_2: {
      nome: test2?.nome || (ced.testemunha_2_nome as string) || 'DAVI DE PAULA YANG',
      cpf: test2?.cpf || (ced.testemunha_2_cpf as string) || '469.942.738-30',
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
