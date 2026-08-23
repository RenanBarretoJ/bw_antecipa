// Tipos do estado atual do banco: schema base + migrations 003 a 016.
// Não incluir aqui modelos da Fase 2 ou status logísticos.

export type {
  AuditoriaAtorTipo,
  AuditOrigin,
  AceiteSacadoStatus,
  CanhotoStatus,
  CedenteFundoStatus,
  CnabConfigStatus,
  CnabConfigVersionStatus,
  CnabRemessaStatus,
  IntegracaoAmbiente,
  IntegracaoFundoProvedor,
  IntegracaoFundoStatus,
  IntegracaoFundoVersaoStatus,
  IntegracaoExecucaoStatus,
  IntegracaoExecucaoTipo,
  RetornoIntegracaoTipo,
  ContaEscrowStatus,
  CedenteAcessoPerfil,
  CedenteStatus,
  ContextoConfiguracaoStatus,
  CteFormato,
  CteNivelValidacao,
  CteStatus,
  DocumentoStatus,
  DocumentoTipo,
  DocumentoAnaliseResultado,
  DocumentoVersaoStatus,
  EntregaEventoTipo,
  EntregaStatus,
  GeneratedDocumentStatus,
  MovimentoTipo,
  NfStatus,
  OperacaoStatus,
  PoliticaNivelValidacao,
  PoliticaRequisitoEscopo,
  PoliticaResponsavel,
  PoliticaStatus,
  PoliticaVersaoStatus,
  CedenteFundoPoliticaStatus,
  PoliticaTipoDocumentoCodigo,
  RepositorioDocumentoStatus,
  RequisitoDocumentoStatus,
  SolicitacaoAlteracaoStatus,
  TemplateDocumentStatus,
  TemplateDocumentType,
  TemplateVersionStatus,
  TipoContaBancaria,
  UserRole,
  UserStatus,
} from '@/lib/types/domain'

import type {
  AuditoriaAtorTipo,
  CanhotoStatus,
  CedenteAcessoPerfil,
  CedenteStatus,
  CedenteFundoStatus,
  CnabConfigStatus,
  CnabConfigVersionStatus,
  CnabRemessaStatus,
  IntegracaoAmbiente,
  IntegracaoFundoProvedor,
  IntegracaoFundoStatus,
  IntegracaoFundoVersaoStatus,
  IntegracaoExecucaoStatus,
  IntegracaoExecucaoTipo,
  RetornoIntegracaoTipo,
  ContextoConfiguracaoStatus,
  ContaEscrowStatus,
  AceiteSacadoStatus,
  CteFormato,
  CteNivelValidacao,
  CteStatus,
  DocumentoStatus,
  DocumentoTipo,
  DocumentoAnaliseResultado,
  DocumentoVersaoStatus,
  EntregaEventoTipo,
  EntregaStatus,
  GeneratedDocumentStatus,
  MovimentoTipo,
  NfStatus,
  OperacaoStatus,
  PoliticaNivelValidacao,
  PoliticaRequisitoEscopo,
  PoliticaResponsavel,
  PoliticaStatus,
  PoliticaVersaoStatus,
  CedenteFundoPoliticaStatus,
  PoliticaTipoDocumentoCodigo,
  RepositorioDocumentoStatus,
  RequisitoDocumentoStatus,
  SolicitacaoAlteracaoStatus,
  TemplateDocumentStatus,
  TemplateDocumentType,
  TemplateVersionStatus,
  TipoContaBancaria,
  UserRole,
  UserStatus,
} from '@/lib/types/domain'

type InsertShape<Row, RequiredKeys extends keyof Row = never> = Partial<Row> & Pick<Row, RequiredKeys>
type UpdateShape<Row> = Partial<Omit<Row, 'id' | 'created_at' | 'updated_at'>>

export interface Profile {
  id: string
  role: UserRole
  nome_completo: string
  email: string
  telefone: string | null
  status: UserStatus
  mfa_obrigatorio_override: boolean | null
  mfa_ativado_em: string | null
  ultima_autenticacao_forte_em: string | null
  mfa_reset_em: string | null
  sessoes_revogadas_em: string | null
  senha_alterada_em: string | null
  created_at: string
  updated_at: string
}

export interface UsuarioPapel {
  usuario_id: string
  papel: UserRole
  ativo: boolean
  origem: 'perfil_primario' | 'bootstrap_homolog' | 'administracao'
  atribuido_por: string | null
  atribuido_em: string
  revogado_em: string | null
  created_at: string
  updated_at: string
}

export interface UsuarioFundo {
  id: string
  usuario_id: string
  fundo_id: string
  perfil_no_fundo: string
  status: 'ativo' | 'suspenso' | 'revogado'
  principal: boolean
  created_at: string
  updated_at: string
}

export interface PlataformaAuditoria {
  id: string
  tipo_evento: string
  ator_usuario_id: string | null
  usuario_alvo_id: string | null
  origem: string
  correlation_id: string
  dados: Record<string, unknown>
  created_at: string
}

export interface Cedente {
  id: string
  user_id: string
  cnpj: string
  razao_social: string
  nome_fantasia: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  estado: string | null
  telefone_comercial: string | null
  email_comercial: string | null
  cnae: string | null
  nome_representante: string | null
  cpf_representante: string | null
  rg_representante: string | null
  cargo_representante: string | null
  email_representante: string | null
  telefone_representante: string | null
  banco: string | null
  agencia: string | null
  conta: string | null
  tipo_conta: TipoContaBancaria | null
  status: CedenteStatus
  fundo_id: string | null
  sacado_razao_social: string | null
  sacado_cnpj: string | null
  sacado_descricao: string | null
  sacado_banco_escrow: string | null
  sacado_conta_escrow: string | null
  sacado_agencia_escrow: string | null
  sacado_tipo_conta_escrow: string | null
  contrato_url: string | null
  contrato_gerado_em: string | null
  testemunha_1_nome: string | null
  testemunha_1_cpf: string | null
  testemunha_2_nome: string | null
  testemunha_2_cpf: string | null
  contrato_assinado_url: string | null
  habilitar_escrow: boolean
  coobrigacao: boolean
  permite_cadastro_filiais: boolean
  created_at: string
  updated_at: string
}

export interface CedenteEstabelecimento {
  id: string
  cedente_id: string
  cnpj: string
  razao_social: string
  nome_fantasia: string | null
  tipo: 'matriz' | 'filial'
  matriz_estabelecimento_id: string | null
  status: 'rascunho' | 'pendente' | 'aprovado' | 'rejeitado' | 'suspenso'
  motivo_status: string | null
  aprovado_por: string | null
  aprovado_em: string | null
  ativo: boolean
  created_at: string
  updated_at: string
}

export interface CedenteEstabelecimentoContaBancaria {
  id: string
  estabelecimento_id: string
  banco: string
  agencia: string
  conta: string
  tipo_conta: string | null
  principal: boolean
  ativo: boolean
  created_at: string
  updated_at: string
}

export interface CedenteEstabelecimentoRequisito {
  id: string
  estabelecimento_id: string
  documento_tipo_id: string
  obrigatorio: boolean
  ativo: boolean
  observacoes: string | null
  configurado_por: string | null
  created_at: string
  updated_at: string
}

export interface EstabelecimentoRequisitoStatus {
  requisito_id: string
  documento_tipo_id: string
  documento_tipo_codigo: string
  documento_tipo_nome: string
  obrigatorio: boolean
  ativo: boolean
  status: 'pendente' | 'enviado' | 'em_analise' | 'aprovado' | 'rejeitado' | 'substituido' | 'cancelado'
  origem: 'estabelecimento' | 'cadastro_inicial' | null
  documento_versao_id: string | null
  numero_versao: number | null
  nome_arquivo: string | null
  motivo: string | null
  analisado_por: string | null
  analisado_em: string | null
  documento_legado_id: string | null
  pendencia_pos_aprovacao: boolean
}

export interface Representante {
  id: string
  cedente_id: string
  nome: string
  cpf: string
  rg: string
  cargo: string
  email: string
  telefone: string
  principal: boolean
  created_at: string
  updated_at: string
}

export interface Documento {
  id: string
  cedente_id: string
  representante_id: string | null
  tipo: DocumentoTipo
  versao: number
  status: DocumentoStatus
  url_arquivo: string | null
  nome_arquivo: string | null
  motivo_reprovacao: string | null
  analisado_por: string | null
  analisado_em: string | null
  atualizacao_solicitada_em: string | null
  atualizacao_solicitada_por: string | null
  created_at: string
  updated_at: string
}

export interface ContaEscrow {
  id: string
  cedente_id: string
  identificador: string
  saldo_disponivel: number
  saldo_bloqueado: number
  status: ContaEscrowStatus
  created_at: string
  updated_at: string
}

export interface MovimentoEscrow {
  id: string
  conta_escrow_id: string
  tipo: MovimentoTipo
  descricao: string
  valor: number
  saldo_apos: number
  operacao_id: string | null
  created_at: string
}

export interface Fundo {
  id: string
  nome: string
  cnpj: string
  administradora_nome: string
  administradora_cnpj: string
  gestora_nome: string
  gestora_cnpj: string
  custodiante_nome: string | null
  custodiante_cnpj: string | null
  conta_vinculada: string | null
  agencia: string | null
  banco: string | null
  administradora_endereco: string | null
  administradora_ato_declaratorio: string | null
  contato_nome: string | null
  contato_email: string | null
  ativo: boolean | null
  created_at: string | null
  created_by?: string | null
  updated_at?: string
}

export interface CedenteFundo {
  id: string
  cedente_id: string
  fundo_id: string
  codigo_externo: string | null
  status: CedenteFundoStatus
  vigente_desde: string
  vigente_ate: string | null
  observacoes: string | null
  created_at: string
  updated_at: string
}

export interface PoliticaOperacional {
  id: string
  fundo_id: string
  codigo: string
  nome: string
  descricao: string | null
  status: PoliticaStatus
  padrao: boolean
  created_by: string
  created_at: string
  updated_at: string
}

export interface PoliticaOperacionalVersao {
  id: string
  politica_operacional_id: string
  fundo_id: string
  cedente_fundo_id: string | null
  versao: number
  status: PoliticaVersaoStatus
  vigente_desde: string
  vigente_ate: string | null
  aceite_sacado_obrigatorio: boolean
  cessao_no_desembolso: boolean
  cria_acompanhamento_entrega: boolean
  exigir_status_logistico_pre_cessao: boolean
  permite_postergacao_upload_canhoto: boolean
  limite_postergacao_upload_canhoto_dias: number | null
  metodo_calculo_financeiro: import('@/lib/operacoes/calculo').MetodoCalculoNovaPolitica | null
  tipo_ativo_financeiro: import('@/lib/duplicatas/types').TipoAtivoFinanceiro
  controle_exposicao_logistica_ativo: boolean
  limite_exposicao_em_transito_pct: number | string | null
  gate_risco_ativo: boolean
  limite_inclusivo: boolean
  tratamento_pl_indisponivel: 'BLOQUEAR'
  tratamento_indeterminada: 'REVISAO_MANUAL'
  tratamento_sem_match: 'BLOQUEAR'
  tratamento_operacao_nao_incorporada: 'BLOQUEAR'
  tratamento_liquidacao_parcial: 'SINALIZAR'
  configuracao: Record<string, unknown>
  regras: Record<string, unknown>
  parametros: Record<string, unknown>
  conteudo_hash: string
  publicada_por: string | null
  publicada_em: string | null
  substituida_em: string | null
  created_at: string
  updated_at: string
}

export type Duplicata = import('@/lib/duplicatas/types').DuplicataRegistro

export type DuplicataVersao = import('@/lib/duplicatas/types').DuplicataVersaoRegistro

export interface DuplicataCorrecao {
  id: string
  duplicata_id: string
  duplicata_versao_id: string
  campo: import('@/lib/duplicatas/types').CampoDuplicata
  valor_original: unknown
  valor_corrigido: unknown
  motivo: string
  corrigido_por: string
  corrigido_em: string
}

export interface DuplicataValidacao {
  id: string
  duplicata_id: string
  duplicata_versao_id: string
  resultado: 'VALIDADA' | 'REJEITADA'
  resultado_confronto: Record<string, unknown>
  observacoes: string | null
  validado_por: string
  validado_em: string
}

export interface PoliticaRequisitoDocumental {
  id: string
  politica_operacional_versao_id: string
  politica_operacional_id: string
  fundo_id: string | null
  cedente_fundo_id: string | null
  codigo: string
  escopo: PoliticaRequisitoEscopo
  tipo_documento_codigo: PoliticaTipoDocumentoCodigo
  documento_tipo_id: string | null
  obrigatorio: boolean
  quantidade_minima: number
  formatos_aceitos: string[]
  nivel_validacao: PoliticaNivelValidacao
  prazo_dias_corridos: number | null
  momento_obrigatorio: string | null
  categoria: string | null
  bloqueia_fluxo: boolean
  observacoes: string | null
  familia_documental: import('@/lib/logistica/evidencias-logisticas').FamiliaDocumentalLogistica | null
  responsavel_upload: PoliticaResponsavel
  responsavel_aprovacao: PoliticaResponsavel
  ordem: number
  ativo: boolean
  created_at: string
}

export interface CedenteFundoPolitica {
  id: string
  cedente_fundo_id: string
  politica_operacional_id: string
  status: CedenteFundoPoliticaStatus
  vigente_desde: string
  vigente_ate: string | null
  atribuido_por: string | null
  motivo: string | null
  created_at: string
  updated_at: string
}

export interface DocumentoTipoRepositorio {
  id: string
  codigo: string
  nome: string
  dominio: string
  cardinalidade: 'por_nf' | 'por_parcela'
  mime_types_aceitos: string[]
  extensoes_aceitas: string[]
  tamanho_max_bytes: number
  permite_multiplas_versoes: boolean
  ativo: boolean
  created_at: string
  updated_at: string
}

export interface NotaFiscalParcela {
  id: string
  nota_fiscal_id: string
  numero_parcela: number
  valor_nominal: number
  data_vencimento: string
  origem: 'xml_nfe' | 'manual'
  status: 'disponivel' | 'em_operacao' | 'liquidada' | 'cancelada'
  created_at: string
  updated_at: string
}

export interface DocumentoRepositorio {
  id: string
  documento_tipo_id: string
  status: RepositorioDocumentoStatus
  criado_por: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

export interface DocumentoVersao {
  id: string
  documento_id: string
  numero_versao: number
  bucket: string
  path: string
  nome_original: string
  mime_type: string
  tamanho_bytes: number
  sha256: string
  status: DocumentoVersaoStatus
  substitui_versao_id: string | null
  enviado_por: string
  enviado_em: string
  created_at: string
  beneficiario_estabelecimento_id: string | null
}

export interface DocumentoVinculo {
  id: string
  documento_id: string
  nota_fiscal_id: string | null
  operacao_id: string | null
  nota_fiscal_entrega_id: string | null
  cte_id: string | null
  estabelecimento_id: string | null
  cedente_id: string
  principal: boolean
  created_at: string
}

export interface DocumentoRequisitoInstancia {
  id: string
  politica_requisito_id: string
  politica_operacional_id: string
  politica_operacional_versao_id: string
  politica_versao: number
  documento_tipo_id: string | null
  tipo_documento_codigo_snapshot: string
  escopo_snapshot: string
  nota_fiscal_id: string | null
  operacao_id: string | null
  nota_fiscal_entrega_id: string | null
  parcela_id: string | null
  cedente_id: string
  status: RequisitoDocumentoStatus
  obrigatorio: boolean
  prazo_limite: string | null
  formatos_aceitos_snapshot: string[]
  nivel_validacao_snapshot: string
  quantidade_minima_snapshot: number
  responsavel_upload_snapshot: string
  responsavel_aprovacao_snapshot: string
  documento_id: string | null
  versao_aprovada_id: string | null
  satisfeito_em: string | null
  created_at: string
  updated_at: string
}

export interface DocumentoAnalise {
  id: string
  documento_versao_id: string
  resultado: DocumentoAnaliseResultado
  analisado_por: string | null
  ator_tipo: AuditoriaAtorTipo
  observacoes: string | null
  dados_estruturados: Record<string, unknown>
  analisado_em: string
  created_at: string
}

export interface EvidenciaLogisticaAntecipada {
  id: string
  nota_fiscal_id: string
  fundo_id: string
  cedente_id: string
  cedente_fundo_id: string
  politica_operacional_versao_id: string
  politica_requisito_id: string
  familia_documental: import('@/lib/logistica/evidencias-logisticas').FamiliaDocumentalLogistica
  documento_id: string
  documento_versao_atual_id: string
  primeiro_upload_em: string
  ultimo_upload_em: string
  criado_por: string
  created_at: string
  updated_at: string
}

export interface EvidenciaLogisticaVersao {
  id: string
  evidencia_logistica_id: string
  documento_id: string
  documento_versao_id: string
  created_at: string
}

export interface OperacaoNfLogisticaMemoria {
  id: string
  operacao_id: string
  nota_fiscal_id: string
  fundo_id: string
  politica_operacional_versao_id: string
  politica_snapshot_hash: string | null
  etapa: 'criacao' | 'aprovacao'
  gate_exigido: boolean
  status_logistico: import('@/lib/logistica/evidencias-logisticas').StatusLogisticoPreCessao
  familia_vencedora: import('@/lib/logistica/evidencias-logisticas').FamiliaDocumentalLogistica | null
  documento_id: string | null
  documento_versao_id: string | null
  documento_analise_id: string | null
  analisado_por: string | null
  analisado_em: string | null
  fundamento: string
  regra_classificacao: string
  versao_resolvedor: number
  memoria: Record<string, unknown>
  created_at: string
}

export interface NotaFiscalEntrega {
  id: string
  operacao_id: string
  nota_fiscal_id: string
  status_entrega: EntregaStatus
  cessao_efetivada_em: string | null
  data_limite_cte: string | null
  data_limite_canhoto: string | null
  data_entrega: string | null
  entrega_confirmada_em: string | null
  motivo_pendencia: string | null
  created_at: string
  updated_at: string
}

export interface EventoEntrega {
  id: string
  nota_fiscal_entrega_id: string
  tipo_evento: EntregaEventoTipo
  status_anterior: string | null
  status_novo: string | null
  ocorrido_em: string
  registrado_por: string | null
  ator_tipo: AuditoriaAtorTipo
  dados: Record<string, unknown>
  created_at: string
}

export interface NotaFiscalEntregaPostergacaoCanhoto {
  id: string
  nota_fiscal_entrega_id: string
  nota_fiscal_id: string
  operacao_id: string
  fundo_id: string
  cedente_id: string
  cedente_fundo_id: string
  politica_operacional_versao_id: string
  politica_snapshot_hash: string
  prazo_original_upload_canhoto: string
  nova_previsao_upload_canhoto: string
  motivo_postergacao: string
  limite_postergacao_dias_aplicado: number
  postergacao_comunicada_em: string
  postergacao_comunicada_por: string
  utilizada: boolean
  created_at: string
}

export interface EventoDominio {
  id: string
  tenant_id: string | null
  fundo_id: string | null
  cedente_id: string | null
  cedente_fundo_id: string | null
  nota_fiscal_id: string | null
  operacao_id: string | null
  tipo_evento: string
  categoria: string
  ator_usuario_id: string | null
  ator_nome_snapshot: string
  ator_perfil_snapshot: string
  origem: string
  descricao: string
  metadata: Record<string, unknown>
  visibilidade: string
  correlation_id: string | null
  origem_evento: string | null
  origem_registro_id: string | null
  created_at: string
}

export interface Cte {
  id: string
  fundo_id: string | null
  cedente_id: string
  cedente_fundo_id: string | null
  chave_cte: string | null
  numero: string | null
  serie: string | null
  data_emissao: string | null
  ambiente: string | null
  modelo: string | null
  tipo_cte: string | null
  tipo_servico: string | null
  modal: string | null
  cfop: string | null
  natureza_operacao: string | null
  protocolo: string | null
  status_autorizacao: string | null
  motivo_status: string | null
  data_autorizacao: string | null
  cnpj_transportadora: string | null
  cnpj_remetente: string | null
  cnpj_destinatario: string | null
  transportadora_razao_social: string | null
  transportadora_ie: string | null
  rntrc: string | null
  remetente_razao_social: string | null
  destinatario_razao_social: string | null
  municipio_origem_codigo: string | null
  municipio_origem_nome: string | null
  uf_origem: string | null
  municipio_destino_codigo: string | null
  municipio_destino_nome: string | null
  uf_destino: string | null
  valor_frete: number | null
  valor_prestacao: number | null
  valor_receber: number | null
  valor_carga: number | null
  produto_predominante: string | null
  categoria_carga: string | null
  quantidade_carga: number | null
  unidade_carga: string | null
  peso_bruto: number | null
  peso_liquido: number | null
  volume_quantidade: number | null
  formato_origem: CteFormato
  nivel_validacao: CteNivelValidacao
  status: CteStatus
  analisado_por: string | null
  analisado_em: string | null
  motivo_rejeicao: string | null
  documento_id: string | null
  documento_versao_atual_id: string | null
  documento_versao_aprovada_id: string | null
  dados_extraidos: Record<string, unknown>
  hash_sha256: string | null
  uploaded_by: string | null
  resultado_validacao: Record<string, unknown>
  created_at: string
  updated_at: string
  tomador_cnpj: string | null
  tomador_classificacao: 'ALLOW' | 'REVISAO_MANUAL' | 'DENY' | null
}

export interface CteNotaFiscal {
  cte_id: string
  nota_fiscal_id: string
  chave_nfe_referenciada: string | null
  status_validacao: 'aprovado' | 'aprovado_com_alertas' | 'rejeitado' | 'validacao_parcial'
  resultado_validacao: Record<string, unknown>
  divergencias: unknown[]
  validado_em: string | null
  created_at: string
  nota_fiscal_remessa_id: string | null
  tipo_vinculo: 'DIRETO_VENDA' | 'VIA_REMESSA'
}

export interface Canhoto {
  id: string
  nota_fiscal_entrega_id: string
  status: CanhotoStatus
  data_assinatura: string | null
  nome_recebedor: string | null
  documento_recebedor: string | null
  possui_assinatura: boolean
  possui_ressalva: boolean
  descricao_ressalva: string | null
  recebido_em: string | null
  analisado_por: string | null
  analisado_em: string | null
  motivo_rejeicao: string | null
  documento_id: string | null
  documento_versao_atual_id: string | null
  documento_versao_aprovada_id: string | null
  created_at: string
  updated_at: string
  nota_fiscal_remessa_id: string | null
}

export interface NotaFiscalRemessa {
  id: string
  nota_fiscal_venda_id: string
  cedente_id: string
  fundo_id: string
  cedente_fundo_id: string
  chave_acesso: string
  numero: string | null
  serie: string | null
  emitente_cnpj: string | null
  emitente_razao_social: string | null
  destinatario_cnpj: string | null
  destinatario_razao_social: string | null
  data_emissao: string | null
  valor_total: number
  quantidade_total: number | null
  itens: unknown[]
  status_validacao: 'VALIDADA' | 'REVISAO_MANUAL' | 'REJEITADA'
  referencia_nf_venda_confirmada: boolean
  motivos_validacao: unknown[]
  aprovacao_documental: 'aguardando_analise' | 'aprovado' | 'rejeitado' | null
  aprovacao_analisado_por: string | null
  aprovacao_analisado_em: string | null
  aprovacao_motivo_rejeicao: string | null
  bucket: string
  path: string
  nome_original: string
  mime_type: string
  tamanho_bytes: number
  sha256: string
  criado_por: string | null
  created_at: string
  updated_at: string
}

export interface NotaFiscalRemessaVersao {
  id: string
  nota_fiscal_remessa_id: string
  numero_versao: number
  bucket: string
  path: string
  nome_original: string
  mime_type: string
  tamanho_bytes: number
  sha256: string
  status_validacao: 'VALIDADA' | 'REVISAO_MANUAL' | 'REJEITADA'
  referencia_nf_venda_confirmada: boolean
  motivos_validacao: unknown[]
  vigente: boolean
  created_at: string
  created_by: string | null
}

export interface TemplateDocumento {
  id: string
  fundo_id: string
  codigo: string
  tipo_documento: TemplateDocumentType
  nome: string
  descricao: string | null
  status: TemplateDocumentStatus
  created_by: string
  created_at: string
  updated_at: string
}

export interface TemplateVersao {
  id: string
  template_id: string
  versao: number
  vigente_desde: string
  vigente_ate: string | null
  conteudo_html: string
  variaveis_schema: Record<string, unknown>
  sha256: string
  status: TemplateVersionStatus
  publicada_por: string | null
  publicada_em: string | null
  created_at: string
}

export interface DocumentoGerado {
  id: string
  operacao_id: string | null
  cedente_id: string
  fundo_id: string
  template_id: string
  template_versao_id: string
  template_versao: number
  template_hash: string
  tipo_documento: TemplateDocumentType
  bucket: string
  storage_path: string
  sha256: string
  status: GeneratedDocumentStatus
  gerado_por: string | null
  gerado_em: string
  created_at: string
}

export interface ConfiguracaoCnab {
  id: string
  fundo_id: string
  codigo: string
  nome: string
  descricao: string | null
  finalidade: string
  status: CnabConfigStatus
  created_by: string
  created_at: string
  updated_at: string
}

export interface ConfiguracaoCnabVersao {
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
  status: CnabConfigVersionStatus
  publicada_por: string | null
  publicada_em: string | null
  created_at: string
}

export interface IntegracaoFundo {
  id: string
  fundo_id: string
  provedor: IntegracaoFundoProvedor
  provider_key: string
  system_name: string
  nome: string
  status: IntegracaoFundoStatus
  created_by: string
  created_at: string
  updated_at: string
}

export interface IntegracaoFundoVersao {
  id: string
  integracao_fundo_id: string
  versao: number
  ambiente: IntegracaoAmbiente
  status: IntegracaoFundoVersaoStatus
  identificador_cliente: string
  codigo_originador: string | null
  endpoint_base: string
  configuracao_nao_sensivel: Record<string, unknown>
  credential_ref: string
  credencial_integracao_id: string | null
  adapter_key: string | null
  secret_name: string | null
  vault_key: string | null
  vigente_desde: string
  vigente_ate: string | null
  publicada_por: string | null
  publicada_em: string | null
  created_at: string
  updated_at: string
}

export interface IntegracaoFundoVersaoCapacidade {
  id: string
  integracao_fundo_versao_id: string
  fundo_id: string
  ambiente: IntegracaoAmbiente
  capability: 'CESSAO_ENVIO' | 'ESTOQUE' | 'AQUISICOES' | 'LIQUIDACOES' | 'CARTEIRA'
  disponivel_desde: string | null
  disponivel_ate: string | null
  created_at: string
}

export interface CredencialIntegracao {
  id: string
  fundo_id: string
  integracao_fundo_id: string
  ambiente: IntegracaoAmbiente
  nome: string
  usuario_criptografado: string
  senha_criptografada: string
  chave_versao: string
  status: 'rascunho' | 'ativa' | 'substituida' | 'revogada'
  criada_por: string
  criada_em: string
  ativada_em: string | null
  revogada_em: string | null
  substituida_por: string | null
  ultimo_uso_em: string | null
  metadados: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface IntegracaoExecucao {
  id: string
  fundo_id: string
  integracao_fundo_versao_id: string
  remessa_cnab_id: string | null
  operacao_id: string | null
  tipo_execucao: IntegracaoExecucaoTipo
  ambiente: IntegracaoAmbiente
  status: IntegracaoExecucaoStatus
  tentativa: number
  idempotency_key: string | null
  request_hash: string | null
  protocolo_externo: string | null
  codigo_resposta: string | null
  mensagem_resumida: string | null
  erro_categoria: string | null
  duracao_ms: number | null
  iniciada_em: string
  finalizada_em: string | null
  created_at: string
}

export interface RetornoIntegracao {
  id: string
  fundo_id: string
  integracao_execucao_id: string
  remessa_cnab_id: string | null
  tipo_retorno: RetornoIntegracaoTipo
  bucket: string
  storage_path: string
  mime_type: string | null
  tamanho_bytes: number
  sha256: string
  resumo_estruturado: Record<string, unknown>
  recebido_em: string
  created_at: string
}

export interface SequenciaRemessa {
  configuracao_cnab_id: string
  data_referencia: string
  proximo_sequencial: number
  updated_at: string
}

export interface RemessaCnab {
  id: string
  fundo_id: string
  configuracao_cnab_id: string
  configuracao_cnab_versao_id: string
  integracao_fundo_versao_id: string | null
  configuracao_versao: number
  configuracao_hash: string
  status: CnabRemessaStatus
  bucket: string
  storage_path: string
  sha256: string
  quantidade_registros: number
  quantidade_titulos: number
  valor_total: number
  nome_arquivo: string
  sequencial: number
  idempotency_key: string
  payload_hash: string
  gerado_por: string | null
  gerado_em: string
  enviado_em: string | null
  retorno_resumido: string | null
  created_at: string
  updated_at: string
}

export interface RemessaCnabOperacao {
  remessa_cnab_id: string
  operacao_id: string
  created_at: string
}

export interface DevedorSolidario {
  id: string
  cedente_id: string
  nome: string
  nacionalidade: string | null
  estado_civil: string | null
  profissao: string | null
  data_nascimento: string | null
  doc_tipo: string | null
  doc_numero: string
  doc_expedidor: string | null
  doc_data: string | null
  cpf: string
  endereco: string | null
  telefone: string | null
  email: string | null
  ordem: number | null
  created_at: string | null
}

export interface NotaFiscal {
  id: string
  cedente_id: string
  estabelecimento_id: string | null
  cedente_fundo_id: string | null
  fundo_id: string | null
  numero_nf: string
  serie: string | null
  chave_acesso: string | null
  data_emissao: string
  data_vencimento: string
  cnpj_emitente: string
  razao_social_emitente: string
  cnpj_destinatario: string
  razao_social_destinatario: string
  valor_bruto: number
  valor_liquido: number | null
  valor_icms: number | null
  valor_iss: number | null
  valor_pis: number | null
  valor_cofins: number | null
  valor_ipi: number | null
  descricao_itens: string | null
  quantidade_total: number | null
  unidade_quantidade: string | null
  itens_estruturados: unknown[] | null
  condicao_pagamento: string | null
  arquivo_url: string | null
  status: NfStatus
  pedido_sap: string | null
  status_sap: string | null
  taxa_desagio: number | null
  valor_antecipado: number | null
  aprovacao_sacado_em: string | null
  aprovada_gestor_em: string | null
  submetida_em: string | null
  submetida_por: string | null
  motivo_ajuste: string | null
  created_at: string
  updated_at: string
}

export interface Operacao {
  id: string
  cedente_id: string
  conta_escrow_id: string | null
  cedente_fundo_id: string | null
  politica_operacional_id: string | null
  politica_operacional_versao_id: string | null
  politica_atribuicao_id: string | null
  politica_versao: number | null
  politica_snapshot: Record<string, unknown> | null
  politica_snapshot_hash: string | null
  contexto_configuracao_status: ContextoConfiguracaoStatus | null
  contexto_capturado_em: string | null
  aceite_sacado_exigido: boolean | null
  aceite_sacado_status: AceiteSacadoStatus | null
  aceite_sacado_em: string | null
  cessao_efetivada_em: string | null
  solicitacao_idempotency_key: string | null
  valor_bruto_total: number
  taxa_desconto: number | null
  prazo_dias: number
  valor_liquido_desembolso: number | null
  metodo_calculo_financeiro: import('@/lib/operacoes/calculo').MetodoCalculoFinanceiro | null
  calculo_data_base: string | null
  calculo_versao_motor: number | null
  calculo_memoria: Record<string, unknown> | null
  data_vencimento: string
  status: OperacaoStatus
  aprovado_por: string | null
  aprovado_em: string | null
  motivo_reprovacao: string | null
  termo_url: string | null
  termo_gerado_em: string | null
  taxa_desagio: number | null
  valor_face_total: number | null
  preco_aquisicao: number | null
  testemunha_1_id: string | null
  testemunha_2_id: string | null
  termo_assinado_url: string | null
  comprovante_pagamento_url: string | null
  notificacao_url: string | null
  notificacao_gerado_em: string | null
  notificacao_assinada_url: string | null
  remessa_url: string | null
  remessa_gerado_em: string | null
  remessa_enviado_em: string | null
  remessa_fromtis_id: string | null
  remessa_fromtis_retorno: string | null
  liquidada_em: string | null
  quitacao_url: string | null
  quitacao_gerado_em: string | null
  quitacao_assinada_url: string | null
  created_at: string
  updated_at: string
}

export interface OperacaoNf {
  operacao_id: string
  nota_fiscal_id: string
}

export interface OperacaoCalculoNf {
  id: string
  operacao_id: string
  nota_fiscal_id: string
  fundo_id: string
  cedente_id: string
  metodo_calculo_financeiro: import('@/lib/operacoes/calculo').MetodoCalculoFinanceiro
  valor_nominal: number
  taxa_mensal: number
  data_base: string
  vencimento_contratual: string
  vencimento_calculo: string
  base_calculo: 30 | 252 | 360 | 365
  calendario: string | null
  dias_corridos_reais: number
  dias_uteis: number | null
  dias_financeiros: number | null
  dias_aplicados: number
  expoente: number
  fator: number
  valor_presente: number
  desconto: number
  regra_arredondamento: string
  versao_motor: number
  created_at: string
}

export interface TaxaCedente {
  id: string
  cedente_id: string
  prazo_min: number
  prazo_max: number
  taxa_percentual: number
  created_at: string
  updated_at: string
}

export interface ConsultorCedente {
  id: string
  consultor_id: string
  cedente_id: string
  comissao_percentual: number
  created_at: string
}

export interface Sacado {
  id: string
  user_id: string
  cnpj: string
  razao_social: string
  email: string | null
  created_at: string
  updated_at: string
}

export interface Testemunha {
  id: string
  nome: string
  cpf: string
  email: string | null
  ativo: boolean
  created_at: string
}

export interface SolicitacaoAlteracaoCedente {
  id: string
  cedente_id: string
  dados_atuais: Record<string, unknown>
  dados_propostos: Record<string, unknown>
  representantes_atuais: unknown[]
  representantes_propostos: unknown[]
  status: SolicitacaoAlteracaoStatus
  motivo_reprovacao: string | null
  solicitado_em: string
  analisado_por: string | null
  analisado_em: string | null
}

export interface CedenteAcesso {
  id: string
  cedente_id: string
  user_id: string
  perfil: CedenteAcessoPerfil
  ativo: boolean
  convidado_por: string | null
  created_at: string
}

export interface LogAuditoria {
  id: string
  usuario_id: string | null
  ator_tipo: AuditoriaAtorTipo
  origem: string
  ator_identificador: string | null
  tipo_evento: string
  entidade_tipo: string
  entidade_id: string | null
  dados_antes: Record<string, unknown> | null
  dados_depois: Record<string, unknown> | null
  ip_origem: string | null
  created_at: string
}

export interface SegurancaEvento {
  id: string
  tipo_evento: string
  usuario_id: string | null
  ator_usuario_id: string | null
  ator_tipo: string
  origem: string
  severidade: string
  entidade_tipo: string | null
  entidade_id: string | null
  ip_hash: string | null
  user_agent_hash: string | null
  dados: Record<string, unknown>
  created_at: string
}

export interface MfaRecoveryCode {
  id: string
  user_id: string
  code_hash: string
  geracao_id: string
  usado_em: string | null
  usado_por: string | null
  invalidado_em: string | null
  created_at: string
}

export interface SessaoElevada {
  user_id: string
  session_id: string
  aal: 'aal2'
  metodo: 'totp' | 'recovery_code' | 'admin_reset'
  factor_id: string | null
  elevada_em: string
  expira_em: string
  revogada_em: string | null
  motivo_revogacao: string | null
  created_at: string
  updated_at: string
}

export interface AutorizacaoAcaoSensivel {
  id: string
  user_id: string
  session_id: string
  action_type: string
  nonce_hash: string
  criada_em: string
  expira_em: string
  consumida_em: string | null
  revogada_em: string | null
}

export interface SegurancaRateLimit {
  key_hash: string
  escopo: string
  tentativas: number
  bloqueado_ate: string | null
  primeira_tentativa_em: string
  ultima_tentativa_em: string
  updated_at: string
}

export interface MfaResetSolicitacao {
  id: string
  usuario_id: string
  solicitante_id: string
  aprovador_id: string | null
  motivo: string
  evidencia: string | null
  status: 'pendente' | 'aprovado' | 'executado' | 'rejeitado' | 'erro'
  fatores_removidos: number
  erro_execucao: string | null
  solicitado_em: string
  aprovado_em: string | null
  executado_em: string | null
  created_at: string
  updated_at: string
}

export interface Notificacao {
  id: string
  usuario_id: string
  titulo: string
  mensagem: string
  tipo: string
  dedupe_key: string | null
  entidade_tipo: string | null
  entidade_id: string | null
  href: string | null
  lida: boolean
  created_at: string
}

export interface ComunicacaoConfiguracao {
  id: string
  fundo_id: string
  pausada: boolean
  criada_por: string
  criada_em: string
  atualizada_em: string
}

export interface ComunicacaoConfiguracaoVersao {
  id: string
  configuracao_id: string
  fundo_id: string
  numero_versao: number
  status: 'rascunho' | 'publicada' | 'inativa'
  logistica_habilitada: boolean
  cte_habilitado: boolean
  comprovante_habilitado: boolean
  financeiro_habilitado: boolean
  regua_logistica: Record<string, unknown>
  regua_financeira: Record<string, unknown>
  somente_dias_uteis: boolean
  horario_envio: string
  timezone: string
  ativada_em: string | null
  publicada_em: string | null
  publicada_por: string | null
  criada_por: string
  criada_em: string
  atualizada_em: string
}

export interface ComunicacaoTemplateVersao {
  id: string
  configuracao_versao_id: string
  fundo_id: string
  categoria: string
  modo: 'padrao' | 'personalizado'
  assunto: string | null
  corpo_html: string | null
  corpo_texto: string | null
  conteudo_hash: string
  criada_por: string
  criada_em: string
}

export interface ComunicacaoExecucao {
  id: string
  data_referencia: string
  modo: 'producao' | 'controlado'
  status: 'PROCESSANDO' | 'CONCLUIDA' | 'FALHA'
  encontrada: number
  agrupada: number
  enviada: number
  falha: number
  bloqueada: number
  iniciada_em: string
  finalizada_em: string | null
  erro_sanitizado: string | null
}

export interface Comunicacao {
  id: string
  fundo_id: string
  configuracao_versao_id: string
  template_versao_id: string
  execucao_id: string | null
  familia: 'LOGISTICA' | 'FINANCEIRO'
  categoria: string
  status: 'PENDENTE' | 'PROCESSANDO' | 'ENVIADA' | 'FALHA' | 'BLOQUEADA' | 'CANCELADA'
  remetente_nome: string
  destinatario_nome: string
  destinatario_email: string | null
  destinatario_hash: string | null
  copias: unknown[]
  assunto: string
  corpo_html: string
  corpo_texto: string
  conteudo_hash: string
  message_id: string
  idempotency_key: string
  data_efetiva: string
  bloqueio_motivo: string | null
  provider_id: string | null
  criada_em: string
  enviada_em: string | null
  atualizada_em: string
}

export interface ComunicacaoItem {
  id: string
  comunicacao_id: string
  fundo_id: string
  familia: 'LOGISTICA' | 'FINANCEIRO'
  item_key: string
  entidade_tipo: string
  entidade_id: string | null
  nota_fiscal_id: string | null
  operacao_id: string | null
  etapa: string
  data_obrigacao: string
  data_nominal: string
  data_efetiva: string
  motivo_ajuste: string | null
  snapshot: Record<string, unknown>
  criada_em: string
}

export interface ComunicacaoItemEstagio {
  id: string
  fundo_id: string
  familia: 'LOGISTICA' | 'FINANCEIRO'
  item_key: string
  etapa: string
  data_obrigacao: string
  data_nominal: string
  data_efetiva: string
  motivo_ajuste: string | null
  status: 'PENDENTE' | 'COMUNICADO' | 'NAO_APLICAVEL' | 'CANCELADO'
  comunicacao_id: string | null
  rejeicao_versao_id: string | null
  criada_em: string
  comunicada_em: string | null
}

export interface ComunicacaoTentativa {
  id: string
  comunicacao_id: string
  numero_tentativa: number
  status: 'PROCESSANDO' | 'ENVIADA' | 'FALHA'
  provider: string
  provider_id: string | null
  erro_codigo: string | null
  erro_sanitizado: string | null
  iniciada_em: string
  finalizada_em: string | null
}

export interface ImportacaoFinanceira {
  id: string
  fundo_id: string
  provedor: string
  tipo_base: 'CARTEIRA' | 'ESTOQUE' | 'AQUISICOES' | 'LIQUIDACOES'
  data_referencia: string
  layout_nome: string
  versao_layout: string
  status: 'RECEBIDA' | 'VALIDANDO' | 'VALIDA' | 'PUBLICADA' | 'FALHA' | 'RETIFICADA' | 'CANCELADA'
  completude: 'COMPLETO_COM_DADOS' | 'COMPLETO_VAZIO' | 'INCOMPLETO'
  origem: 'MANUAL' | 'CRON' | 'GOLDEN_DATASET'
  integracao_fundo_versao_id: string | null
  hash_conteudo: string
  nome_arquivo: string | null
  mime_type: string | null
  tamanho_bytes: number
  storage_bucket: string | null
  storage_path: string | null
  encoding_detectado: string
  linhas_total: number
  linhas_validas: number
  linhas_invalidas: number
  linhas_warning: number
  linhas_publicadas: number
  valor_total: number | string | null
  erros: unknown[]
  metadados: Record<string, unknown>
  correlation_id: string
  criado_por: string | null
  recebida_em: string
  validacao_iniciada_em: string | null
  validacao_concluida_em: string | null
  publicada_em: string | null
  substituida_em: string | null
  cancelada_em: string | null
  substitui_importacao_id: string | null
  finalizada_em: string | null
  erro_sanitizado: string | null
  declaracao_sem_movimento: boolean
  created_at: string
  updated_at: string
}

export interface ImportacaoArquivo {
  id: string
  importacao_id: string
  fundo_id: string
  ordem: number
  nome_arquivo: string
  mime_type: string
  tamanho_bytes: number
  hash_conteudo: string
  storage_bucket: string
  storage_path: string
  criado_em: string
}

export interface ImportacaoLinha {
  id: string
  importacao_id: string
  fundo_id: string
  numero_linha: number
  status: 'VALIDA' | 'INVALIDA' | 'WARNING'
  dados_brutos: Record<string, unknown>
  dados_normalizados: Record<string, unknown>
  erros: string[]
  avisos: string[]
  criada_em: string
}

export interface ImportacaoCiclo {
  id: string
  fundo_id: string
  data_operacional: string
  origem: 'CRON' | 'MANUAL' | 'GOLDEN_DATASET'
  status: 'INICIADO' | 'CONCLUIDO' | 'PARCIAL' | 'FALHA'
  tentativas: number
  processadas: number
  falhas: number
  detalhes: Record<string, unknown>
  correlation_id: string
  iniciada_em: string
  concluida_em: string | null
}

export interface MatchingExecucao {
  id: string
  fundo_id: string
  data_referencia: string
  regra_versao: string
  input_import_ids: string[]
  assinatura_execucao: string
  status: 'PROCESSANDO' | 'CONCLUIDA' | 'FALHA'
  total_registros: number
  matched: number
  ambiguos: number
  nao_conciliados: number
  conflitos: number
  valor_total: number | string
  valor_matched: number | string
  valor_ambiguo: number | string
  valor_nao_conciliado: number | string
  detalhes: Record<string, unknown>
  iniciado_em: string
  finalizado_em: string | null
  correlation_id: string
  criado_por: string | null
  created_at: string
}

export interface TituloNfVinculo {
  id: string
  fundo_id: string
  provedor: string
  identidade_externa: string
  nota_fiscal_id: string
  status: 'ATIVO' | 'REVOGADO'
  origem: 'AUTOMATICO' | 'MANUAL'
  metodo: 'CHAVE_NFE' | 'SEU_NUMERO' | 'COMPOSTO' | 'ID_RECEBIVEL' | 'MANUAL'
  regra_versao: string
  evidencias: Record<string, unknown>
  candidate_count: number
  criado_em: string
  criado_por: string | null
  confirmado_em: string | null
  confirmado_por: string | null
  revogado_em: string | null
  revogado_por: string | null
  motivo_revogacao: string | null
  correlation_id: string
}

export interface TituloNfVinculoChave {
  id: string
  vinculo_id: string
  fundo_id: string
  provedor: string
  tipo_chave: 'CHAVE_NFE' | 'ID_RECEBIVEL' | 'SEU_NUMERO' | 'EXTERNAL_TITLE_KEY' | 'DOCUMENTO' | 'NOSSO_NUMERO'
  valor_normalizado: string
  fonte: string
  criado_em: string
}

export interface MatchingResultado {
  id: string
  execucao_id: string
  fundo_id: string
  provedor: string
  origem_registro: 'ESTOQUE' | 'AQUISICAO' | 'LIQUIDACAO'
  origem_registro_id: string
  identidade_externa: string
  id_recebivel: string | null
  seu_numero: string | null
  chave_nfe: string | null
  numero_documento: string | null
  cedente_documento: string | null
  cedente_nome: string | null
  sacado_documento: string | null
  sacado_nome: string | null
  data_vencimento: string | null
  valor_referencia: number | string | null
  tipo_recebivel: string | null
  status: 'MATCH_FORTE' | 'AMBIGUO' | 'NAO_CONCILIADO' | 'CONFLITO'
  metodo: 'CHAVE_NFE' | 'SEU_NUMERO' | 'COMPOSTO' | 'ID_RECEBIVEL' | 'AMBIGUO' | 'NAO_CONCILIADO' | 'CONFLITO'
  nota_fiscal_id: string | null
  vinculo_id: string | null
  candidate_count: number
  evidencias: Record<string, unknown>
  criado_em: string
}

export interface MatchingCandidato {
  id: string
  matching_resultado_id: string
  fundo_id: string
  nota_fiscal_id: string
  ordem: number
  metodo: string
  evidencias: Record<string, unknown>
  criado_em: string
}

export interface ConciliacaoExecucao {
  id: string
  fundo_id: string
  data_referencia: string
  regra_versao: string
  estoque_d2_importacao_id: string | null
  estoque_d1_importacao_id: string | null
  aquisicoes_d1_importacao_id: string | null
  liquidacoes_d1_importacao_id: string | null
  matching_execucao_id: string | null
  assinatura_execucao: string
  status: 'PROCESSANDO' | 'CONCLUIDA' | 'BASE_INCOMPLETA' | 'FALHA'
  contagens: Record<string, number>
  valores_agregados: Record<string, string | number>
  detalhes: Record<string, unknown>
  iniciado_em: string
  finalizado_em: string | null
  correlation_id: string
  criado_por: string | null
  created_at: string
}

export interface ConciliacaoResultado {
  id: string
  execucao_id: string
  fundo_id: string
  identidade_externa: string
  provedor: string
  vinculo_id: string | null
  nota_fiscal_id: string | null
  presente_d2: boolean
  presente_d1: boolean
  valor_aquisicao_d2: number | string | null
  valor_aquisicao_d1: number | string | null
  aquisicoes_count: number
  aquisicoes_valor: number | string
  liquidacoes_count: number
  liquidacoes_valor_pago: number | string
  status: string
  detalhes: Record<string, unknown>
  criado_em: string
}

export interface PosicaoLogisticaExecucao {
  id: string
  fundo_id: string
  data_referencia: string
  estoque_importacao_id: string
  matching_execucao_id: string
  regra_versao: 'RLX_LOGISTICA_V1'
  logistica_as_of: string
  fingerprint_logistico: string
  assinatura_execucao: string
  status: 'PROCESSANDO' | 'CONCLUIDA' | 'BASE_INCOMPLETA' | 'FALHA'
  total_posicoes: number
  posicoes_matched: number
  posicoes_sem_match: number
  posicoes_entregues: number
  posicoes_em_transito: number
  posicoes_indeterminadas: number
  posicoes_valor_ausente: number
  valor_total_aquisicao: number | string | null
  valor_matched: number | string | null
  valor_sem_match: number | string | null
  valor_entregue: number | string | null
  valor_em_transito: number | string | null
  valor_indeterminado: number | string | null
  detalhes: Record<string, unknown>
  correlation_id: string
  criado_por: string | null
  iniciado_em: string
  finalizado_em: string | null
  created_at: string
}

export interface PosicaoLogisticaResultado {
  id: string
  execucao_id: string
  fundo_id: string
  estoque_importacao_id: string
  estoque_posicao_id: string
  matching_resultado_id: string
  matching_status: MatchingResultado['status']
  matching_metodo: string
  status_vinculo: 'MATCHED_FINANCEIRO_NF' | 'SEM_MATCH_FINANCEIRO_NF'
  vinculo_id: string | null
  nota_fiscal_id: string | null
  status_logistico: 'ENTREGUE' | 'EM_TRANSITO' | 'INDETERMINADA' | null
  id_recebivel: string | null
  seu_numero: string | null
  numero_documento: string | null
  cedente_nome: string | null
  cedente_documento: string | null
  sacado_nome: string | null
  sacado_documento: string | null
  data_vencimento: string | null
  valor_nominal: number | string | null
  valor_aquisicao: number | string | null
  valor_aquisicao_qualidade: 'PRESENTE' | 'AUSENTE'
  nf_compartilhada_entre_posicoes: boolean
  evidencia_familia: 'cte' | 'comprovante_entrega' | null
  documento_id: string | null
  documento_versao_id: string | null
  documento_analise_id: string | null
  fundamento: string
  evidencias: Record<string, unknown>
  detalhes: Record<string, unknown>
  criado_em: string
}

export interface ExposicaoExecucao {
  id: string
  fundo_id: string
  data_operacional: string
  data_referencia_estoque: string
  data_referencia_pl: string
  posicao_logistica_execucao_id: string | null
  carteira_importacao_id: string | null
  carteira_snapshot_id: string | null
  politica_operacional_versao_id: string | null
  logistica_as_of: string | null
  overlay_as_of: string
  regra_versao: 'RLX_EXPOSICAO_V1'
  limite_referencia_pct: number | string | null
  assinatura_execucao: string
  status: import('@/lib/financeiro/exposicao/types').ExposureExecutionStatus
  quantidade_posicao: number
  quantidade_entregue: number
  quantidade_em_transito_estoque: number
  quantidade_indeterminada: number
  quantidade_sem_match: number
  quantidade_valor_aquisicao_ausente: number
  quantidade_overlay: number
  quantidade_ja_incorporada: number
  quantidade_nao_incorporada: number
  valor_posicao_total: number | string | null
  valor_entregue: number | string | null
  valor_em_transito_estoque: number | string | null
  valor_indeterminado: number | string | null
  valor_sem_match: number | string | null
  overlay_total: number | string | null
  overlay_em_transito: number | string | null
  overlay_entregue: number | string | null
  overlay_indeterminado: number | string | null
  operacoes_ja_incorporadas_valor: number | string | null
  operacoes_nao_incorporadas_valor: number | string | null
  exposicao_em_transito_total: number | string | null
  patrimonio_liquido_d2: number | string | null
  percentual_exposicao: number | string | null
  classificacao_limite: import('@/lib/financeiro/exposicao/types').ExposureLimitClassification | null
  flags_qualidade: import('@/lib/financeiro/exposicao/types').ExposureQualityFlag[]
  detalhes: Record<string, unknown>
  correlation_id: string
  criado_por: string | null
  iniciado_em: string
  finalizado_em: string
  created_at: string
}

export interface ExposicaoOverlayItem {
  id: string
  execucao_id: string
  fundo_id: string
  operacao_id: string
  nota_fiscal_id: string
  operacao_economica_em: string
  valor_aquisicao: number | string | null
  status_logistico: 'ENTREGUE' | 'EM_TRANSITO' | 'INDETERMINADA'
  ja_incorporado_estoque: boolean
  incluido_no_numerador: boolean
  motivo: import('@/lib/financeiro/exposicao/types').ExposureOverlayReason
  evidencias: Record<string, unknown>
  created_at: string
}

export interface RiscoExecucao {
  id: string
  fundo_id: string
  operacao_id: string | null
  escopo: 'FUNDO' | 'OPERACAO'
  origem: 'CENTRAL_RISCO' | 'APROVACAO_OPERACAO'
  regra_versao: 'GATE_RISCO_V1'
  politica_operacional_versao_id: string | null
  exposicao_execucao_id: string | null
  data_operacional: string
  logistica_as_of: string | null
  overlay_as_of: string
  operacao_updated_at_snapshot: string | null
  taxa_desconto_snapshot: number | string | null
  aplicavel: boolean
  status_tecnico: import('@/lib/financeiro/risco/types').RiskTechnicalStatus
  decisao: import('@/lib/financeiro/risco/types').RiskDecision | null
  limite_pct: number | string | null
  limite_inclusivo: true
  patrimonio_liquido_d2: number | string | null
  exposicao_atual_valor: number | string | null
  exposicao_atual_pct: number | string | null
  operacao_valor_aquisicao: number | string | null
  operacao_valor_em_transito: number | string | null
  operacao_valor_indeterminado: number | string | null
  exposicao_projetada_valor: number | string | null
  exposicao_projetada_pct: number | string | null
  quantidade_indeterminada: number
  quantidade_sem_match: number
  quantidade_valor_aquisicao_ausente: number
  quantidade_operacao_nao_incorporada: number
  liquidacao_parcial_presente: boolean
  assinatura_inputs: string
  detalhes: Record<string, unknown>
  correlation_id: string
  criado_por: string | null
  iniciado_em: string
  finalizado_em: string
  created_at: string
}

export interface RiscoMotivo {
  id: string
  risco_execucao_id: string
  fundo_id: string
  codigo: import('@/lib/financeiro/risco/types').RiskReasonCode
  severidade: import('@/lib/financeiro/risco/types').RiskReasonSeverity
  valor_numerico: number | string | null
  valor_monetario: number | string | null
  quantidade: number | null
  detalhes: Record<string, unknown>
  created_at: string
}

export interface RiscoRevisao {
  id: string
  risco_execucao_id: string
  fundo_id: string
  operacao_id: string
  status: 'PENDENTE' | 'LIBERADA' | 'RECUSADA' | 'EXPIRADA'
  assinatura_inputs: string
  justificativa: string | null
  revisado_por: string | null
  revisado_em: string | null
  created_at: string
  updated_at: string
}

export interface Database {
  public: {
    Tables: {
      comunicacao_configuracoes: { Row: ComunicacaoConfiguracao & Record<string, unknown>; Insert: InsertShape<ComunicacaoConfiguracao, 'fundo_id' | 'criada_por'> & Record<string, unknown>; Update: UpdateShape<ComunicacaoConfiguracao> & Record<string, unknown>; Relationships: [] }
      comunicacao_configuracao_versoes: { Row: ComunicacaoConfiguracaoVersao & Record<string, unknown>; Insert: InsertShape<ComunicacaoConfiguracaoVersao, 'configuracao_id' | 'fundo_id' | 'numero_versao' | 'criada_por'> & Record<string, unknown>; Update: UpdateShape<ComunicacaoConfiguracaoVersao> & Record<string, unknown>; Relationships: [] }
      comunicacao_template_versoes: { Row: ComunicacaoTemplateVersao & Record<string, unknown>; Insert: InsertShape<ComunicacaoTemplateVersao, 'configuracao_versao_id' | 'fundo_id' | 'categoria' | 'conteudo_hash' | 'criada_por'> & Record<string, unknown>; Update: UpdateShape<ComunicacaoTemplateVersao> & Record<string, unknown>; Relationships: [] }
      comunicacao_execucoes: { Row: ComunicacaoExecucao & Record<string, unknown>; Insert: InsertShape<ComunicacaoExecucao, 'data_referencia'> & Record<string, unknown>; Update: UpdateShape<ComunicacaoExecucao> & Record<string, unknown>; Relationships: [] }
      comunicacoes: { Row: Comunicacao & Record<string, unknown>; Insert: InsertShape<Comunicacao, 'fundo_id' | 'configuracao_versao_id' | 'template_versao_id' | 'familia' | 'categoria' | 'destinatario_nome' | 'assunto' | 'corpo_html' | 'corpo_texto' | 'conteudo_hash' | 'message_id' | 'idempotency_key' | 'data_efetiva'> & Record<string, unknown>; Update: UpdateShape<Comunicacao> & Record<string, unknown>; Relationships: [] }
      comunicacao_itens: { Row: ComunicacaoItem & Record<string, unknown>; Insert: InsertShape<ComunicacaoItem, 'comunicacao_id' | 'fundo_id' | 'familia' | 'item_key' | 'entidade_tipo' | 'etapa' | 'data_obrigacao' | 'data_nominal' | 'data_efetiva'> & Record<string, unknown>; Update: UpdateShape<ComunicacaoItem> & Record<string, unknown>; Relationships: [] }
      comunicacao_item_estagios: { Row: ComunicacaoItemEstagio & Record<string, unknown>; Insert: InsertShape<ComunicacaoItemEstagio, 'fundo_id' | 'familia' | 'item_key' | 'etapa' | 'data_obrigacao' | 'data_nominal' | 'data_efetiva'> & Record<string, unknown>; Update: UpdateShape<ComunicacaoItemEstagio> & Record<string, unknown>; Relationships: [] }
      comunicacao_tentativas: { Row: ComunicacaoTentativa & Record<string, unknown>; Insert: InsertShape<ComunicacaoTentativa, 'comunicacao_id' | 'numero_tentativa' | 'status'> & Record<string, unknown>; Update: UpdateShape<ComunicacaoTentativa> & Record<string, unknown>; Relationships: [] }
      profiles: { Row: Profile & Record<string, unknown>; Insert: InsertShape<Profile, 'id' | 'nome_completo' | 'email'> & Record<string, unknown>; Update: UpdateShape<Profile> & Record<string, unknown>; Relationships: [] }
      usuario_papeis: { Row: UsuarioPapel & Record<string, unknown>; Insert: InsertShape<UsuarioPapel, 'usuario_id' | 'papel'> & Record<string, unknown>; Update: UpdateShape<UsuarioPapel> & Record<string, unknown>; Relationships: [] }
      usuario_fundos: { Row: UsuarioFundo & Record<string, unknown>; Insert: InsertShape<UsuarioFundo, 'usuario_id' | 'fundo_id'> & Record<string, unknown>; Update: UpdateShape<UsuarioFundo> & Record<string, unknown>; Relationships: [] }
      plataforma_auditoria: { Row: PlataformaAuditoria & Record<string, unknown>; Insert: InsertShape<PlataformaAuditoria, 'tipo_evento' | 'origem'> & Record<string, unknown>; Update: UpdateShape<PlataformaAuditoria> & Record<string, unknown>; Relationships: [] }
      cedentes: { Row: Cedente & Record<string, unknown>; Insert: InsertShape<Cedente, 'user_id' | 'cnpj' | 'razao_social'> & Record<string, unknown>; Update: UpdateShape<Cedente> & Record<string, unknown>; Relationships: [] }
      cedente_estabelecimentos: { Row: CedenteEstabelecimento & Record<string, unknown>; Insert: InsertShape<CedenteEstabelecimento, 'cedente_id' | 'cnpj' | 'razao_social' | 'tipo'> & Record<string, unknown>; Update: UpdateShape<CedenteEstabelecimento> & Record<string, unknown>; Relationships: [] }
      cedente_estabelecimento_contas_bancarias: { Row: CedenteEstabelecimentoContaBancaria & Record<string, unknown>; Insert: InsertShape<CedenteEstabelecimentoContaBancaria, 'estabelecimento_id' | 'banco' | 'agencia' | 'conta' | 'tipo_conta'> & Record<string, unknown>; Update: UpdateShape<CedenteEstabelecimentoContaBancaria> & Record<string, unknown>; Relationships: [] }
      cedente_estabelecimento_requisitos: { Row: CedenteEstabelecimentoRequisito & Record<string, unknown>; Insert: InsertShape<CedenteEstabelecimentoRequisito, 'estabelecimento_id' | 'documento_tipo_id'> & Record<string, unknown>; Update: UpdateShape<CedenteEstabelecimentoRequisito> & Record<string, unknown>; Relationships: [] }
      documento_tipos: { Row: DocumentoTipoRepositorio & Record<string, unknown>; Insert: InsertShape<DocumentoTipoRepositorio, 'codigo' | 'nome' | 'dominio'> & Record<string, unknown>; Update: UpdateShape<DocumentoTipoRepositorio> & Record<string, unknown>; Relationships: [] }
      documentos_repositorio: { Row: DocumentoRepositorio & Record<string, unknown>; Insert: InsertShape<DocumentoRepositorio, 'documento_tipo_id' | 'criado_por'> & Record<string, unknown>; Update: UpdateShape<DocumentoRepositorio> & Record<string, unknown>; Relationships: [] }
      documento_versoes: { Row: DocumentoVersao & Record<string, unknown>; Insert: InsertShape<DocumentoVersao, 'documento_id' | 'nome_original' | 'mime_type' | 'tamanho_bytes' | 'sha256' | 'enviado_por'> & Record<string, unknown>; Update: UpdateShape<DocumentoVersao> & Record<string, unknown>; Relationships: [] }
      documento_vinculos: { Row: DocumentoVinculo & Record<string, unknown>; Insert: InsertShape<DocumentoVinculo, 'documento_id' | 'cedente_id'> & Record<string, unknown>; Update: UpdateShape<DocumentoVinculo> & Record<string, unknown>; Relationships: [] }
      documento_requisito_instancias: { Row: DocumentoRequisitoInstancia & Record<string, unknown>; Insert: InsertShape<DocumentoRequisitoInstancia, 'politica_requisito_id' | 'politica_operacional_id' | 'politica_operacional_versao_id' | 'politica_versao' | 'tipo_documento_codigo_snapshot' | 'escopo_snapshot' | 'cedente_id' | 'obrigatorio' | 'nivel_validacao_snapshot' | 'quantidade_minima_snapshot' | 'responsavel_upload_snapshot' | 'responsavel_aprovacao_snapshot'> & Record<string, unknown>; Update: UpdateShape<DocumentoRequisitoInstancia> & Record<string, unknown>; Relationships: [] }
      cedente_fundo_politicas: { Row: CedenteFundoPolitica & Record<string, unknown>; Insert: InsertShape<CedenteFundoPolitica, 'cedente_fundo_id' | 'politica_operacional_id'> & Record<string, unknown>; Update: UpdateShape<CedenteFundoPolitica> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'cedente_fundo_politicas_cedente_fundo_id_fkey'; columns: ['cedente_fundo_id']; isOneToOne: false; referencedRelation: 'cedente_fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'cedente_fundo_politicas_politica_operacional_id_fkey'; columns: ['politica_operacional_id']; isOneToOne: false; referencedRelation: 'politicas_operacionais'; referencedColumns: ['id'] }] }
      documento_analises: { Row: DocumentoAnalise & Record<string, unknown>; Insert: InsertShape<DocumentoAnalise, 'documento_versao_id' | 'resultado'> & Record<string, unknown>; Update: UpdateShape<DocumentoAnalise> & Record<string, unknown>; Relationships: [] }
      evidencias_logisticas_antecipadas: { Row: EvidenciaLogisticaAntecipada & Record<string, unknown>; Insert: InsertShape<EvidenciaLogisticaAntecipada, 'nota_fiscal_id' | 'fundo_id' | 'cedente_id' | 'cedente_fundo_id' | 'politica_operacional_versao_id' | 'politica_requisito_id' | 'familia_documental' | 'documento_id' | 'documento_versao_atual_id' | 'criado_por'> & Record<string, unknown>; Update: UpdateShape<EvidenciaLogisticaAntecipada> & Record<string, unknown>; Relationships: [] }
      evidencia_logistica_versoes: { Row: EvidenciaLogisticaVersao & Record<string, unknown>; Insert: InsertShape<EvidenciaLogisticaVersao, 'evidencia_logistica_id' | 'documento_id' | 'documento_versao_id'> & Record<string, unknown>; Update: UpdateShape<EvidenciaLogisticaVersao> & Record<string, unknown>; Relationships: [] }
      operacao_nf_logistica_memorias: { Row: OperacaoNfLogisticaMemoria & Record<string, unknown>; Insert: InsertShape<OperacaoNfLogisticaMemoria, 'operacao_id' | 'nota_fiscal_id' | 'fundo_id' | 'politica_operacional_versao_id' | 'etapa' | 'gate_exigido' | 'status_logistico' | 'fundamento' | 'regra_classificacao' | 'versao_resolvedor'> & Record<string, unknown>; Update: UpdateShape<OperacaoNfLogisticaMemoria> & Record<string, unknown>; Relationships: [] }
      nota_fiscal_entregas: { Row: NotaFiscalEntrega & Record<string, unknown>; Insert: InsertShape<NotaFiscalEntrega, 'operacao_id' | 'nota_fiscal_id' | 'status_entrega'> & Record<string, unknown>; Update: UpdateShape<NotaFiscalEntrega> & Record<string, unknown>; Relationships: [] }
      nota_fiscal_entrega_postergacoes_canhoto: { Row: NotaFiscalEntregaPostergacaoCanhoto & Record<string, unknown>; Insert: InsertShape<NotaFiscalEntregaPostergacaoCanhoto, 'nota_fiscal_entrega_id' | 'nota_fiscal_id' | 'operacao_id' | 'fundo_id' | 'cedente_id' | 'cedente_fundo_id' | 'politica_operacional_versao_id' | 'politica_snapshot_hash' | 'prazo_original_upload_canhoto' | 'nova_previsao_upload_canhoto' | 'motivo_postergacao' | 'limite_postergacao_dias_aplicado' | 'postergacao_comunicada_por'> & Record<string, unknown>; Update: UpdateShape<NotaFiscalEntregaPostergacaoCanhoto> & Record<string, unknown>; Relationships: [] }
      eventos_entrega: { Row: EventoEntrega & Record<string, unknown>; Insert: InsertShape<EventoEntrega, 'nota_fiscal_entrega_id' | 'tipo_evento'> & Record<string, unknown>; Update: UpdateShape<EventoEntrega> & Record<string, unknown>; Relationships: [] }
      eventos_dominio: { Row: EventoDominio & Record<string, unknown>; Insert: InsertShape<EventoDominio, 'tipo_evento' | 'categoria' | 'descricao'> & Record<string, unknown>; Update: UpdateShape<EventoDominio> & Record<string, unknown>; Relationships: [] }
      ctes: { Row: Cte & Record<string, unknown>; Insert: InsertShape<Cte, 'cedente_id' | 'formato_origem' | 'nivel_validacao'> & Record<string, unknown>; Update: UpdateShape<Cte> & Record<string, unknown>; Relationships: [] }
      cte_notas_fiscais: { Row: CteNotaFiscal & Record<string, unknown>; Insert: InsertShape<CteNotaFiscal, 'cte_id' | 'nota_fiscal_id'> & Record<string, unknown>; Update: Partial<CteNotaFiscal> & Record<string, unknown>; Relationships: [] }
      canhotos: { Row: Canhoto & Record<string, unknown>; Insert: InsertShape<Canhoto, 'nota_fiscal_entrega_id'> & Record<string, unknown>; Update: UpdateShape<Canhoto> & Record<string, unknown>; Relationships: [] }
      nota_fiscal_remessas: { Row: NotaFiscalRemessa & Record<string, unknown>; Insert: InsertShape<NotaFiscalRemessa, 'nota_fiscal_venda_id' | 'cedente_id' | 'fundo_id' | 'cedente_fundo_id' | 'chave_acesso' | 'status_validacao' | 'bucket' | 'path' | 'nome_original' | 'mime_type' | 'tamanho_bytes' | 'sha256'> & Record<string, unknown>; Update: UpdateShape<NotaFiscalRemessa> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'nota_fiscal_remessas_nota_fiscal_venda_id_fkey'; columns: ['nota_fiscal_venda_id']; isOneToOne: false; referencedRelation: 'notas_fiscais'; referencedColumns: ['id'] }] }
      nota_fiscal_remessa_versoes: { Row: NotaFiscalRemessaVersao & Record<string, unknown>; Insert: InsertShape<NotaFiscalRemessaVersao, 'nota_fiscal_remessa_id' | 'numero_versao' | 'bucket' | 'path' | 'nome_original' | 'mime_type' | 'tamanho_bytes' | 'sha256' | 'status_validacao'> & Record<string, unknown>; Update: UpdateShape<NotaFiscalRemessaVersao> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'nota_fiscal_remessa_versoes_nota_fiscal_remessa_id_fkey'; columns: ['nota_fiscal_remessa_id']; isOneToOne: false; referencedRelation: 'nota_fiscal_remessas'; referencedColumns: ['id'] }] }
      templates_documentos: { Row: TemplateDocumento & Record<string, unknown>; Insert: InsertShape<TemplateDocumento, 'fundo_id' | 'codigo' | 'tipo_documento' | 'nome' | 'created_by'> & Record<string, unknown>; Update: UpdateShape<TemplateDocumento> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'templates_documentos_fundo_id_fkey'; columns: ['fundo_id']; isOneToOne: false; referencedRelation: 'fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'templates_documentos_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      template_versoes: { Row: TemplateVersao & Record<string, unknown>; Insert: InsertShape<TemplateVersao, 'template_id' | 'versao' | 'vigente_desde' | 'conteudo_html' | 'sha256'> & Record<string, unknown>; Update: UpdateShape<TemplateVersao> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'template_versoes_template_id_fkey'; columns: ['template_id']; isOneToOne: false; referencedRelation: 'templates_documentos'; referencedColumns: ['id'] }, { foreignKeyName: 'template_versoes_publicada_por_fkey'; columns: ['publicada_por']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      documentos_gerados: { Row: DocumentoGerado & Record<string, unknown>; Insert: InsertShape<DocumentoGerado, 'operacao_id' | 'cedente_id' | 'fundo_id' | 'template_id' | 'template_versao_id' | 'template_versao' | 'template_hash' | 'tipo_documento' | 'storage_path' | 'sha256'> & Record<string, unknown>; Update: UpdateShape<DocumentoGerado> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'documentos_gerados_operacao_id_fkey'; columns: ['operacao_id']; isOneToOne: false; referencedRelation: 'operacoes'; referencedColumns: ['id'] }, { foreignKeyName: 'documentos_gerados_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }, { foreignKeyName: 'documentos_gerados_fundo_id_fkey'; columns: ['fundo_id']; isOneToOne: false; referencedRelation: 'fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'documentos_gerados_template_id_fkey'; columns: ['template_id']; isOneToOne: false; referencedRelation: 'templates_documentos'; referencedColumns: ['id'] }, { foreignKeyName: 'documentos_gerados_template_versao_id_fkey'; columns: ['template_versao_id']; isOneToOne: false; referencedRelation: 'template_versoes'; referencedColumns: ['id'] }] }
      configuracoes_cnab: { Row: ConfiguracaoCnab & Record<string, unknown>; Insert: InsertShape<ConfiguracaoCnab, 'fundo_id' | 'codigo' | 'nome' | 'created_by'> & Record<string, unknown>; Update: UpdateShape<ConfiguracaoCnab> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'configuracoes_cnab_fundo_id_fkey'; columns: ['fundo_id']; isOneToOne: false; referencedRelation: 'fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'configuracoes_cnab_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      configuracao_cnab_versoes: { Row: ConfiguracaoCnabVersao & Record<string, unknown>; Insert: InsertShape<ConfiguracaoCnabVersao, 'configuracao_cnab_id' | 'versao' | 'vigente_desde' | 'layout' | 'versao_layout' | 'codigo_banco' | 'banco' | 'agencia' | 'conta' | 'digito_conta' | 'carteira' | 'convenio' | 'codigo_originador' | 'codigo_empresa' | 'tipo_inscricao' | 'numero_inscricao' | 'especie_titulo' | 'tipo_recebivel' | 'conteudo_hash'> & Record<string, unknown>; Update: UpdateShape<ConfiguracaoCnabVersao> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'configuracao_cnab_versoes_configuracao_cnab_id_fkey'; columns: ['configuracao_cnab_id']; isOneToOne: false; referencedRelation: 'configuracoes_cnab'; referencedColumns: ['id'] }, { foreignKeyName: 'configuracao_cnab_versoes_publicada_por_fkey'; columns: ['publicada_por']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      integracoes_fundo: { Row: IntegracaoFundo & Record<string, unknown>; Insert: InsertShape<IntegracaoFundo, 'fundo_id' | 'provedor' | 'nome' | 'created_by'> & Record<string, unknown>; Update: UpdateShape<IntegracaoFundo> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'integracoes_fundo_fundo_id_fkey'; columns: ['fundo_id']; isOneToOne: false; referencedRelation: 'fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'integracoes_fundo_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      integracao_fundo_versoes: { Row: IntegracaoFundoVersao & Record<string, unknown>; Insert: InsertShape<IntegracaoFundoVersao, 'integracao_fundo_id' | 'versao' | 'ambiente' | 'identificador_cliente' | 'endpoint_base' | 'credential_ref' | 'vigente_desde'> & Record<string, unknown>; Update: UpdateShape<IntegracaoFundoVersao> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'integracao_fundo_versoes_integracao_fundo_id_fkey'; columns: ['integracao_fundo_id']; isOneToOne: false; referencedRelation: 'integracoes_fundo'; referencedColumns: ['id'] }, { foreignKeyName: 'integracao_fundo_versoes_publicada_por_fkey'; columns: ['publicada_por']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      integracao_fundo_versao_capacidades: { Row: IntegracaoFundoVersaoCapacidade & Record<string, unknown>; Insert: InsertShape<IntegracaoFundoVersaoCapacidade, 'integracao_fundo_versao_id' | 'fundo_id' | 'ambiente' | 'capability'> & Record<string, unknown>; Update: UpdateShape<IntegracaoFundoVersaoCapacidade> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'integracao_fundo_versao_capacidades_integracao_fundo_versao_id_fkey'; columns: ['integracao_fundo_versao_id']; isOneToOne: false; referencedRelation: 'integracao_fundo_versoes'; referencedColumns: ['id'] }, { foreignKeyName: 'integracao_fundo_versao_capacidades_fundo_id_fkey'; columns: ['fundo_id']; isOneToOne: false; referencedRelation: 'fundos'; referencedColumns: ['id'] }] }
      credenciais_integracao: { Row: CredencialIntegracao & Record<string, unknown>; Insert: InsertShape<CredencialIntegracao, 'fundo_id' | 'integracao_fundo_id' | 'ambiente' | 'nome' | 'usuario_criptografado' | 'senha_criptografada' | 'chave_versao' | 'criada_por'> & Record<string, unknown>; Update: UpdateShape<CredencialIntegracao> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'credenciais_integracao_fundo_id_fkey'; columns: ['fundo_id']; isOneToOne: false; referencedRelation: 'fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'credenciais_integracao_integracao_fundo_id_fkey'; columns: ['integracao_fundo_id']; isOneToOne: false; referencedRelation: 'integracoes_fundo'; referencedColumns: ['id'] }, { foreignKeyName: 'credenciais_integracao_criada_por_fkey'; columns: ['criada_por']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }, { foreignKeyName: 'credenciais_integracao_substituida_por_fkey'; columns: ['substituida_por']; isOneToOne: false; referencedRelation: 'credenciais_integracao'; referencedColumns: ['id'] }] }
      integracao_execucoes: { Row: IntegracaoExecucao & Record<string, unknown>; Insert: InsertShape<IntegracaoExecucao, 'fundo_id' | 'integracao_fundo_versao_id' | 'tipo_execucao' | 'ambiente'> & Record<string, unknown>; Update: UpdateShape<IntegracaoExecucao> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'integracao_execucoes_fundo_id_fkey'; columns: ['fundo_id']; isOneToOne: false; referencedRelation: 'fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'integracao_execucoes_integracao_fundo_versao_id_fkey'; columns: ['integracao_fundo_versao_id']; isOneToOne: false; referencedRelation: 'integracao_fundo_versoes'; referencedColumns: ['id'] }, { foreignKeyName: 'integracao_execucoes_remessa_cnab_id_fkey'; columns: ['remessa_cnab_id']; isOneToOne: false; referencedRelation: 'remessas_cnab'; referencedColumns: ['id'] }, { foreignKeyName: 'integracao_execucoes_operacao_id_fkey'; columns: ['operacao_id']; isOneToOne: false; referencedRelation: 'operacoes'; referencedColumns: ['id'] }] }
      retornos_integracao: { Row: RetornoIntegracao & Record<string, unknown>; Insert: InsertShape<RetornoIntegracao, 'fundo_id' | 'integracao_execucao_id' | 'tipo_retorno' | 'storage_path' | 'tamanho_bytes' | 'sha256'> & Record<string, unknown>; Update: UpdateShape<RetornoIntegracao> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'retornos_integracao_fundo_id_fkey'; columns: ['fundo_id']; isOneToOne: false; referencedRelation: 'fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'retornos_integracao_integracao_execucao_id_fkey'; columns: ['integracao_execucao_id']; isOneToOne: false; referencedRelation: 'integracao_execucoes'; referencedColumns: ['id'] }, { foreignKeyName: 'retornos_integracao_remessa_cnab_id_fkey'; columns: ['remessa_cnab_id']; isOneToOne: false; referencedRelation: 'remessas_cnab'; referencedColumns: ['id'] }] }
      sequencias_remessa: { Row: SequenciaRemessa & Record<string, unknown>; Insert: InsertShape<SequenciaRemessa, 'configuracao_cnab_id' | 'data_referencia'> & Record<string, unknown>; Update: Partial<SequenciaRemessa> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'sequencias_remessa_configuracao_cnab_id_fkey'; columns: ['configuracao_cnab_id']; isOneToOne: false; referencedRelation: 'configuracoes_cnab'; referencedColumns: ['id'] }] }
      remessas_cnab: { Row: RemessaCnab & Record<string, unknown>; Insert: InsertShape<RemessaCnab, 'fundo_id' | 'configuracao_cnab_id' | 'configuracao_cnab_versao_id' | 'configuracao_versao' | 'configuracao_hash' | 'storage_path' | 'sha256' | 'quantidade_registros' | 'quantidade_titulos' | 'valor_total' | 'nome_arquivo' | 'sequencial' | 'idempotency_key' | 'payload_hash'> & Record<string, unknown>; Update: UpdateShape<RemessaCnab> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'remessas_cnab_fundo_id_fkey'; columns: ['fundo_id']; isOneToOne: false; referencedRelation: 'fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'remessas_cnab_configuracao_cnab_id_fkey'; columns: ['configuracao_cnab_id']; isOneToOne: false; referencedRelation: 'configuracoes_cnab'; referencedColumns: ['id'] }, { foreignKeyName: 'remessas_cnab_configuracao_cnab_versao_id_fkey'; columns: ['configuracao_cnab_versao_id']; isOneToOne: false; referencedRelation: 'configuracao_cnab_versoes'; referencedColumns: ['id'] }, { foreignKeyName: 'remessas_cnab_integracao_fundo_versao_id_fkey'; columns: ['integracao_fundo_versao_id']; isOneToOne: false; referencedRelation: 'integracao_fundo_versoes'; referencedColumns: ['id'] }] }
      remessas_cnab_operacoes: { Row: RemessaCnabOperacao & Record<string, unknown>; Insert: RemessaCnabOperacao & Record<string, unknown>; Update: Partial<RemessaCnabOperacao> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'remessas_cnab_operacoes_remessa_cnab_id_fkey'; columns: ['remessa_cnab_id']; isOneToOne: false; referencedRelation: 'remessas_cnab'; referencedColumns: ['id'] }, { foreignKeyName: 'remessas_cnab_operacoes_operacao_id_fkey'; columns: ['operacao_id']; isOneToOne: false; referencedRelation: 'operacoes'; referencedColumns: ['id'] }] }
      seguranca_eventos: { Row: SegurancaEvento & Record<string, unknown>; Insert: InsertShape<SegurancaEvento, 'tipo_evento'> & Record<string, unknown>; Update: UpdateShape<SegurancaEvento> & Record<string, unknown>; Relationships: [] }
      mfa_recovery_codes: { Row: MfaRecoveryCode & Record<string, unknown>; Insert: InsertShape<MfaRecoveryCode, 'user_id' | 'code_hash'> & Record<string, unknown>; Update: UpdateShape<MfaRecoveryCode> & Record<string, unknown>; Relationships: [] }
      sessoes_elevadas: { Row: SessaoElevada & Record<string, unknown>; Insert: InsertShape<SessaoElevada, 'user_id' | 'metodo' | 'expira_em'> & Record<string, unknown>; Update: UpdateShape<SessaoElevada> & Record<string, unknown>; Relationships: [] }
      seguranca_rate_limits: { Row: SegurancaRateLimit & Record<string, unknown>; Insert: InsertShape<SegurancaRateLimit, 'key_hash' | 'escopo'> & Record<string, unknown>; Update: UpdateShape<SegurancaRateLimit> & Record<string, unknown>; Relationships: [] }
      mfa_reset_solicitacoes: { Row: MfaResetSolicitacao & Record<string, unknown>; Insert: InsertShape<MfaResetSolicitacao, 'usuario_id' | 'solicitante_id' | 'motivo'> & Record<string, unknown>; Update: UpdateShape<MfaResetSolicitacao> & Record<string, unknown>; Relationships: [] }
      representantes: { Row: Representante & Record<string, unknown>; Insert: InsertShape<Representante, 'cedente_id' | 'nome' | 'cpf' | 'rg' | 'cargo' | 'email' | 'telefone'> & Record<string, unknown>; Update: UpdateShape<Representante> & Record<string, unknown>; Relationships: [] }
      documentos: { Row: Documento & Record<string, unknown>; Insert: InsertShape<Documento, 'cedente_id' | 'tipo'> & Record<string, unknown>; Update: UpdateShape<Documento> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'documentos_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }, { foreignKeyName: 'documentos_representante_id_fkey'; columns: ['representante_id']; isOneToOne: false; referencedRelation: 'representantes'; referencedColumns: ['id'] }, { foreignKeyName: 'documentos_analisado_por_fkey'; columns: ['analisado_por']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      contas_escrow: { Row: ContaEscrow & Record<string, unknown>; Insert: InsertShape<ContaEscrow, 'cedente_id' | 'identificador'> & Record<string, unknown>; Update: UpdateShape<ContaEscrow> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'contas_escrow_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      movimentos_escrow: { Row: MovimentoEscrow & Record<string, unknown>; Insert: InsertShape<MovimentoEscrow, 'conta_escrow_id' | 'tipo' | 'descricao' | 'valor' | 'saldo_apos'> & Record<string, unknown>; Update: UpdateShape<MovimentoEscrow> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'movimentos_escrow_conta_escrow_id_fkey'; columns: ['conta_escrow_id']; isOneToOne: false; referencedRelation: 'contas_escrow'; referencedColumns: ['id'] }, { foreignKeyName: 'fk_movimentos_operacao'; columns: ['operacao_id']; isOneToOne: false; referencedRelation: 'operacoes'; referencedColumns: ['id'] }] }
      fundos: { Row: Fundo & Record<string, unknown>; Insert: InsertShape<Fundo, 'nome' | 'cnpj' | 'administradora_nome' | 'administradora_cnpj'> & Record<string, unknown>; Update: UpdateShape<Fundo> & Record<string, unknown>; Relationships: [] }
      cedente_fundos: { Row: CedenteFundo & Record<string, unknown>; Insert: InsertShape<CedenteFundo, 'cedente_id' | 'fundo_id'> & Record<string, unknown>; Update: UpdateShape<CedenteFundo> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'cedente_fundos_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }, { foreignKeyName: 'cedente_fundos_fundo_id_fkey'; columns: ['fundo_id']; isOneToOne: false; referencedRelation: 'fundos'; referencedColumns: ['id'] }] }
      politicas_operacionais: { Row: PoliticaOperacional & Record<string, unknown>; Insert: InsertShape<PoliticaOperacional, 'fundo_id' | 'codigo' | 'nome' | 'created_by'> & Record<string, unknown>; Update: UpdateShape<PoliticaOperacional> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'politicas_operacionais_fundo_id_fkey'; columns: ['fundo_id']; isOneToOne: false; referencedRelation: 'fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'politicas_operacionais_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      politica_operacional_versoes: { Row: PoliticaOperacionalVersao & Record<string, unknown>; Insert: InsertShape<PoliticaOperacionalVersao, 'politica_operacional_id' | 'fundo_id' | 'versao' | 'vigente_desde' | 'conteudo_hash'> & Record<string, unknown>; Update: UpdateShape<PoliticaOperacionalVersao> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'politica_operacional_versoes_politica_operacional_id_fkey'; columns: ['politica_operacional_id']; isOneToOne: false; referencedRelation: 'politicas_operacionais'; referencedColumns: ['id'] }, { foreignKeyName: 'politica_operacional_versoes_fundo_id_fkey'; columns: ['fundo_id']; isOneToOne: false; referencedRelation: 'fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'politica_operacional_versoes_publicada_por_fkey'; columns: ['publicada_por']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      duplicatas: { Row: Duplicata & Record<string, unknown>; Insert: InsertShape<Duplicata, 'fundo_id' | 'cedente_fundo_id' | 'cedente_id' | 'nota_fiscal_id' | 'criado_por'> & Record<string, unknown>; Update: UpdateShape<Duplicata> & Record<string, unknown>; Relationships: [] }
      duplicata_versoes: { Row: DuplicataVersao & Record<string, unknown>; Insert: InsertShape<DuplicataVersao, 'duplicata_id' | 'nota_fiscal_id' | 'numero_versao' | 'path' | 'nome_original' | 'mime_type' | 'tamanho_bytes' | 'sha256' | 'enviado_por'> & Record<string, unknown>; Update: UpdateShape<DuplicataVersao> & Record<string, unknown>; Relationships: [] }
      duplicata_correcoes: { Row: DuplicataCorrecao & Record<string, unknown>; Insert: InsertShape<DuplicataCorrecao, 'duplicata_id' | 'duplicata_versao_id' | 'campo' | 'valor_corrigido' | 'motivo' | 'corrigido_por'> & Record<string, unknown>; Update: UpdateShape<DuplicataCorrecao> & Record<string, unknown>; Relationships: [] }
      duplicata_validacoes: { Row: DuplicataValidacao & Record<string, unknown>; Insert: InsertShape<DuplicataValidacao, 'duplicata_id' | 'duplicata_versao_id' | 'resultado' | 'resultado_confronto' | 'validado_por'> & Record<string, unknown>; Update: UpdateShape<DuplicataValidacao> & Record<string, unknown>; Relationships: [] }
      politica_requisitos_documentais: { Row: PoliticaRequisitoDocumental & Record<string, unknown>; Insert: InsertShape<PoliticaRequisitoDocumental, 'politica_operacional_versao_id' | 'politica_operacional_id' | 'fundo_id' | 'codigo' | 'escopo' | 'tipo_documento_codigo' | 'responsavel_upload' | 'responsavel_aprovacao'> & Record<string, unknown>; Update: UpdateShape<PoliticaRequisitoDocumental> & Record<string, unknown>; Relationships: [] }
      devedores_solidarios: { Row: DevedorSolidario & Record<string, unknown>; Insert: InsertShape<DevedorSolidario, 'cedente_id' | 'nome' | 'doc_numero' | 'cpf'> & Record<string, unknown>; Update: UpdateShape<DevedorSolidario> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'devedores_solidarios_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      notas_fiscais: { Row: NotaFiscal & Record<string, unknown>; Insert: InsertShape<NotaFiscal, 'cedente_id' | 'numero_nf' | 'data_emissao' | 'data_vencimento' | 'cnpj_emitente' | 'razao_social_emitente' | 'cnpj_destinatario' | 'razao_social_destinatario' | 'valor_bruto'> & Record<string, unknown>; Update: UpdateShape<NotaFiscal> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'notas_fiscais_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      operacoes: { Row: Operacao & Record<string, unknown>; Insert: InsertShape<Operacao, 'cedente_id' | 'valor_bruto_total' | 'prazo_dias' | 'data_vencimento'> & Record<string, unknown>; Update: UpdateShape<Operacao> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'operacoes_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }, { foreignKeyName: 'operacoes_conta_escrow_id_fkey'; columns: ['conta_escrow_id']; isOneToOne: false; referencedRelation: 'contas_escrow'; referencedColumns: ['id'] }, { foreignKeyName: 'operacoes_aprovado_por_fkey'; columns: ['aprovado_por']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }, { foreignKeyName: 'operacoes_testemunha_1_id_fkey'; columns: ['testemunha_1_id']; isOneToOne: false; referencedRelation: 'testemunhas'; referencedColumns: ['id'] }, { foreignKeyName: 'operacoes_testemunha_2_id_fkey'; columns: ['testemunha_2_id']; isOneToOne: false; referencedRelation: 'testemunhas'; referencedColumns: ['id'] }] }
      operacoes_nfs: { Row: OperacaoNf & Record<string, unknown>; Insert: OperacaoNf & Record<string, unknown>; Update: Partial<OperacaoNf> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'operacoes_nfs_operacao_id_fkey'; columns: ['operacao_id']; isOneToOne: false; referencedRelation: 'operacoes'; referencedColumns: ['id'] }, { foreignKeyName: 'operacoes_nfs_nota_fiscal_id_fkey'; columns: ['nota_fiscal_id']; isOneToOne: false; referencedRelation: 'notas_fiscais'; referencedColumns: ['id'] }] }
      operacao_calculo_nfs: { Row: OperacaoCalculoNf & Record<string, unknown>; Insert: InsertShape<OperacaoCalculoNf, 'operacao_id' | 'nota_fiscal_id' | 'fundo_id' | 'cedente_id' | 'metodo_calculo_financeiro' | 'valor_nominal' | 'taxa_mensal' | 'data_base' | 'vencimento_contratual' | 'vencimento_calculo' | 'base_calculo' | 'dias_corridos_reais' | 'dias_aplicados' | 'expoente' | 'fator' | 'valor_presente' | 'desconto' | 'versao_motor'> & Record<string, unknown>; Update: UpdateShape<OperacaoCalculoNf> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'operacao_calculo_nfs_operacao_id_fkey'; columns: ['operacao_id']; isOneToOne: false; referencedRelation: 'operacoes'; referencedColumns: ['id'] }, { foreignKeyName: 'operacao_calculo_nfs_nota_fiscal_id_fkey'; columns: ['nota_fiscal_id']; isOneToOne: false; referencedRelation: 'notas_fiscais'; referencedColumns: ['id'] }] }
      taxas_cedente: { Row: TaxaCedente & Record<string, unknown>; Insert: InsertShape<TaxaCedente, 'cedente_id' | 'prazo_min' | 'prazo_max' | 'taxa_percentual'> & Record<string, unknown>; Update: UpdateShape<TaxaCedente> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'taxas_cedente_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      consultor_cedente: { Row: ConsultorCedente & Record<string, unknown>; Insert: InsertShape<ConsultorCedente, 'consultor_id' | 'cedente_id'> & Record<string, unknown>; Update: UpdateShape<ConsultorCedente> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'consultor_cedente_consultor_id_fkey'; columns: ['consultor_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }, { foreignKeyName: 'consultor_cedente_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      sacados: { Row: Sacado & Record<string, unknown>; Insert: InsertShape<Sacado, 'user_id' | 'cnpj' | 'razao_social'> & Record<string, unknown>; Update: UpdateShape<Sacado> & Record<string, unknown>; Relationships: [] }
      testemunhas: { Row: Testemunha & Record<string, unknown>; Insert: InsertShape<Testemunha, 'nome' | 'cpf'> & Record<string, unknown>; Update: UpdateShape<Testemunha> & Record<string, unknown>; Relationships: [] }
      solicitacoes_alteracao_cedente: { Row: SolicitacaoAlteracaoCedente & Record<string, unknown>; Insert: InsertShape<SolicitacaoAlteracaoCedente, 'cedente_id' | 'dados_atuais' | 'dados_propostos'> & Record<string, unknown>; Update: UpdateShape<SolicitacaoAlteracaoCedente> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'solicitacoes_alteracao_cedente_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      cedente_acessos: { Row: CedenteAcesso & Record<string, unknown>; Insert: InsertShape<CedenteAcesso, 'cedente_id' | 'user_id'> & Record<string, unknown>; Update: UpdateShape<CedenteAcesso> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'cedente_acessos_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }, { foreignKeyName: 'cedente_acessos_user_id_fkey'; columns: ['user_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      logs_auditoria: { Row: LogAuditoria & Record<string, unknown>; Insert: InsertShape<LogAuditoria, 'tipo_evento' | 'entidade_tipo' | 'ator_tipo' | 'origem'> & Record<string, unknown>; Update: UpdateShape<LogAuditoria> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'logs_auditoria_usuario_id_fkey'; columns: ['usuario_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      notificacoes: { Row: Notificacao & Record<string, unknown>; Insert: InsertShape<Notificacao, 'usuario_id' | 'titulo' | 'mensagem' | 'tipo'> & Record<string, unknown>; Update: UpdateShape<Notificacao> & Record<string, unknown>; Relationships: [] }
      autorizacoes_acoes_sensiveis: { Row: AutorizacaoAcaoSensivel & Record<string, unknown>; Insert: InsertShape<AutorizacaoAcaoSensivel, 'user_id' | 'session_id' | 'action_type' | 'nonce_hash' | 'expira_em'> & Record<string, unknown>; Update: UpdateShape<AutorizacaoAcaoSensivel> & Record<string, unknown>; Relationships: [] }
      importacoes_financeiras: { Row: ImportacaoFinanceira & Record<string, unknown>; Insert: Partial<ImportacaoFinanceira> & Pick<ImportacaoFinanceira, 'fundo_id' | 'provedor' | 'tipo_base' | 'data_referencia' | 'layout_nome' | 'versao_layout' | 'hash_conteudo'> & Record<string, unknown>; Update: Partial<ImportacaoFinanceira> & Record<string, unknown>; Relationships: [] }
      importacao_arquivos: { Row: ImportacaoArquivo & Record<string, unknown>; Insert: Partial<ImportacaoArquivo> & Pick<ImportacaoArquivo, 'importacao_id' | 'fundo_id' | 'nome_arquivo' | 'mime_type' | 'tamanho_bytes' | 'hash_conteudo' | 'storage_path'> & Record<string, unknown>; Update: Partial<ImportacaoArquivo> & Record<string, unknown>; Relationships: [] }
      importacao_linhas: { Row: ImportacaoLinha & Record<string, unknown>; Insert: Partial<ImportacaoLinha> & Pick<ImportacaoLinha, 'importacao_id' | 'fundo_id' | 'numero_linha' | 'status' | 'dados_brutos'> & Record<string, unknown>; Update: Partial<ImportacaoLinha> & Record<string, unknown>; Relationships: [] }
      importacao_ciclos: { Row: ImportacaoCiclo & Record<string, unknown>; Insert: Partial<ImportacaoCiclo> & Pick<ImportacaoCiclo, 'fundo_id' | 'data_operacional' | 'origem' | 'status'> & Record<string, unknown>; Update: Partial<ImportacaoCiclo> & Record<string, unknown>; Relationships: [] }
      matching_execucoes: { Row: MatchingExecucao & Record<string, unknown>; Insert: Partial<MatchingExecucao> & Pick<MatchingExecucao, 'fundo_id' | 'data_referencia' | 'input_import_ids' | 'assinatura_execucao'> & Record<string, unknown>; Update: Partial<MatchingExecucao> & Record<string, unknown>; Relationships: [] }
      titulo_nf_vinculos: { Row: TituloNfVinculo & Record<string, unknown>; Insert: Partial<TituloNfVinculo> & Pick<TituloNfVinculo, 'fundo_id' | 'provedor' | 'identidade_externa' | 'nota_fiscal_id' | 'origem' | 'metodo'> & Record<string, unknown>; Update: Partial<TituloNfVinculo> & Record<string, unknown>; Relationships: [] }
      titulo_nf_vinculo_chaves: { Row: TituloNfVinculoChave & Record<string, unknown>; Insert: Partial<TituloNfVinculoChave> & Pick<TituloNfVinculoChave, 'vinculo_id' | 'fundo_id' | 'provedor' | 'tipo_chave' | 'valor_normalizado' | 'fonte'> & Record<string, unknown>; Update: Partial<TituloNfVinculoChave> & Record<string, unknown>; Relationships: [] }
      matching_resultados: { Row: MatchingResultado & Record<string, unknown>; Insert: Partial<MatchingResultado> & Pick<MatchingResultado, 'execucao_id' | 'fundo_id' | 'provedor' | 'origem_registro' | 'origem_registro_id' | 'identidade_externa' | 'status' | 'metodo'> & Record<string, unknown>; Update: Partial<MatchingResultado> & Record<string, unknown>; Relationships: [] }
      matching_candidatos: { Row: MatchingCandidato & Record<string, unknown>; Insert: Partial<MatchingCandidato> & Pick<MatchingCandidato, 'matching_resultado_id' | 'fundo_id' | 'nota_fiscal_id' | 'ordem' | 'metodo'> & Record<string, unknown>; Update: Partial<MatchingCandidato> & Record<string, unknown>; Relationships: [] }
      conciliacao_execucoes: { Row: ConciliacaoExecucao & Record<string, unknown>; Insert: Partial<ConciliacaoExecucao> & Pick<ConciliacaoExecucao, 'fundo_id' | 'data_referencia' | 'assinatura_execucao'> & Record<string, unknown>; Update: Partial<ConciliacaoExecucao> & Record<string, unknown>; Relationships: [] }
      conciliacao_resultados: { Row: ConciliacaoResultado & Record<string, unknown>; Insert: Partial<ConciliacaoResultado> & Pick<ConciliacaoResultado, 'execucao_id' | 'fundo_id' | 'identidade_externa' | 'provedor' | 'status'> & Record<string, unknown>; Update: Partial<ConciliacaoResultado> & Record<string, unknown>; Relationships: [] }
      posicao_logistica_execucoes: { Row: PosicaoLogisticaExecucao & Record<string, unknown>; Insert: Partial<PosicaoLogisticaExecucao> & Pick<PosicaoLogisticaExecucao, 'fundo_id' | 'data_referencia' | 'estoque_importacao_id' | 'matching_execucao_id' | 'logistica_as_of' | 'fingerprint_logistico' | 'assinatura_execucao'> & Record<string, unknown>; Update: Partial<PosicaoLogisticaExecucao> & Record<string, unknown>; Relationships: [] }
      posicao_logistica_resultados: { Row: PosicaoLogisticaResultado & Record<string, unknown>; Insert: Partial<PosicaoLogisticaResultado> & Pick<PosicaoLogisticaResultado, 'execucao_id' | 'fundo_id' | 'estoque_importacao_id' | 'estoque_posicao_id' | 'matching_status' | 'matching_metodo' | 'status_vinculo' | 'valor_aquisicao_qualidade' | 'fundamento'> & Record<string, unknown>; Update: Partial<PosicaoLogisticaResultado> & Record<string, unknown>; Relationships: [] }
      exposicao_execucoes: { Row: ExposicaoExecucao & Record<string, unknown>; Insert: Partial<ExposicaoExecucao> & Pick<ExposicaoExecucao, 'fundo_id' | 'data_operacional' | 'data_referencia_estoque' | 'data_referencia_pl' | 'overlay_as_of' | 'assinatura_execucao' | 'status'> & Record<string, unknown>; Update: Partial<ExposicaoExecucao> & Record<string, unknown>; Relationships: [] }
      exposicao_overlay_itens: { Row: ExposicaoOverlayItem & Record<string, unknown>; Insert: Partial<ExposicaoOverlayItem> & Pick<ExposicaoOverlayItem, 'execucao_id' | 'fundo_id' | 'operacao_id' | 'nota_fiscal_id' | 'operacao_economica_em' | 'status_logistico' | 'motivo'> & Record<string, unknown>; Update: Partial<ExposicaoOverlayItem> & Record<string, unknown>; Relationships: [] }
      risco_execucoes: { Row: RiscoExecucao & Record<string, unknown>; Insert: Partial<RiscoExecucao> & Pick<RiscoExecucao, 'fundo_id' | 'escopo' | 'origem' | 'data_operacional' | 'overlay_as_of' | 'aplicavel' | 'status_tecnico' | 'assinatura_inputs'> & Record<string, unknown>; Update: Partial<RiscoExecucao> & Record<string, unknown>; Relationships: [] }
      risco_motivos: { Row: RiscoMotivo & Record<string, unknown>; Insert: Partial<RiscoMotivo> & Pick<RiscoMotivo, 'risco_execucao_id' | 'fundo_id' | 'codigo' | 'severidade'> & Record<string, unknown>; Update: Partial<RiscoMotivo> & Record<string, unknown>; Relationships: [] }
      risco_revisoes: { Row: RiscoRevisao & Record<string, unknown>; Insert: Partial<RiscoRevisao> & Pick<RiscoRevisao, 'risco_execucao_id' | 'fundo_id' | 'operacao_id' | 'assinatura_inputs'> & Record<string, unknown>; Update: Partial<RiscoRevisao> & Record<string, unknown>; Relationships: [] }
    }
    Views: Record<string, never>
    Functions: {
      concluir_onboarding_cedente: {
        Args: { p_cadastro: Record<string, unknown> }
        Returns: { id: string; razao_social: string; criado: boolean; idempotente: boolean }
      }
      registrar_documento_cadastral_cedente: {
        Args: {
          p_tipo: DocumentoTipo
          p_storage_path: string
          p_nome_arquivo: string
          p_representante_id?: string | null
        }
        Returns: Array<{ documento_id: string; versao: number; status: DocumentoStatus; storage_path: string }>
      }
      analisar_documento_gestor: {
        Args: { p_documento_id: string; p_decisao: string; p_motivo?: string | null }
        Returns: Array<{ documento_id: string; status: DocumentoStatus }>
      }
      solicitar_atualizacao_documento_gestor: {
        Args: { p_documento_id: string }
        Returns: Array<{ documento_id: string; atualizacao_solicitada_em: string }>
      }
      aprovar_cadastro_cedente_gestor: {
        Args: { p_cedente_id: string }
        Returns: Array<{ cedente_id: string; status: CedenteStatus; conta_escrow_identificador: string }>
      }
      reprovar_cadastro_cedente_gestor: {
        Args: { p_cedente_id: string }
        Returns: Array<{ cedente_id: string; status: CedenteStatus }>
      }
      alternar_escrow_cedente_gestor: {
        Args: { p_cedente_id: string; p_habilitar: boolean }
        Returns: Array<{ cedente_id: string; habilitar_escrow: boolean }>
      }
      alternar_cadastro_filiais_cedente_gestor: {
        Args: { p_cedente_id: string; p_habilitar: boolean }
        Returns: Array<{ cedente_id: string; permite_cadastro_filiais: boolean }>
      }
      alternar_coobrigacao_cedente_gestor: {
        Args: { p_cedente_id: string; p_habilitar: boolean }
        Returns: Array<{ cedente_id: string; coobrigacao: boolean }>
      }
      aprovar_alteracao_cadastral_cedente_gestor: {
        Args: { p_solicitacao_id: string }
        Returns: Array<{ solicitacao_id: string; cedente_id: string; status: string }>
      }
      reprovar_alteracao_cadastral_cedente_gestor: {
        Args: { p_solicitacao_id: string; p_motivo: string }
        Returns: Array<{ solicitacao_id: string; cedente_id: string; status: string }>
      }
      estabelecimento_pode_originar: {
        Args: { p_estabelecimento_id: string; p_cedente_id: string; p_fundo_id: string }
        Returns: boolean
      }
      cadastrar_filial_cedente: {
        Args: { p_cnpj: string; p_razao_social: string; p_nome_fantasia?: string | null }
        Returns: CedenteEstabelecimento
      }
      salvar_conta_estabelecimento_cedente: {
        Args: { p_estabelecimento_id: string; p_banco: string; p_agencia: string; p_conta: string; p_tipo_conta: string; p_principal?: boolean }
        Returns: CedenteEstabelecimentoContaBancaria
      }
      decidir_estabelecimento_gestor: {
        Args: { p_estabelecimento_id: string; p_acao: 'aprovar' | 'rejeitar' | 'suspender' | 'reativar'; p_motivo?: string | null }
        Returns: CedenteEstabelecimento
      }
      configurar_requisito_estabelecimento_gestor: {
        Args: { p_estabelecimento_id: string; p_documento_tipo_id: string; p_obrigatorio?: boolean; p_ativo?: boolean; p_observacoes?: string | null }
        Returns: { requisito: CedenteEstabelecimentoRequisito; pendencia_pos_aprovacao: boolean; cedente_id: string; estabelecimento_status: string }
      }
      registrar_documento_estabelecimento_upload: {
        Args: { p_estabelecimento_id: string; p_requisito_id: string; p_documento_tipo_id: string; p_bucket: string; p_path: string; p_nome_original: string; p_mime_type: string; p_tamanho_bytes: number; p_sha256: string; p_substitui_versao_id?: string | null }
        Returns: Record<string, unknown>
      }
      listar_requisitos_estabelecimento: {
        Args: { p_estabelecimento_id: string }
        Returns: Array<EstabelecimentoRequisitoStatus>
      }
      listar_estabelecimentos_pagina: {
        Args: {
          p_cedente_id: string
          p_tipo?: string | null
          p_status?: string | null
          p_pendencia?: string | null
          p_q?: string | null
          p_page?: number
          p_page_size?: number
        }
        Returns: Array<{
          estabelecimento_id: string
          cnpj: string
          razao_social: string
          nome_fantasia: string | null
          tipo: 'matriz' | 'filial'
          status: string
          ativo: boolean
          total_obrigatorios: number
          aprovados_obrigatorios: number
          aguardando_analise: number
          tem_conta_principal: boolean
          pendencia: string
          total_itens: number
        }>
      }
      analisar_documento_estabelecimento_gestor: {
        Args: { p_documento_versao_id: string; p_resultado: 'aprovado' | 'rejeitado' | 'requer_ajuste'; p_observacoes?: string | null }
        Returns: { analise_id: string; versao_id: string; status: string; cedente_id: string; estabelecimento_id: string }
      }
      admin_resumo_fundos: { Args: Record<string, never>; Returns: Record<string, unknown> }
      admin_listar_fundos: { Args: { p_busca?: string | null; p_status?: string; p_pagina?: number; p_por_pagina?: number }; Returns: Record<string, unknown> }
      admin_obter_fundo: { Args: { p_fundo_id: string }; Returns: Record<string, unknown> | null }
      publicar_importacao_financeira: { Args: { p_importacao_id: string; p_correlation_id?: string | null }; Returns: Record<string, unknown> }
      registrar_importacao_financeira_sem_movimento: { Args: { p_fundo_id: string; p_tipo_base: string; p_data_referencia: string; p_provedor: string; p_layout_nome: string; p_versao_layout: string; p_origem?: string; p_correlation_id?: string | null }; Returns: Record<string, unknown> }
      resolver_bootstrap_financeiro: { Args: { p_fundo_id: string }; Returns: Record<string, unknown> }
      persistir_matching_execucao: { Args: { p_payload: Record<string, unknown> }; Returns: string }
      persistir_conciliacao_execucao: { Args: { p_payload: Record<string, unknown> }; Returns: string }
      persistir_posicao_logistica_execucao: { Args: { p_payload: Record<string, unknown> }; Returns: string }
      persistir_exposicao_execucao: { Args: { p_payload: Record<string, unknown> }; Returns: string }
      confirmar_match_manual: { Args: { p_matching_resultado_id: string; p_nota_fiscal_id: string; p_motivo: string; p_correlation_id?: string }; Returns: string }
      revogar_match_manual: { Args: { p_vinculo_id: string; p_motivo: string; p_correlation_id?: string }; Returns: boolean }
      iniciar_ciclo_importacao_financeira: { Args: { p_fundo_id: string; p_data_operacional: string; p_origem?: 'CRON'; p_correlation_id?: string | null }; Returns: string | null }
      admin_listar_auditoria_fundo: { Args: { p_fundo_id: string }; Returns: Array<Record<string, unknown>> }
      admin_criar_fundo: { Args: {
        p_nome: string
        p_cnpj: string
        p_administradora_nome: string
        p_administradora_cnpj: string
        p_gestora_nome: string
        p_gestora_cnpj: string
        p_custodiante_nome?: string | null
        p_custodiante_cnpj?: string | null
        p_administradora_endereco?: string | null
        p_administradora_ato_declaratorio?: string | null
        p_contato_nome?: string | null
        p_contato_email?: string | null
      }; Returns: Record<string, unknown> }
      admin_atualizar_fundo: { Args: {
        p_fundo_id: string
        p_updated_at_esperado: string
        p_nome: string
        p_cnpj: string
        p_administradora_nome: string
        p_administradora_cnpj: string
        p_gestora_nome: string
        p_gestora_cnpj: string
        p_custodiante_nome?: string | null
        p_custodiante_cnpj?: string | null
        p_administradora_endereco?: string | null
        p_administradora_ato_declaratorio?: string | null
        p_contato_nome?: string | null
        p_contato_email?: string | null
      }; Returns: Record<string, unknown> }
      admin_ativar_fundo: { Args: { p_fundo_id: string; p_updated_at_esperado: string }; Returns: Record<string, unknown> }
      admin_desativar_fundo: { Args: { p_fundo_id: string; p_updated_at_esperado: string }; Returns: Record<string, unknown> }
      admin_resumo_usuarios: { Args: Record<string, never>; Returns: Record<string, unknown> }
      admin_listar_usuarios: { Args: { p_busca?: string | null; p_papel?: string; p_status?: string; p_super_admin?: string; p_pagina?: number; p_por_pagina?: number }; Returns: Record<string, unknown> }
      admin_obter_usuario: { Args: { p_usuario_id: string }; Returns: Record<string, unknown> | null }
      admin_obter_usuario_por_email: { Args: { p_email: string }; Returns: Record<string, unknown> | null }
      admin_listar_fundos_usuario: { Args: { p_usuario_id: string }; Returns: Array<Record<string, unknown>> }
      admin_listar_gestores_fundo: { Args: { p_fundo_id: string }; Returns: Array<Record<string, unknown>> }
      admin_listar_auditoria_usuario: { Args: { p_usuario_id: string }; Returns: Array<Record<string, unknown>> }
      admin_vincular_gestor_fundo: { Args: { p_usuario_id: string; p_fundo_id: string; p_correlation_id: string }; Returns: Record<string, unknown> }
      admin_vincular_gestor_fundos: { Args: { p_usuario_id: string; p_fundo_ids: string[]; p_correlation_id: string }; Returns: Record<string, unknown> }
      admin_revogar_gestor_fundo: { Args: { p_usuario_id: string; p_fundo_id: string; p_correlation_id: string }; Returns: Record<string, unknown> }
      admin_reativar_gestor_fundo: { Args: { p_usuario_id: string; p_fundo_id: string; p_correlation_id: string }; Returns: Record<string, unknown> }
      admin_conceder_super_admin: { Args: { p_usuario_id: string; p_correlation_id: string }; Returns: Record<string, unknown> }
      admin_revogar_super_admin: { Args: { p_usuario_id: string; p_correlation_id: string }; Returns: Record<string, unknown> }
      admin_desativar_usuario: { Args: { p_usuario_id: string; p_correlation_id: string }; Returns: Record<string, unknown> }
      admin_reativar_usuario: { Args: { p_usuario_id: string; p_correlation_id: string }; Returns: Record<string, unknown> }
      admin_concluir_reset_mfa: { Args: { p_usuario_id: string; p_fatores_removidos: number; p_correlation_id: string }; Returns: Record<string, unknown> }
      admin_finalizar_convite_usuario: { Args: { p_usuario_id: string; p_tipo: string; p_nome: string; p_fundo_ids?: string[]; p_correlation_id: string }; Returns: Record<string, unknown> }
      admin_obter_configuracoes_tecnicas_fundo: {
        Args: { p_fundo_id: string; p_execucoes_limite?: number; p_execucoes_offset?: number }
        Returns: Record<string, unknown>
      }
      admin_cadastrar_credencial_integracao: {
        Args: {
          p_fundo_id: string
          p_integracao_fundo_id: string
          p_ambiente: string
          p_nome: string
          p_usuario_criptografado: string
          p_senha_criptografada: string
          p_chave_versao: string
          p_usuario_mascarado: string
          p_credencial_anterior_id?: string | null
          p_correlation_id?: string | null
        }
        Returns: Record<string, unknown>
      }
      admin_ativar_credencial_integracao: {
        Args: { p_fundo_id: string; p_credencial_id: string; p_correlation_id?: string | null }
        Returns: Record<string, unknown>
      }
      admin_revogar_credencial_integracao: {
        Args: { p_fundo_id: string; p_credencial_id: string; p_motivo: string; p_correlation_id?: string | null }
        Returns: Record<string, unknown>
      }
      admin_salvar_integracao_rascunho: {
        Args: {
          p_fundo_id: string
          p_integracao_fundo_id: string | null
          p_versao_id: string | null
          p_provider_key: string
          p_system_name: string
          p_adapter_key: string | null
          p_capabilities: string[]
          p_ambiente: string
          p_endpoint_base: string
          p_identificador_cliente: string
          p_credencial_integracao_id: string | null
          p_configuracao_nao_sensivel?: Record<string, unknown>
          p_updated_at_esperado?: string | null
          p_correlation_id?: string | null
        }
        Returns: Record<string, unknown>
      }
      admin_publicar_integracao_versao: {
        Args: { p_fundo_id: string; p_versao_id: string; p_correlation_id?: string | null }
        Returns: Record<string, unknown>
      }
      admin_desativar_integracao_versao: {
        Args: { p_fundo_id: string; p_versao_id: string; p_correlation_id?: string | null }
        Returns: Record<string, unknown>
      }
      resolver_integracao_por_capability: {
        Args: { p_fundo_id: string; p_ambiente: string; p_capability: string }
        Returns: Record<string, unknown>
      }
      admin_salvar_cnab_rascunho: {
        Args: {
          p_fundo_id: string
          p_configuracao_id: string | null
          p_versao_id: string | null
          p_codigo: string
          p_nome: string
          p_descricao: string | null
          p_layout: string
          p_versao_layout: string
          p_codigo_banco: string
          p_banco: string
          p_agencia: string
          p_conta: string
          p_digito_conta: string
          p_carteira: string
          p_convenio: string
          p_codigo_originador: string
          p_codigo_empresa: string
          p_tipo_inscricao: string
          p_numero_inscricao: string
          p_especie_titulo: string
          p_tipo_recebivel: string
          p_configuracao: Record<string, unknown>
          p_conteudo_hash: string
          p_updated_at_esperado?: string | null
          p_correlation_id?: string | null
        }
        Returns: Record<string, unknown>
      }
      admin_publicar_cnab_versao: {
        Args: { p_fundo_id: string; p_versao_id: string; p_correlation_id?: string | null }
        Returns: Record<string, unknown>
      }
      admin_desativar_cnab_versao: {
        Args: { p_fundo_id: string; p_versao_id: string; p_correlation_id?: string | null }
        Returns: Record<string, unknown>
      }
      admin_preparar_teste_integracao: {
        Args: { p_fundo_id: string; p_versao_id: string; p_correlation_id?: string | null }
        Returns: Record<string, unknown>
      }
      admin_finalizar_teste_integracao: {
        Args: {
          p_fundo_id: string
          p_execucao_id: string
          p_status: string
          p_codigo_resposta: string
          p_mensagem_resumida: string
          p_erro_categoria: string
          p_duracao_ms: number
          p_correlation_id?: string | null
        }
        Returns: Record<string, unknown>
      }
      publicar_configuracao_comunicacoes: { Args: { p_versao_id: string }; Returns: ComunicacaoConfiguracaoVersao }
      criar_rascunho_configuracao_comunicacoes: { Args: { p_fundo_id: string; p_base_versao_id: string | null; p_templates_padrao: Array<Record<string, unknown>> }; Returns: string }
      iniciar_execucao_comunicacoes: { Args: { p_data_referencia: string }; Returns: string | null }
      registrar_comunicacao_operacional: { Args: { p_comunicacao: Record<string, unknown>; p_itens: Array<Record<string, unknown>> }; Returns: string | null }
      get_user_role: { Args: Record<string, never>; Returns: string }
      get_user_cedente_id: { Args: Record<string, never>; Returns: string | null }
      get_user_cedente_acesso_perfil: { Args: Record<string, never>; Returns: string | null }
      get_user_sacado_cnpj: { Args: Record<string, never>; Returns: string | null }
      get_user_operacao_ids: { Args: Record<string, never>; Returns: string[] }
      carregar_dashboard_sacado: { Args: Record<string, never>; Returns: Record<string, unknown> }
      carregar_indicadores_nfs_sacado: { Args: Record<string, never>; Returns: Record<string, unknown> }
      listar_cedentes_aprovacao_sacado: {
        Args: Record<string, never>
        Returns: Array<{ id: string; nome: string; cnpj: string }>
      }
      listar_onboarding_cedentes_paginado: {
        Args: {
          p_fundo_id: string
          p_page?: number
          p_page_size?: number
          p_busca?: string | null
          p_etapa?: string
          p_status_cadastral?: string | null
          p_politica_id?: string | null
          p_sort?: string
          p_direction?: string
        }
        Returns: Record<string, unknown>
      }
      dashboard_gestor_resumo: {
        Args: { p_fundo_id: string }
        Returns: Record<string, unknown>
      }
      dashboard_cedente_resumo: {
        Args: { p_cedente_fundo_id: string }
        Returns: Record<string, unknown>
      }
      dashboard_consultor_resumo: {
        Args: Record<string, never>
        Returns: Record<string, unknown>
      }
      relatorio_gestor_analitico: {
        Args: {
          p_fundo_id: string
          p_mes: string
          p_busca?: string | null
          p_status?: string | null
          p_cedente_id?: string | null
          p_data_inicial?: string | null
          p_data_final?: string | null
          p_offset?: number
          p_page_size?: number
          p_sort?: string
          p_direction?: string
        }
        Returns: Record<string, unknown>
      }
      relatorio_consultor_analitico: {
        Args: {
          p_mes: string
          p_busca?: string | null
          p_status?: string | null
          p_cedente_id?: string | null
          p_data_inicial?: string | null
          p_data_final?: string | null
          p_offset?: number
          p_page_size?: number
          p_sort?: string
          p_direction?: string
        }
        Returns: Record<string, unknown>
      }
      instanciar_requisitos_nota: { Args: { p_nota_fiscal_id: string; p_politica_operacional_id: string; p_politica_versao_id: string }; Returns: Record<string, unknown> }
      listar_documentos_atuais_cedente: { Args: { p_cedente_id: string }; Returns: Array<{ id: string; tipo: string; versao: number; status: string; nome_arquivo: string | null; url_arquivo: string | null; motivo_reprovacao: string | null; created_at: string; representante_id: string | null; analisado_em: string | null; atualizacao_solicitada_em: string | null }> }
      obter_politica_aplicavel_cedente_fundo: { Args: { p_cedente_fundo_id: string; p_data_referencia?: string }; Returns: Record<string, unknown> }
      registrar_documento_upload: { Args: { p_nota_fiscal_id: string; p_requisito_id: string; p_documento_tipo_id: string; p_nome_original: string; p_mime_type: string; p_tamanho_bytes: number; p_sha256: string; p_bucket: string; p_path: string; p_enviado_por: string; p_substitui_versao_id?: string | null }; Returns: Record<string, unknown> }
      registrar_parcelas_nota_fiscal: { Args: { p_nota_fiscal_id: string; p_parcelas: Array<{ numero_parcela: number; valor_nominal: number; data_vencimento: string; origem?: string }> }; Returns: { nota_fiscal_id: string; parcelas_inseridas: number; soma: number } }
      editar_parcelas_nota_fiscal: { Args: { p_nota_fiscal_id: string; p_parcelas: Array<{ id: string; valor_nominal: number; data_vencimento: string }> }; Returns: { nota_fiscal_id: string; parcelas_atualizadas: number; soma: number; vencimento_agregado: string } }
      liberar_parcelas_operacao_rejeitada: { Args: { p_operacao_id: string }; Returns: { operacao_id: string; parcelas_liberadas: number } }
      registrar_documento_boleto_parcela: { Args: { p_nota_fiscal_id: string; p_requisito_id: string; p_documento_tipo_id: string; p_estabelecimento_beneficiario_id: string; p_nome_original: string; p_mime_type: string; p_tamanho_bytes: number; p_sha256: string; p_bucket: string; p_path: string; p_enviado_por: string; p_substitui_versao_id?: string | null }; Returns: Record<string, unknown> }
      analisar_documento_boleto_gestor: { Args: { p_documento_versao_id: string; p_resultado: string; p_observacoes?: string | null }; Returns: Record<string, unknown> }
      registrar_duplicata_versao: { Args: Record<string, unknown>; Returns: Array<{ duplicata_id: string; duplicata_versao_id: string; numero_versao: number }> }
      corrigir_duplicata: { Args: { p_duplicata_id: string; p_campos: Record<string, unknown>; p_motivo: string; p_resultado_confronto: import('@/lib/duplicatas/types').ResultadoConfrontoDuplicata }; Returns: Record<string, unknown> }
      validar_duplicata: { Args: { p_duplicata_id: string; p_resultado: 'VALIDADA' | 'REJEITADA'; p_observacoes: string | null; p_resultado_confronto: Record<string, unknown> }; Returns: Record<string, unknown> }
      registrar_documento_entrega_upload: { Args: { p_nota_fiscal_entrega_id: string; p_requisito_id: string; p_documento_tipo_id: string; p_nome_original: string; p_mime_type: string; p_tamanho_bytes: number; p_sha256: string; p_bucket: string; p_path: string; p_enviado_por: string; p_substitui_versao_id?: string | null }; Returns: Record<string, unknown> }
      registrar_documento_logistico_antecipado: { Args: { p_nota_fiscal_ids: string[]; p_politica_requisito_id: string; p_documento_tipo_codigo: string; p_nome_original: string; p_mime_type: string; p_tamanho_bytes: number; p_sha256: string; p_bucket: string; p_path: string; p_dados_logisticos?: Record<string, unknown> }; Returns: Record<string, unknown> }
      avaliar_gate_logistico_pre_cessao_nfs: { Args: { p_nota_fiscal_ids: string[] }; Returns: Array<{ nota_fiscal_id: string; politica_operacional_versao_id: string | null; gate_exigido: boolean; status: string; permitido: boolean }> }
      excluir_notas_fiscais_rascunho_cedente: { Args: { p_nota_fiscal_ids: string[] }; Returns: { ids_excluidos: string[]; total_excluido: number; storage_objects: Array<{ bucket: string; path: string }> } }
      analisar_documento_versao: { Args: { p_documento_versao_id: string; p_resultado: string; p_observacoes?: string | null; p_dados_estruturados?: Record<string, unknown> }; Returns: Record<string, unknown> }
      processar_aceite_sacado: { Args: { p_nota_fiscal_ids: string[]; p_acao: string; p_motivo?: string | null }; Returns: Record<string, unknown> }
      solicitar_operacao_antecipacao_atomica: { Args: { p_cedente_id: string; p_cedente_fundo_id: string; p_politica_operacional_id: string; p_politica_operacional_versao_id: string; p_politica_versao: number; p_politica_snapshot: Record<string, unknown>; p_politica_snapshot_hash: string; p_aceite_sacado_exigido: boolean; p_aceite_sacado_status: string; p_nota_fiscal_ids: string[]; p_valor_bruto_total: number; p_taxa_desconto: number | null; p_prazo_dias: number; p_valor_liquido_desembolso: number | null; p_data_vencimento: string; p_idempotency_key: string }; Returns: Record<string, unknown> }
      simular_memoria_financeira_operacao: { Args: { p_operacao_id: string; p_taxa_desconto: number }; Returns: Record<string, unknown> }
      persistir_risco_execucao: { Args: { p_payload: Record<string, unknown> }; Returns: string }
      decidir_revisao_risco: { Args: { p_revisao_id: string; p_decisao: string; p_justificativa: string; p_correlation_id: string }; Returns: boolean }
      aprovar_operacao_com_risco_atomica: { Args: { p_operacao_id: string; p_taxa_desconto: number; p_risco_execucao_id: string; p_assinatura_inputs: string }; Returns: Record<string, unknown> }
      desembolsar_operacao_com_logistica: { Args: { p_operacao_id: string }; Returns: Record<string, unknown> }
      registrar_cte_documento: { Args: { p_nota_fiscal_ids: string[]; p_documento_tipo_codigo: string; p_nome_original: string; p_mime_type: string; p_tamanho_bytes: number; p_sha256: string; p_bucket: string; p_path: string; p_chave_cte?: string | null; p_numero?: string | null; p_serie?: string | null; p_data_emissao?: string | null; p_cnpj_transportadora?: string | null; p_cnpj_remetente?: string | null; p_cnpj_destinatario?: string | null; p_valor_frete?: number | null; p_nivel_validacao?: string; p_dados_extraidos?: Record<string, unknown>; p_tomador_cnpj?: string | null; p_tomador_classificacao?: string | null; p_vinculos_remessa?: unknown[] }; Returns: Record<string, unknown> }
      registrar_nota_fiscal_remessa: { Args: { p_nota_fiscal_venda_id: string; p_chave_acesso: string; p_numero?: string | null; p_serie?: string | null; p_emitente_cnpj?: string | null; p_emitente_razao_social?: string | null; p_destinatario_cnpj?: string | null; p_destinatario_razao_social?: string | null; p_data_emissao?: string | null; p_valor_total: number; p_quantidade_total?: number | null; p_itens?: unknown[]; p_status_validacao: string; p_referencia_nf_venda_confirmada: boolean; p_motivos_validacao?: unknown[]; p_bucket: string; p_path: string; p_nome_original: string; p_mime_type: string; p_tamanho_bytes: number; p_sha256: string }; Returns: { id: string; status_validacao: string; nota_fiscal_venda_id: string; aprovacao_documental: string | null; atualizacao: boolean; numero_versao: number } }
      analisar_nota_fiscal_remessa: { Args: { p_nota_fiscal_remessa_id: string; p_resultado: string; p_motivo?: string | null }; Returns: { id: string; aprovacao_documental: string; nota_fiscal_venda_id: string } }
      registrar_canhoto_documento: { Args: { p_nota_fiscal_entrega_id: string; p_nome_original: string; p_mime_type: string; p_tamanho_bytes: number; p_sha256: string; p_bucket: string; p_path: string; p_data_assinatura?: string | null; p_nome_recebedor?: string | null; p_documento_recebedor?: string | null; p_possui_assinatura?: boolean; p_possui_ressalva?: boolean; p_descricao_ressalva?: string | null; p_nota_fiscal_remessa_id?: string | null }; Returns: Record<string, unknown> }
      comunicar_postergacao_upload_canhoto: { Args: { p_nota_fiscal_id: string; p_nova_previsao: string; p_motivo: string }; Returns: Record<string, unknown> }
      analisar_cte_documento: { Args: { p_cte_id: string; p_documento_versao_id: string; p_resultado: string; p_motivo?: string | null }; Returns: Record<string, unknown> }
      revalidar_cte_nota_fiscal: { Args: { p_cte_id: string; p_nota_fiscal_id: string }; Returns: Record<string, unknown> }
      analisar_canhoto_documento: { Args: { p_canhoto_id: string; p_documento_versao_id: string; p_resultado: string; p_motivo?: string | null }; Returns: Record<string, unknown> }
      processar_prazos_entrega: { Args: { p_data?: string | null }; Returns: Record<string, unknown> }
      reparar_requisitos_pos_cessao_operacao: { Args: { p_operacao_id: string }; Returns: Record<string, unknown> }
      reservar_sequencial_remessa: { Args: { p_configuracao_cnab_id: string; p_data_referencia: string }; Returns: number }
      usuario_pode_ler_remessa_cnab: { Args: { p_remessa_id: string }; Returns: boolean }
      registrar_sessao_mfa_atual: { Args: { p_factor_id: string }; Returns: Array<{ session_id: string; elevada_em: string; expira_em: string }> }
      obter_sessao_mfa_atual: { Args: Record<string, never>; Returns: Array<{ session_id: string | null; status: string; elevada_em: string | null; expira_em: string | null; server_now: string; metodo: string | null; factor_id: string | null }> }
      revogar_sessao_mfa_atual: { Args: { p_motivo?: string }; Returns: boolean }
      criar_autorizacao_acao_sensivel: { Args: { p_action_type: string; p_nonce_hash: string }; Returns: Array<{ expira_em: string }> }
      consumir_autorizacao_acao_sensivel: { Args: { p_action_type: string; p_nonce_hash: string }; Returns: boolean }
    }
    Enums: {
      user_role: UserRole
      user_status: UserStatus
      cedente_status: CedenteStatus
      documento_tipo: DocumentoTipo
      documento_status: DocumentoStatus
      conta_escrow_status: ContaEscrowStatus
      movimento_tipo: MovimentoTipo
      nf_status: NfStatus
      operacao_status: OperacaoStatus
      tipo_conta_bancaria: TipoContaBancaria
    }
  }
}
