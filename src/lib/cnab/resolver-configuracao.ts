import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  calcularHashConfiguracaoCnab,
  CONFIGURACAO_CNAB_LEGADO_PADRAO,
  type CnabLayoutOptions,
  type ConfiguracaoCnabResolvida,
} from '@/lib/cnab/domain'

interface ConfiguracaoRow {
  id: string
  fundo_id: string
  codigo: string
  status: string
  configuracao_cnab_versoes?: ConfiguracaoVersaoRow[]
}

interface ConfiguracaoVersaoRow {
  id: string
  configuracao_cnab_id: string
  versao: number
  vigente_desde: string
  vigente_ate: string | null
  layout: string
  versao_layout: string
  codigo_banco: string
  banco: string
  agencia: string
  conta: string
  digito_conta: string
  carteira: string
  convenio: string
  codigo_originador: string
  codigo_empresa: string
  tipo_inscricao: string
  numero_inscricao: string
  especie_titulo: string
  tipo_recebivel: string
  configuracao: Record<string, unknown>
  conteudo_hash: string
  status: string
}

export function normalizarConfiguracaoCnabInput(input: Omit<ConfiguracaoCnabResolvida, 'configuracaoId' | 'versaoId' | 'versao' | 'hash' | 'codigo'>): Omit<ConfiguracaoCnabResolvida, 'configuracaoId' | 'versaoId' | 'versao' | 'hash' | 'codigo'> {
  return {
    layout: input.layout,
    versaoLayout: input.versaoLayout.trim(),
    codigoBanco: input.codigoBanco.replace(/\D/g, ''),
    banco: input.banco.trim().toUpperCase(),
    agencia: input.agencia.replace(/\D/g, ''),
    conta: input.conta.replace(/\D/g, ''),
    digitoConta: input.digitoConta.replace(/\W/g, '').toUpperCase(),
    carteira: input.carteira.replace(/\D/g, ''),
    convenio: input.convenio.replace(/\D/g, ''),
    codigoOriginador: input.codigoOriginador.trim(),
    codigoEmpresa: input.codigoEmpresa.replace(/\D/g, ''),
    tipoInscricao: input.tipoInscricao.replace(/\D/g, ''),
    numeroInscricao: input.numeroInscricao.replace(/\D/g, ''),
    especieTitulo: input.especieTitulo.replace(/\D/g, ''),
    tipoRecebivel: input.tipoRecebivel.replace(/\D/g, ''),
    configuracao: normalizarLayoutOptions(input.configuracao),
  }
}

function normalizarLayoutOptions(options: CnabLayoutOptions | Record<string, unknown> | null | undefined): CnabLayoutOptions {
  const opt = (options || {}) as CnabLayoutOptions
  return {
    ...opt,
    literalRemessa: opt.literalRemessa?.trim().toUpperCase(),
    codigoServico: opt.codigoServico?.replace(/\D/g, ''),
    literalServico: opt.literalServico?.trim().toUpperCase(),
    identificacaoSistema: opt.identificacaoSistema?.trim().toUpperCase(),
    ocorrencia: opt.ocorrencia?.replace(/\D/g, ''),
    caracteristicaEspecial: opt.caracteristicaEspecial?.replace(/\D/g, ''),
    modalidadeOperacao: opt.modalidadeOperacao?.replace(/\D/g, ''),
    naturezaOperacao: opt.naturezaOperacao?.replace(/\D/g, ''),
    origemRecurso: opt.origemRecurso?.replace(/\D/g, ''),
    numeroBancoCobranca: opt.numeroBancoCobranca?.replace(/\D/g, ''),
    agenciaDepositaria: opt.agenciaDepositaria?.replace(/\D/g, ''),
    tipoPessoaCedente: opt.tipoPessoaCedente?.replace(/\D/g, ''),
    tipoInscricaoSacado: opt.tipoInscricaoSacado?.replace(/\D/g, ''),
    cepSacadoDefault: opt.cepSacadoDefault?.replace(/\D/g, ''),
  }
}

export function validarConfiguracaoCnab(config: Omit<ConfiguracaoCnabResolvida, 'configuracaoId' | 'versaoId' | 'versao' | 'hash' | 'codigo'>): string[] {
  const erros: string[] = []
  if (config.layout !== 'cnab444') erros.push('Layout suportado nesta fase: cnab444.')
  if (!config.versaoLayout) erros.push('Versao do layout e obrigatoria.')
  if (!/^\d{3}$/.test(config.codigoBanco)) erros.push('Codigo do banco deve ter 3 digitos.')
  if (!config.banco) erros.push('Nome do banco e obrigatorio.')
  if (!config.codigoOriginador) erros.push('Codigo originador e obrigatorio.')
  if (config.codigoOriginador && !/^\d+$/.test(config.codigoOriginador)) erros.push('Codigo originador deve conter somente digitos.')
  if (config.codigoOriginador.length > 20) erros.push('Codigo originador deve ter no maximo 20 caracteres no CNAB444.')
  if (!config.codigoEmpresa || !/^\d+$/.test(config.codigoEmpresa) || config.codigoEmpresa.length > 20) erros.push('Codigo da empresa deve ser numerico com ate 20 digitos.')
  if (!/^\d{2}$/.test(config.tipoInscricao)) erros.push('Tipo de inscricao deve ter 2 digitos.')
  if (!/^\d{14}$/.test(config.numeroInscricao)) erros.push('Numero de inscricao deve ter 14 digitos.')
  if (!/^\d{2}$/.test(config.especieTitulo)) erros.push('Especie do titulo deve ter 2 digitos.')
  if (!config.tipoRecebivel) erros.push('Tipo de recebivel e obrigatorio.')
  return erros
}

function mapearVersao(config: ConfiguracaoRow, versao: ConfiguracaoVersaoRow): ConfiguracaoCnabResolvida {
  const normalized = normalizarConfiguracaoCnabInput({
    layout: versao.layout as 'cnab444',
    versaoLayout: versao.versao_layout,
    codigoBanco: versao.codigo_banco,
    banco: versao.banco,
    agencia: versao.agencia,
    conta: versao.conta,
    digitoConta: versao.digito_conta,
    carteira: versao.carteira,
    convenio: versao.convenio,
    codigoOriginador: versao.codigo_originador,
    codigoEmpresa: versao.codigo_empresa,
    tipoInscricao: versao.tipo_inscricao,
    numeroInscricao: versao.numero_inscricao,
    especieTitulo: versao.especie_titulo,
    tipoRecebivel: versao.tipo_recebivel,
    configuracao: versao.configuracao,
  })
  const hash = calcularHashConfiguracaoCnab(normalized)
  if (hash !== versao.conteudo_hash) {
    throw new Error('Hash da versao de configuracao CNAB nao confere com o conteudo normalizado.')
  }
  return {
    configuracaoId: config.id,
    versaoId: versao.id,
    versao: versao.versao,
    hash,
    codigo: config.codigo,
    ...normalized,
  }
}

export async function resolverConfiguracaoCnab({
  supabase,
  fundoId,
  dataReferencia = new Date().toISOString(),
  codigo,
}: {
  supabase: SupabaseClient<Database>
  fundoId: string
  dataReferencia?: string
  codigo?: string
}): Promise<ConfiguracaoCnabResolvida> {
  let query = supabase
    .from('configuracoes_cnab')
    .select('*, configuracao_cnab_versoes(*)')
    .eq('fundo_id', fundoId)
    .eq('status', 'ativa')

  if (codigo) query = query.eq('codigo', codigo)

  const { data, error } = await query
  if (error) throw new Error(`Erro ao resolver configuracao CNAB: ${error.message}`)

  const candidatos = (data || []) as unknown as ConfiguracaoRow[]
  const dataRef = new Date(dataReferencia).getTime()
  const publicados = candidatos.flatMap((config) =>
    (config.configuracao_cnab_versoes || [])
      .filter((versao) => versao.status === 'publicada')
      .filter((versao) => new Date(versao.vigente_desde).getTime() <= dataRef)
      .filter((versao) => !versao.vigente_ate || new Date(versao.vigente_ate).getTime() > dataRef)
      .map((versao) => ({ config, versao })),
  )

  publicados.sort((a, b) => b.versao.versao - a.versao.versao)
  const resolved = publicados[0]
  if (!resolved) throw new Error('Configuracao CNAB publicada e vigente nao encontrada para o fundo.')
  return mapearVersao(resolved.config, resolved.versao)
}

export function montarConfiguracaoLegadoParaCadastro() {
  const normalized = normalizarConfiguracaoCnabInput(CONFIGURACAO_CNAB_LEGADO_PADRAO)
  return {
    ...normalized,
    conteudoHash: calcularHashConfiguracaoCnab(normalized),
  }
}
