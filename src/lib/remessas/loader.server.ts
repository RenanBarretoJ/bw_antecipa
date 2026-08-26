import 'server-only'

import { createAdminClient } from '@/lib/supabase/server'
import { buckets } from '@/lib/storage'
import { parseNFeXML } from '@/lib/nf-parser'
import { integrationRuntimeEnvironment, resolverIntegracaoPorCapability } from '@/lib/integracoes/resolver.server'
import type { RemessaLoteCanonico, RemessaNotaFiscalCanonica } from './domain'

type AdminClient = ReturnType<typeof createAdminClient>

function numero(value: unknown) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

async function enderecoDestinatarioDoXml(admin: AdminClient, storagePath: string | null) {
  if (!storagePath || !/\.xml$/i.test(storagePath)) return null
  const { data, error } = await admin.storage.from(buckets.notasFiscais).download(storagePath)
  if (error || !data) return null
  try {
    return parseNFeXML(await data.text()).destinatario_endereco
  } catch {
    return null
  }
}

export async function carregarLoteRemessaCanonico(
  operacaoIds: string[],
  admin: AdminClient = createAdminClient(),
): Promise<RemessaLoteCanonico> {
  const ids = [...new Set(operacaoIds.filter(Boolean))]
  if (ids.length === 0) throw new Error('Informe ao menos uma operacao para gerar a remessa.')

  const { data: operacoesRaw, error: operacoesError } = await admin
    .from('operacoes')
    .select('id, cedente_id, cedente_fundo_id, politica_operacional_versao_id')
    .in('id', ids)
  if (operacoesError) throw new Error(`Nao foi possivel carregar as operacoes da remessa: ${operacoesError.message}`)
  const operacoes = (operacoesRaw ?? []) as Array<{
    id: string
    cedente_id: string
    cedente_fundo_id: string | null
    politica_operacional_versao_id: string | null
  }>
  if (operacoes.length !== ids.length) throw new Error('Uma ou mais operacoes nao foram encontradas.')
  if (operacoes.some((item) => !item.cedente_fundo_id)) throw new Error('Operacao sem vinculo historico cedente-fundo.')

  const vinculoIds = operacoes.map((item) => item.cedente_fundo_id!)
  const { data: vinculosRaw, error: vinculosError } = await admin
    .from('cedente_fundos')
    .select('id, cedente_id, fundo_id, status')
    .in('id', vinculoIds)
  if (vinculosError) throw new Error(`Nao foi possivel resolver os vinculos cedente-fundo: ${vinculosError.message}`)
  const vinculos = (vinculosRaw ?? []) as Array<{ id: string; cedente_id: string; fundo_id: string; status: string }>
  const vinculoPorId = new Map(vinculos.map((item) => [item.id, item]))
  for (const operacao of operacoes) {
    const vinculo = vinculoPorId.get(operacao.cedente_fundo_id!)
    if (!vinculo || vinculo.cedente_id !== operacao.cedente_id) throw new Error(`Vinculo historico invalido na operacao ${operacao.id}.`)
    if (vinculo.status !== 'ativo') throw new Error(`Vinculo cedente-fundo da operacao ${operacao.id} nao esta ativo.`)
  }
  const fundoIds = [...new Set(vinculos.map((item) => item.fundo_id))]
  if (fundoIds.length !== 1) throw new Error('Uma remessa nao pode misturar operacoes de fundos diferentes.')
  const fundoId = fundoIds[0]

  const [{ data: fundoRaw, error: fundoError }, { data: cedentesRaw, error: cedentesError }, { data: linksRaw, error: linksError }] = await Promise.all([
    admin.from('fundos').select('id, nome, cnpj, ativo').eq('id', fundoId).maybeSingle(),
    admin.from('cedentes').select('id, cnpj, razao_social, coobrigacao, banco_codigo, agencia, conta').in('id', [...new Set(operacoes.map((item) => item.cedente_id))]),
    admin.from('operacoes_nfs').select('operacao_id, nota_fiscal_id').in('operacao_id', ids),
  ])
  if (fundoError || !fundoRaw) throw new Error(`Fundo da remessa nao encontrado${fundoError ? `: ${fundoError.message}` : '.'}`)
  const fundo = fundoRaw as { id: string; nome: string; cnpj: string; ativo: boolean | null }
  if (fundo.ativo !== true) throw new Error('Fundo inativo nao pode gerar remessa.')
  if (cedentesError) throw new Error(`Nao foi possivel carregar os Cedentes: ${cedentesError.message}`)
  if (linksError) throw new Error(`Nao foi possivel carregar as NFs das operacoes: ${linksError.message}`)

  const cedentes = (cedentesRaw ?? []) as Array<{
    id: string; cnpj: string; razao_social: string; coobrigacao: boolean
    banco_codigo: string | null; agencia: string | null; conta: string | null
  }>
  const cedentePorId = new Map(cedentes.map((item) => [item.id, item]))
  const links = (linksRaw ?? []) as Array<{ operacao_id: string; nota_fiscal_id: string }>
  const nfIds = [...new Set(links.map((item) => item.nota_fiscal_id))]
  if (nfIds.length === 0) throw new Error('Nenhuma NF vinculada as operacoes informadas.')

  const [{ data: nfsRaw, error: nfsError }, { data: selecoesRaw, error: selecoesError }, { data: parcelasRaw, error: parcelasError }, { data: memoriasRaw, error: memoriasError }] = await Promise.all([
    admin.from('notas_fiscais').select('id, cedente_id, estabelecimento_id, numero_nf, serie, chave_acesso, data_emissao, valor_bruto, cnpj_emitente, razao_social_emitente, cnpj_destinatario, razao_social_destinatario, arquivo_url').in('id', nfIds),
    admin.from('operacoes_nf_parcelas').select('operacao_id, nota_fiscal_id, parcela_id').in('operacao_id', ids),
    admin.from('nota_fiscal_parcelas').select('id, nota_fiscal_id, numero_parcela, data_vencimento, valor_nominal').in('nota_fiscal_id', nfIds),
    admin.from('operacao_calculo_nfs').select('operacao_id, nota_fiscal_id, parcela_id, valor_presente, taxa_mensal').in('operacao_id', ids),
  ])
  if (nfsError) throw new Error(`Nao foi possivel carregar as NFs: ${nfsError.message}`)
  if (selecoesError) throw new Error(`Nao foi possivel carregar as parcelas selecionadas: ${selecoesError.message}`)
  if (parcelasError) throw new Error(`Nao foi possivel carregar as parcelas das NFs: ${parcelasError.message}`)
  if (memoriasError) throw new Error(`Nao foi possivel carregar as memorias financeiras: ${memoriasError.message}`)

  const nfs = (nfsRaw ?? []) as Array<{
    id: string; cedente_id: string; estabelecimento_id: string | null; numero_nf: string; serie: string | null
    chave_acesso: string | null; data_emissao: string; valor_bruto: number; cnpj_emitente: string
    razao_social_emitente: string; cnpj_destinatario: string; razao_social_destinatario: string; arquivo_url: string | null
  }>
  const estabelecimentoIds = [...new Set(nfs.map((item) => item.estabelecimento_id).filter((id): id is string => Boolean(id)))]
  const { data: estabelecimentosRaw, error: estabelecimentosError } = estabelecimentoIds.length > 0
    ? await admin.from('cedente_estabelecimentos').select('id, cnpj, razao_social').in('id', estabelecimentoIds)
    : { data: [], error: null }
  if (estabelecimentosError) throw new Error(`Nao foi possivel carregar os estabelecimentos emissores: ${estabelecimentosError.message}`)
  const estabelecimentos = new Map(((estabelecimentosRaw ?? []) as Array<{ id: string; cnpj: string; razao_social: string }>).map((item) => [item.id, item]))
  const nfPorId = new Map(nfs.map((item) => [item.id, item]))
  const selecoes = (selecoesRaw ?? []) as Array<{ operacao_id: string; nota_fiscal_id: string; parcela_id: string }>
  const parcelas = (parcelasRaw ?? []) as Array<{ id: string; nota_fiscal_id: string; numero_parcela: number; data_vencimento: string; valor_nominal: number }>
  const parcelaPorId = new Map(parcelas.map((item) => [item.id, item]))
  const memoriaPorChave = new Map(((memoriasRaw ?? []) as Array<{ operacao_id: string; parcela_id: string | null; valor_presente: number; taxa_mensal: number }>).map((item) => [`${item.operacao_id}:${item.parcela_id}`, item]))
  const quantidadeParcelasPorNf = new Map<string, number>()
  for (const parcela of parcelas) quantidadeParcelasPorNf.set(parcela.nota_fiscal_id, (quantidadeParcelasPorNf.get(parcela.nota_fiscal_id) ?? 0) + 1)
  const enderecoPorNf = new Map<string, Awaited<ReturnType<typeof enderecoDestinatarioDoXml>>>()
  await Promise.all(nfs.map(async (nf) => enderecoPorNf.set(nf.id, await enderecoDestinatarioDoXml(admin, nf.arquivo_url))))

  const integracao = await resolverIntegracaoPorCapability({
    fundoId,
    ambiente: integrationRuntimeEnvironment(),
    capability: 'CESSAO_ENVIO',
  }, admin)
  if (integracao.status !== 'CONFIGURADA') throw new Error(`Integracao de cessao indisponivel para o fundo: ${integracao.reason}.`)

  const operacoesCanonicas = operacoes.map((operacao) => {
    const cedente = cedentePorId.get(operacao.cedente_id)
    const vinculo = vinculoPorId.get(operacao.cedente_fundo_id!)
    if (!cedente || !vinculo) throw new Error(`Contexto do Cedente ausente na operacao ${operacao.id}.`)
    const notas: RemessaNotaFiscalCanonica[] = links.filter((link) => link.operacao_id === operacao.id).map((link) => {
      const nf = nfPorId.get(link.nota_fiscal_id)
      if (!nf) throw new Error(`NF ${link.nota_fiscal_id} da operacao ${operacao.id} nao encontrada.`)
      if (nf.cedente_id !== cedente.id) throw new Error(`NF ${nf.id} nao pertence ao Cedente da operacao.`)
      const estabelecimento = nf.estabelecimento_id ? estabelecimentos.get(nf.estabelecimento_id) : null
      const endereco = enderecoPorNf.get(nf.id)
      const parcelasSelecionadas = selecoes
        .filter((item) => item.operacao_id === operacao.id && item.nota_fiscal_id === nf.id)
        .map((selecao) => {
          const parcela = parcelaPorId.get(selecao.parcela_id)
          const memoria = memoriaPorChave.get(`${operacao.id}:${selecao.parcela_id}`)
          if (!parcela || parcela.nota_fiscal_id !== nf.id) throw new Error(`Parcela selecionada ${selecao.parcela_id} nao pertence a NF ${nf.id}.`)
          return {
            id: parcela.id,
            numero: parcela.numero_parcela,
            vencimento: parcela.data_vencimento,
            valorNominal: numero(parcela.valor_nominal),
            valorPresente: memoria ? numero(memoria.valor_presente) : -1,
            taxaMensal: memoria ? numero(memoria.taxa_mensal) : null,
          }
        })
        .sort((a, b) => a.numero - b.numero)
      return {
        id: nf.id,
        numero: nf.numero_nf,
        serie: nf.serie,
        chaveAcesso: nf.chave_acesso,
        dataEmissao: nf.data_emissao,
        valorBruto: numero(nf.valor_bruto),
        quantidadeParcelasOriginal: quantidadeParcelasPorNf.get(nf.id) ?? 0,
        emissor: {
          estabelecimentoId: estabelecimento?.id ?? nf.estabelecimento_id,
          cnpj: estabelecimento?.cnpj ?? nf.cnpj_emitente ?? cedente.cnpj,
          nome: estabelecimento?.razao_social ?? nf.razao_social_emitente ?? cedente.razao_social,
        },
        devedor: {
          cnpj: nf.cnpj_destinatario,
          nome: nf.razao_social_destinatario,
          cep: endereco?.cep || null,
          endereco: endereco?.logradouro || null,
          numero: endereco?.numero || null,
          complemento: endereco?.complemento || null,
          bairro: endereco?.bairro || null,
          municipio: endereco?.municipio || null,
          uf: endereco?.uf || null,
          email: endereco?.email || null,
          telefone: endereco?.telefone || null,
        },
        parcelasSelecionadas,
      }
    })
    const primeiraNf = notas[0]
    const estabelecimento = primeiraNf ? nfPorId.get(primeiraNf.id)?.estabelecimento_id : null
    const estabelecimentoRow = estabelecimento ? estabelecimentos.get(estabelecimento) : null
    const primeiroEmissor = primeiraNf?.emissor
    return {
      id: operacao.id,
      fundoId,
      cedenteFundoId: vinculo.id,
      politicaOperacionalVersaoId: operacao.politica_operacional_versao_id,
      cedente: {
        id: cedente.id,
        cnpj: cedente.cnpj,
        razaoSocial: cedente.razao_social,
        coobrigacao: cedente.coobrigacao !== false,
        bancoCodigo: cedente.banco_codigo,
        agencia: cedente.agencia,
        conta: cedente.conta,
      },
      estabelecimento: {
        id: estabelecimentoRow?.id ?? null,
        cnpj: estabelecimentoRow?.cnpj ?? primeiroEmissor?.cnpj ?? cedente.cnpj,
        razaoSocial: estabelecimentoRow?.razao_social ?? primeiroEmissor?.nome ?? cedente.razao_social,
      },
      notas,
    }
  })

  return {
    fundo: { id: fundo.id, nome: fundo.nome, cnpj: fundo.cnpj },
    integracao: {
      versaoId: integracao.integrationVersion.integrationVersionId,
      adapterKey: integracao.integrationVersion.adapterKey,
      configuracao: integracao.integrationVersion.config,
    },
    operacoes: operacoesCanonicas,
  }
}
