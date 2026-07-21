import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  sanitizeArquivoSegment,
  sha256Hex,
  stableStringify,
  type DadosCedente,
  type DadosFundo,
  type DadosOperacao,
  type RemessaOperacao,
  type ResultadoGeracao,
  type TituloRemessa,
} from '@/lib/cnab/domain'
import { resolverConfiguracaoCnab } from '@/lib/cnab/resolver-configuracao'
import { geradorCnab444 } from '@/lib/cnab/layouts/cnab444'

type AdminSupabaseClient = SupabaseClient<Database>

export interface ContextoCnabCarregado {
  fundo: DadosFundo
  cedente: DadosCedente
  operacoes: DadosOperacao[]
  titulos: TituloRemessa[]
  configuracao: Awaited<ReturnType<typeof resolverConfiguracaoCnab>>
  dataGeracao: string
  idempotencyKey: string
  payloadHash: string
}
export interface RemessaCnabPreparada {
  input: RemessaOperacao
  resultado: ResultadoGeracao
  idempotencyKey: string
  payloadHash: string
  nomeArquivo: string
  fundoId: string
  configuracaoCnabId: string
  configuracaoCnabVersaoId: string
}

function adminClient(): AdminSupabaseClient {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

function valorTitulo(nf: Record<string, unknown>): number {
  return Number((nf.valor_liquido as number | null) ?? (nf.valor_bruto as number | null) ?? 0)
}

function valorPresente(nf: Record<string, unknown>): number {
  return Number((nf.valor_antecipado as number | null) ?? (nf.valor_liquido as number | null) ?? (nf.valor_bruto as number | null) ?? 0)
}

async function resolverFundoHistoricoDaOperacao(
  supabase: AdminSupabaseClient,
  operacao: Record<string, unknown>,
): Promise<DadosFundo> {
  if (!operacao.cedente_fundo_id) {
    throw new Error('Operacao sem cedente_fundo_id historico. CNAB configuravel exige contexto de fundo da operacao.')
  }

  const { data: link, error: linkError } = await supabase
    .from('cedente_fundos')
    .select('fundo_id')
    .eq('id', operacao.cedente_fundo_id as string)
    .maybeSingle()

  if (linkError || !link) throw new Error('Vinculo cedente-fundo historico da operacao nao encontrado.')

  const fundoId = (link as { fundo_id: string }).fundo_id
  const { data: fundo, error: fundoError } = await supabase
    .from('fundos')
    .select('id, nome, cnpj')
    .eq('id', fundoId)
    .maybeSingle()

  if (fundoError || !fundo) throw new Error('Fundo historico da operacao nao encontrado.')
  const row = fundo as { id: string; nome: string; cnpj: string }
  return { id: row.id, nome: row.nome, cnpj: row.cnpj }
}

function montarPayloadHash(input: {
  fundo: DadosFundo
  cedente: DadosCedente
  operacoes: DadosOperacao[]
  titulos: TituloRemessa[]
  configuracaoVersaoId: string
}) {
  return sha256Hex(stableStringify(input))
}

function montarIdempotencyKey({ fundoId, configuracaoVersaoId, operacaoIds }: { fundoId: string; configuracaoVersaoId: string; operacaoIds: string[] }) {
  return sha256Hex(stableStringify({
    tipo: 'remessa_cnab',
    layout: 'cnab444',
    fundoId,
    configuracaoVersaoId,
    operacaoIds: [...operacaoIds].sort(),
  }))
}

export async function carregarContextoCnab444({
  operacaoIds,
  dataGeracao = new Date().toISOString(),
  supabase = adminClient(),
}: {
  operacaoIds: string[]
  dataGeracao?: string
  supabase?: AdminSupabaseClient
}): Promise<ContextoCnabCarregado> {
  const uniqueOperacaoIds = [...new Set(operacaoIds.filter(Boolean))]
  if (uniqueOperacaoIds.length === 0) throw new Error('Informe ao menos uma operacao para gerar CNAB.')
  if (uniqueOperacaoIds.length !== 1) throw new Error('A Fase 7 prepara modelo N:N, mas a geracao inicial aceita uma operacao por remessa.')

  const { data: operacoesData, error: operacoesError } = await supabase
    .from('operacoes')
    .select('*')
    .in('id', uniqueOperacaoIds)

  if (operacoesError || !operacoesData || operacoesData.length !== uniqueOperacaoIds.length) {
    throw new Error('Operacao nao encontrada para geracao de CNAB.')
  }

  const operacaoRow = operacoesData[0] as Record<string, unknown>
  const fundo = await resolverFundoHistoricoDaOperacao(supabase, operacaoRow)

  const { data: cedenteData, error: cedenteError } = await supabase
    .from('cedentes')
    .select('id, razao_social, cnpj, coobrigacao')
    .eq('id', operacaoRow.cedente_id as string)
    .maybeSingle()

  if (cedenteError || !cedenteData) throw new Error('Cedente da operacao nao encontrado.')
  const cedenteRow = cedenteData as { id: string; razao_social: string; cnpj: string; coobrigacao: boolean | null }

  const { data: opNfs } = await supabase
    .from('operacoes_nfs')
    .select('nota_fiscal_id')
    .eq('operacao_id', uniqueOperacaoIds[0])

  const nfIds = ((opNfs || []) as Array<{ nota_fiscal_id: string }>).map((row) => row.nota_fiscal_id)
  if (nfIds.length === 0) throw new Error('Nenhuma nota fiscal encontrada para esta operacao.')

  const { data: nfsData, error: nfsError } = await supabase
    .from('notas_fiscais')
    .select('*')
    .in('id', nfIds)
    .order('data_vencimento', { ascending: true })

  if (nfsError || !nfsData || nfsData.length === 0) throw new Error('Notas fiscais da operacao nao encontradas.')

  const configuracao = await resolverConfiguracaoCnab({
    supabase,
    fundoId: fundo.id,
    dataReferencia: dataGeracao,
  })

  const cedente: DadosCedente = {
    id: cedenteRow.id,
    razaoSocial: cedenteRow.razao_social,
    cnpj: cedenteRow.cnpj,
    coobrigacao: cedenteRow.coobrigacao !== false,
  }

  const operacoes: DadosOperacao[] = [{
    id: operacaoRow.id as string,
    cedenteId: operacaoRow.cedente_id as string,
    cedenteFundoId: (operacaoRow.cedente_fundo_id as string | null) ?? null,
    aprovadoEm: (operacaoRow.aprovado_em as string | null) ?? null,
    createdAt: operacaoRow.created_at as string,
  }]

  const titulos: TituloRemessa[] = (nfsData as Array<Record<string, unknown>>).map((nf) => ({
    notaFiscalId: nf.id as string,
    numero: String(nf.numero_nf || ''),
    serie: (nf.serie as string | null) ?? null,
    chaveAcesso: (nf.chave_acesso as string | null) ?? null,
    dataEmissao: nf.data_emissao as string,
    dataVencimento: nf.data_vencimento as string,
    valorFace: valorTitulo(nf),
    valorPresente: valorPresente(nf),
    sacadoCnpj: nf.cnpj_destinatario as string,
    sacadoNome: nf.razao_social_destinatario as string,
  }))

  const payloadHash = montarPayloadHash({
    fundo,
    cedente,
    operacoes,
    titulos,
    configuracaoVersaoId: configuracao.versaoId,
  })
  const idempotencyKey = montarIdempotencyKey({
    fundoId: fundo.id,
    configuracaoVersaoId: configuracao.versaoId,
    operacaoIds: uniqueOperacaoIds,
  })

  return { fundo, cedente, operacoes, titulos, configuracao, dataGeracao, idempotencyKey, payloadHash }
}

export function gerarRemessaCnab444ComSequencial(contexto: ContextoCnabCarregado, sequencial: number): RemessaCnabPreparada {
  const data = new Date(contexto.dataGeracao)
  const yyyymmdd = [
    data.getUTCFullYear(),
    String(data.getUTCMonth() + 1).padStart(2, '0'),
    String(data.getUTCDate()).padStart(2, '0'),
  ].join('')
  const nomeArquivo = `REM_${sanitizeArquivoSegment(contexto.fundo.nome)}_${yyyymmdd}_${String(sequencial).padStart(7, '0')}.REM`

  const input: RemessaOperacao = {
    fundo: contexto.fundo,
    cedente: contexto.cedente,
    operacoes: contexto.operacoes,
    titulos: contexto.titulos,
    conta: {
      banco: contexto.configuracao.banco,
      agencia: contexto.configuracao.agencia,
      conta: contexto.configuracao.conta,
      digitoConta: contexto.configuracao.digitoConta,
      carteira: contexto.configuracao.carteira,
      convenio: contexto.configuracao.convenio,
    },
    identificadores: {
      dataGeracao: contexto.dataGeracao,
      sequencial,
      nomeArquivo,
    },
    configuracao: contexto.configuracao,
  }

  return {
    input,
    resultado: geradorCnab444.gerar(input),
    idempotencyKey: contexto.idempotencyKey,
    payloadHash: contexto.payloadHash,
    nomeArquivo,
    fundoId: contexto.fundo.id,
    configuracaoCnabId: contexto.configuracao.configuracaoId,
    configuracaoCnabVersaoId: contexto.configuracao.versaoId,
  }
}

export async function gerarCnab444(operacaoId: string): Promise<string> {
  const contexto = await carregarContextoCnab444({ operacaoIds: [operacaoId] })
  return gerarRemessaCnab444ComSequencial(contexto, 1).resultado.conteudo
}
