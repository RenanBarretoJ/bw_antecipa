import {
  chaveUnicaAtivo,
  chaveUnicaParcela,
  type GrupoRemessaCanonico,
} from '@/lib/remessas/domain'

export interface ConfiguracaoVrsInclusao {
  termo: string
  codigoCarteira: string
  cnpjOriginador: string
  tipoPreco: 'POSFIXADO' | 'PREFIXADO'
  metodoPreco: string
  modalidadeOperacao: string
  registradora: 'B3' | 'CERC'
}

export interface VrsAtivoMapeado {
  chaveUnicaAtivo: string
  operacaoId: string
  notaFiscalId: string
  campos: string[]
}

export interface VrsFluxoMapeado {
  chaveUnicaAtivo: string
  chaveUnicaParcela: string
  operacaoId: string
  notaFiscalId: string
  parcelaId: string
  campos: string[]
}

export interface VrsInclusaoMapeada {
  cedenteId: string
  cedenteCnpj: string
  header: string[]
  ativos: VrsAtivoMapeado[]
  fluxos: VrsFluxoMapeado[]
  pagamento: string[]
}

export class VrsMappingError extends Error {
  constructor(public readonly bloqueios: string[]) {
    super(`Remessa VRS bloqueada por campos obrigatorios ausentes ou invalidos: ${bloqueios.join('; ')}`)
    this.name = 'VrsMappingError'
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function texto(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function somenteDigitos(value: string | null | undefined) {
  return (value ?? '').replace(/\D/g, '')
}

function dataBr(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  return match ? `${match[3]}/${match[2]}/${match[1]}` : ''
}

function decimalBr(value: number) {
  if (!Number.isFinite(value)) return ''
  return value.toFixed(2).replace('.', ',')
}

function valorObrigatorio(value: string, campo: string, bloqueios: string[]) {
  if (!value) bloqueios.push(campo)
  return value
}

function validarCampoCsv(value: string, campo: string, bloqueios: string[]) {
  if (/[;\r\n]/.test(value)) bloqueios.push(`${campo} contem delimitador ou quebra de linha nao suportada pelo CSV oficial`)
  return value
}

function parseConta(contaOriginal: string | null, bloqueios: string[]) {
  const conta = texto(contaOriginal)
  const match = /^(\d{1,12})-([0-9])$/.exec(conta)
  if (!match) {
    bloqueios.push('cedentes.conta deve estar no formato numero-digito para o PAGAMENTO VRS')
    return { numero: '', digito: '' }
  }
  return { numero: match[1], digito: match[2] }
}

export function lerConfiguracaoVrs(configuracao: Record<string, unknown>): ConfiguracaoVrsInclusao {
  const raiz = object(configuracao.vrs_inclusao) ?? {}
  return {
    termo: texto(raiz.termo),
    codigoCarteira: texto(configuracao.codigo_carteira),
    cnpjOriginador: somenteDigitos(texto(raiz.cnpj_originador)),
    tipoPreco: texto(raiz.tipo_preco) as ConfiguracaoVrsInclusao['tipoPreco'],
    metodoPreco: texto(raiz.metodo_preco),
    modalidadeOperacao: somenteDigitos(texto(raiz.modalidade_operacao)),
    registradora: texto(raiz.registradora) as ConfiguracaoVrsInclusao['registradora'],
  }
}

export function mapearGrupoParaVrs(
  grupo: GrupoRemessaCanonico,
  configuracaoRaw: Record<string, unknown>,
): VrsInclusaoMapeada {
  const bloqueios: string[] = []
  const config = lerConfiguracaoVrs(configuracaoRaw)
  if (!grupo.cedenteId || grupo.operacoes.length === 0) bloqueios.push('grupo POR_CEDENTE vazio ou sem cedente')
  const cedentes = new Set(grupo.operacoes.map((item) => item.cedente.id))
  if (cedentes.size !== 1) bloqueios.push('arquivo VRS nao pode misturar Cedentes')

  const primeira = grupo.operacoes[0]
  const cedente = primeira?.cedente
  const cedenteCnpj = somenteDigitos(cedente?.cnpj)
  if (cedenteCnpj.length !== 14) bloqueios.push('cedentes.cnpj deve possuir 14 digitos')
  if (!config.termo) bloqueios.push('configuracao_nao_sensivel.vrs_inclusao.termo')
  if (!config.codigoCarteira) bloqueios.push('configuracao_nao_sensivel.codigo_carteira')
  if (config.cnpjOriginador.length !== 14) bloqueios.push('configuracao_nao_sensivel.vrs_inclusao.cnpj_originador deve possuir 14 digitos')
  if (!['POSFIXADO', 'PREFIXADO'].includes(config.tipoPreco)) bloqueios.push('configuracao_nao_sensivel.vrs_inclusao.tipo_preco')
  if (!config.metodoPreco) bloqueios.push('configuracao_nao_sensivel.vrs_inclusao.metodo_preco')
  if (!/^\d{4}$/.test(config.modalidadeOperacao)) bloqueios.push('configuracao_nao_sensivel.vrs_inclusao.modalidade_operacao deve possuir 4 digitos')
  if (!['B3', 'CERC'].includes(config.registradora)) bloqueios.push('configuracao_nao_sensivel.vrs_inclusao.registradora')

  const ativos: VrsAtivoMapeado[] = []
  const fluxos: VrsFluxoMapeado[] = []
  let valorPagamento = 0

  for (const operacao of grupo.operacoes) {
    if (operacao.fundoId !== primeira.fundoId) bloqueios.push(`operacao ${operacao.id} pertence a outro fundo`)
    if (operacao.cedente.id !== grupo.cedenteId) bloqueios.push(`operacao ${operacao.id} pertence a outro Cedente`)
    for (const nota of operacao.notas) {
      const emissorCnpj = somenteDigitos(nota.emissor.cnpj)
      if (emissorCnpj.length !== 14) bloqueios.push(`NF ${nota.numero}: estabelecimento emissor sem CNPJ valido`)
      if (nota.parcelasSelecionadas.length === 0) {
        bloqueios.push(`NF ${nota.numero} sem parcela selecionada em operacoes_nf_parcelas`)
        continue
      }
      const chaveAtivo = chaveUnicaAtivo(nota.id)
      const devedorCnpj = somenteDigitos(nota.devedor.cnpj)
      const cep = somenteDigitos(nota.devedor.cep)
      if (devedorCnpj.length !== 14) bloqueios.push(`NF ${nota.numero}: CNPJ do devedor invalido`)
      if (!nota.devedor.nome) bloqueios.push(`NF ${nota.numero}: nome do devedor ausente`)
      if (!/^\d{5,9}$/.test(cep)) bloqueios.push(`NF ${nota.numero}: CEP do devedor ausente ou invalido`)
      if (!nota.devedor.endereco) bloqueios.push(`NF ${nota.numero}: endereco do devedor ausente`)
      if (!nota.devedor.numero) bloqueios.push(`NF ${nota.numero}: numero do endereco do devedor ausente`)
      if (!nota.devedor.bairro) bloqueios.push(`NF ${nota.numero}: bairro do devedor ausente`)
      if (!nota.devedor.municipio) bloqueios.push(`NF ${nota.numero}: municipio do devedor ausente`)
      if (!/^[A-Za-z]{2}$/.test(nota.devedor.uf ?? '')) bloqueios.push(`NF ${nota.numero}: UF do devedor ausente ou invalida`)
      if (!dataBr(nota.dataEmissao)) bloqueios.push(`NF ${nota.numero}: data de emissao invalida`)

      const vencimentos = nota.parcelasSelecionadas.map((parcela) => parcela.vencimento).sort()
      const vencimentoAtivo = vencimentos.at(-1) ?? ''
      const valorCompra = nota.parcelasSelecionadas.reduce((total, parcela) => total + parcela.valorPresente, 0)
      const valorVencimento = nota.parcelasSelecionadas.reduce((total, parcela) => total + parcela.valorNominal, 0)
      valorPagamento += valorCompra

      const camposAtivo = [
        'ATIVO', chaveAtivo, config.cnpjOriginador, emissorCnpj, devedorCnpj,
        nota.devedor.nome, cep, nota.devedor.endereco ?? '', nota.devedor.numero ?? '', nota.devedor.complemento ?? '',
        nota.devedor.bairro ?? '', nota.devedor.municipio ?? '', (nota.devedor.uf ?? '').toUpperCase(),
        nota.devedor.email ?? '', somenteDigitos(nota.devedor.telefone), 'DM', config.tipoPreco,
        config.metodoPreco, decimalBr(nota.valorBruto), decimalBr(valorCompra), decimalBr(valorVencimento),
        dataBr(nota.dataEmissao), dataBr(nota.dataEmissao), dataBr(vencimentoAtivo), dataBr(vencimentoAtivo),
        '', '', somenteDigitos(nota.numero), '', '', '', config.modalidadeOperacao,
        String(nota.quantidadeParcelasOriginal), decimalBr(valorCompra), decimalBr(nota.valorBruto), config.registradora,
        '', '', '', '', '',
      ].map((value, index) => validarCampoCsv(String(value), `ATIVO[${index}] NF ${nota.numero}`, bloqueios))
      ativos.push({ chaveUnicaAtivo: chaveAtivo, operacaoId: operacao.id, notaFiscalId: nota.id, campos: camposAtivo })

      for (const parcela of nota.parcelasSelecionadas) {
        const chaveParcela = chaveUnicaParcela(parcela.id)
        const vencimento = dataBr(parcela.vencimento)
        if (!vencimento) bloqueios.push(`NF ${nota.numero} parcela ${parcela.numero}: vencimento invalido`)
        if (!(parcela.valorNominal > 0)) bloqueios.push(`NF ${nota.numero} parcela ${parcela.numero}: valor nominal invalido`)
        if (!(parcela.valorPresente >= 0)) bloqueios.push(`NF ${nota.numero} parcela ${parcela.numero}: memoria financeira ausente ou invalida`)
        // O CSV oficial possui 15 colunas no golden, apesar de o documento textual
        // numerar um campo reservado adicional. Mantemos o arquivo oficial sem
        // preencher/corrigir criativamente essa divergencia.
        const camposFluxo = [
          'FLUXO', chaveAtivo, chaveParcela, emissorCnpj, vencimento, vencimento,
          '', 'Amortizacao', '', decimalBr(parcela.valorNominal), '', '', '', '', '',
        ]
        fluxos.push({
          chaveUnicaAtivo: chaveAtivo,
          chaveUnicaParcela: chaveParcela,
          operacaoId: operacao.id,
          notaFiscalId: nota.id,
          parcelaId: parcela.id,
          campos: camposFluxo,
        })
      }
    }
  }

  const banco = somenteDigitos(cedente?.bancoCodigo)
  const agencia = texto(cedente?.agencia)
  const conta = parseConta(cedente?.conta ?? null, bloqueios)
  if (!/^\d{3}$/.test(banco)) bloqueios.push('cedentes.banco_codigo deve possuir 3 digitos')
  if (!/^[A-Za-z0-9_-]{4}$/.test(agencia)) bloqueios.push('cedentes.agencia deve possuir 4 caracteres aceitos pelo VRS')
  if (!cedente?.razaoSocial) bloqueios.push('cedentes.razao_social')

  const header = ['HEADER', 'Inclusão', config.termo, config.codigoCarteira, cedenteCnpj, cedente?.coobrigacao ? 'Sim' : 'Não']
  const pagamento = ['PAGAMENTO', banco, agencia, conta.numero, conta.digito, cedenteCnpj, cedente?.razaoSocial ?? '', decimalBr(valorPagamento)]
  header.forEach((value, index) => validarCampoCsv(value, `HEADER[${index}]`, bloqueios))
  pagamento.forEach((value, index) => validarCampoCsv(value, `PAGAMENTO[${index}]`, bloqueios))
  if (ativos.length === 0) bloqueios.push('nenhum ATIVO elegivel')
  if (fluxos.length === 0) bloqueios.push('nenhum FLUXO selecionado')
  if (bloqueios.length > 0) throw new VrsMappingError([...new Set(bloqueios)])

  return { cedenteId: grupo.cedenteId!, cedenteCnpj, header, ativos, fluxos, pagamento }
}
