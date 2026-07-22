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
  created_at: string
  updated_at: string
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
  created_at: string
  updated_at: string
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
  cedente_fundo_id: string
  codigo: string
  nome: string
  descricao: string | null
  status: PoliticaStatus
  created_by: string
  created_at: string
  updated_at: string
}

export interface PoliticaOperacionalVersao {
  id: string
  politica_operacional_id: string
  cedente_fundo_id: string
  versao: number
  vigente_desde: string
  vigente_ate: string | null
  aceite_sacado_obrigatorio: boolean
  cessao_no_desembolso: boolean
  cria_acompanhamento_entrega: boolean
  configuracao: Record<string, unknown>
  conteudo_hash: string
  publicada_por: string | null
  publicada_em: string | null
  created_at: string
}

export interface PoliticaRequisitoDocumental {
  id: string
  politica_operacional_versao_id: string
  politica_operacional_id: string
  cedente_fundo_id: string
  codigo: string
  escopo: PoliticaRequisitoEscopo
  tipo_documento_codigo: PoliticaTipoDocumentoCodigo
  documento_tipo_id: string | null
  obrigatorio: boolean
  quantidade_minima: number
  formatos_aceitos: string[]
  nivel_validacao: PoliticaNivelValidacao
  prazo_dias_corridos: number | null
  responsavel_upload: PoliticaResponsavel
  responsavel_aprovacao: PoliticaResponsavel
  ordem: number
  ativo: boolean
  created_at: string
}

export interface DocumentoTipoRepositorio {
  id: string
  codigo: string
  nome: string
  dominio: string
  mime_types_aceitos: string[]
  extensoes_aceitas: string[]
  tamanho_max_bytes: number
  permite_multiplas_versoes: boolean
  ativo: boolean
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
}

export interface DocumentoVinculo {
  id: string
  documento_id: string
  nota_fiscal_id: string | null
  operacao_id: string | null
  nota_fiscal_entrega_id: string | null
  cte_id: string | null
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

export interface Cte {
  id: string
  cedente_id: string
  chave_cte: string | null
  numero: string | null
  serie: string | null
  data_emissao: string | null
  cnpj_transportadora: string | null
  cnpj_remetente: string | null
  cnpj_destinatario: string | null
  valor_frete: number | null
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
  created_at: string
  updated_at: string
}

export interface CteNotaFiscal {
  cte_id: string
  nota_fiscal_id: string
  created_at: string
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
  secret_name: string | null
  vault_key: string | null
  vigente_desde: string
  vigente_ate: string | null
  publicada_por: string | null
  publicada_em: string | null
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
  condicao_pagamento: string | null
  arquivo_url: string | null
  status: NfStatus
  pedido_sap: string | null
  status_sap: string | null
  taxa_desagio: number | null
  valor_antecipado: number | null
  aprovacao_sacado_em: string | null
  aprovada_gestor_em: string | null
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
  politica_versao: number | null
  politica_snapshot: Record<string, unknown> | null
  politica_snapshot_hash: string | null
  contexto_configuracao_status: ContextoConfiguracaoStatus | null
  contexto_capturado_em: string | null
  aceite_sacado_exigido: boolean | null
  aceite_sacado_status: AceiteSacadoStatus | null
  aceite_sacado_em: string | null
  cessao_efetivada_em: string | null
  valor_bruto_total: number
  taxa_desconto: number
  prazo_dias: number
  valor_liquido_desembolso: number
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
  aal: 'aal2'
  metodo: 'totp' | 'recovery_code' | 'admin_reset'
  factor_id: string | null
  elevada_em: string
  expira_em: string
  created_at: string
  updated_at: string
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
  lida: boolean
  created_at: string
}

export interface Database {
  public: {
    Tables: {
      profiles: { Row: Profile & Record<string, unknown>; Insert: InsertShape<Profile, 'id' | 'nome_completo' | 'email'> & Record<string, unknown>; Update: UpdateShape<Profile> & Record<string, unknown>; Relationships: [] }
      cedentes: { Row: Cedente & Record<string, unknown>; Insert: InsertShape<Cedente, 'user_id' | 'cnpj' | 'razao_social'> & Record<string, unknown>; Update: UpdateShape<Cedente> & Record<string, unknown>; Relationships: [] }
      documento_tipos: { Row: DocumentoTipoRepositorio & Record<string, unknown>; Insert: InsertShape<DocumentoTipoRepositorio, 'codigo' | 'nome' | 'dominio'> & Record<string, unknown>; Update: UpdateShape<DocumentoTipoRepositorio> & Record<string, unknown>; Relationships: [] }
      documentos_repositorio: { Row: DocumentoRepositorio & Record<string, unknown>; Insert: InsertShape<DocumentoRepositorio, 'documento_tipo_id' | 'criado_por'> & Record<string, unknown>; Update: UpdateShape<DocumentoRepositorio> & Record<string, unknown>; Relationships: [] }
      documento_versoes: { Row: DocumentoVersao & Record<string, unknown>; Insert: InsertShape<DocumentoVersao, 'documento_id' | 'nome_original' | 'mime_type' | 'tamanho_bytes' | 'sha256' | 'enviado_por'> & Record<string, unknown>; Update: UpdateShape<DocumentoVersao> & Record<string, unknown>; Relationships: [] }
      documento_vinculos: { Row: DocumentoVinculo & Record<string, unknown>; Insert: InsertShape<DocumentoVinculo, 'documento_id' | 'cedente_id'> & Record<string, unknown>; Update: UpdateShape<DocumentoVinculo> & Record<string, unknown>; Relationships: [] }
      documento_requisito_instancias: { Row: DocumentoRequisitoInstancia & Record<string, unknown>; Insert: InsertShape<DocumentoRequisitoInstancia, 'politica_requisito_id' | 'politica_operacional_id' | 'politica_operacional_versao_id' | 'politica_versao' | 'tipo_documento_codigo_snapshot' | 'escopo_snapshot' | 'nota_fiscal_id' | 'cedente_id' | 'obrigatorio' | 'nivel_validacao_snapshot' | 'quantidade_minima_snapshot' | 'responsavel_upload_snapshot' | 'responsavel_aprovacao_snapshot'> & Record<string, unknown>; Update: UpdateShape<DocumentoRequisitoInstancia> & Record<string, unknown>; Relationships: [] }
      documento_analises: { Row: DocumentoAnalise & Record<string, unknown>; Insert: InsertShape<DocumentoAnalise, 'documento_versao_id' | 'resultado'> & Record<string, unknown>; Update: UpdateShape<DocumentoAnalise> & Record<string, unknown>; Relationships: [] }
      nota_fiscal_entregas: { Row: NotaFiscalEntrega & Record<string, unknown>; Insert: InsertShape<NotaFiscalEntrega, 'operacao_id' | 'nota_fiscal_id' | 'status_entrega'> & Record<string, unknown>; Update: UpdateShape<NotaFiscalEntrega> & Record<string, unknown>; Relationships: [] }
      eventos_entrega: { Row: EventoEntrega & Record<string, unknown>; Insert: InsertShape<EventoEntrega, 'nota_fiscal_entrega_id' | 'tipo_evento'> & Record<string, unknown>; Update: UpdateShape<EventoEntrega> & Record<string, unknown>; Relationships: [] }
      ctes: { Row: Cte & Record<string, unknown>; Insert: InsertShape<Cte, 'cedente_id' | 'formato_origem' | 'nivel_validacao'> & Record<string, unknown>; Update: UpdateShape<Cte> & Record<string, unknown>; Relationships: [] }
      cte_notas_fiscais: { Row: CteNotaFiscal & Record<string, unknown>; Insert: InsertShape<CteNotaFiscal, 'cte_id' | 'nota_fiscal_id'> & Record<string, unknown>; Update: Partial<CteNotaFiscal> & Record<string, unknown>; Relationships: [] }
      canhotos: { Row: Canhoto & Record<string, unknown>; Insert: InsertShape<Canhoto, 'nota_fiscal_entrega_id'> & Record<string, unknown>; Update: UpdateShape<Canhoto> & Record<string, unknown>; Relationships: [] }
      templates_documentos: { Row: TemplateDocumento & Record<string, unknown>; Insert: InsertShape<TemplateDocumento, 'fundo_id' | 'codigo' | 'tipo_documento' | 'nome' | 'created_by'> & Record<string, unknown>; Update: UpdateShape<TemplateDocumento> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'templates_documentos_fundo_id_fkey'; columns: ['fundo_id']; isOneToOne: false; referencedRelation: 'fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'templates_documentos_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      template_versoes: { Row: TemplateVersao & Record<string, unknown>; Insert: InsertShape<TemplateVersao, 'template_id' | 'versao' | 'vigente_desde' | 'conteudo_html' | 'sha256'> & Record<string, unknown>; Update: UpdateShape<TemplateVersao> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'template_versoes_template_id_fkey'; columns: ['template_id']; isOneToOne: false; referencedRelation: 'templates_documentos'; referencedColumns: ['id'] }, { foreignKeyName: 'template_versoes_publicada_por_fkey'; columns: ['publicada_por']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      documentos_gerados: { Row: DocumentoGerado & Record<string, unknown>; Insert: InsertShape<DocumentoGerado, 'operacao_id' | 'cedente_id' | 'fundo_id' | 'template_id' | 'template_versao_id' | 'template_versao' | 'template_hash' | 'tipo_documento' | 'storage_path' | 'sha256'> & Record<string, unknown>; Update: UpdateShape<DocumentoGerado> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'documentos_gerados_operacao_id_fkey'; columns: ['operacao_id']; isOneToOne: false; referencedRelation: 'operacoes'; referencedColumns: ['id'] }, { foreignKeyName: 'documentos_gerados_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }, { foreignKeyName: 'documentos_gerados_fundo_id_fkey'; columns: ['fundo_id']; isOneToOne: false; referencedRelation: 'fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'documentos_gerados_template_id_fkey'; columns: ['template_id']; isOneToOne: false; referencedRelation: 'templates_documentos'; referencedColumns: ['id'] }, { foreignKeyName: 'documentos_gerados_template_versao_id_fkey'; columns: ['template_versao_id']; isOneToOne: false; referencedRelation: 'template_versoes'; referencedColumns: ['id'] }] }
      configuracoes_cnab: { Row: ConfiguracaoCnab & Record<string, unknown>; Insert: InsertShape<ConfiguracaoCnab, 'fundo_id' | 'codigo' | 'nome' | 'created_by'> & Record<string, unknown>; Update: UpdateShape<ConfiguracaoCnab> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'configuracoes_cnab_fundo_id_fkey'; columns: ['fundo_id']; isOneToOne: false; referencedRelation: 'fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'configuracoes_cnab_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      configuracao_cnab_versoes: { Row: ConfiguracaoCnabVersao & Record<string, unknown>; Insert: InsertShape<ConfiguracaoCnabVersao, 'configuracao_cnab_id' | 'versao' | 'vigente_desde' | 'layout' | 'versao_layout' | 'codigo_banco' | 'banco' | 'agencia' | 'conta' | 'digito_conta' | 'carteira' | 'convenio' | 'codigo_originador' | 'codigo_empresa' | 'tipo_inscricao' | 'numero_inscricao' | 'especie_titulo' | 'tipo_recebivel' | 'conteudo_hash'> & Record<string, unknown>; Update: UpdateShape<ConfiguracaoCnabVersao> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'configuracao_cnab_versoes_configuracao_cnab_id_fkey'; columns: ['configuracao_cnab_id']; isOneToOne: false; referencedRelation: 'configuracoes_cnab'; referencedColumns: ['id'] }, { foreignKeyName: 'configuracao_cnab_versoes_publicada_por_fkey'; columns: ['publicada_por']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      integracoes_fundo: { Row: IntegracaoFundo & Record<string, unknown>; Insert: InsertShape<IntegracaoFundo, 'fundo_id' | 'provedor' | 'nome' | 'created_by'> & Record<string, unknown>; Update: UpdateShape<IntegracaoFundo> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'integracoes_fundo_fundo_id_fkey'; columns: ['fundo_id']; isOneToOne: false; referencedRelation: 'fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'integracoes_fundo_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      integracao_fundo_versoes: { Row: IntegracaoFundoVersao & Record<string, unknown>; Insert: InsertShape<IntegracaoFundoVersao, 'integracao_fundo_id' | 'versao' | 'ambiente' | 'identificador_cliente' | 'endpoint_base' | 'credential_ref' | 'vigente_desde'> & Record<string, unknown>; Update: UpdateShape<IntegracaoFundoVersao> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'integracao_fundo_versoes_integracao_fundo_id_fkey'; columns: ['integracao_fundo_id']; isOneToOne: false; referencedRelation: 'integracoes_fundo'; referencedColumns: ['id'] }, { foreignKeyName: 'integracao_fundo_versoes_publicada_por_fkey'; columns: ['publicada_por']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
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
      politicas_operacionais: { Row: PoliticaOperacional & Record<string, unknown>; Insert: InsertShape<PoliticaOperacional, 'cedente_fundo_id' | 'codigo' | 'nome' | 'created_by'> & Record<string, unknown>; Update: UpdateShape<PoliticaOperacional> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'politicas_operacionais_cedente_fundo_id_fkey'; columns: ['cedente_fundo_id']; isOneToOne: false; referencedRelation: 'cedente_fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'politicas_operacionais_created_by_fkey'; columns: ['created_by']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      politica_operacional_versoes: { Row: PoliticaOperacionalVersao & Record<string, unknown>; Insert: InsertShape<PoliticaOperacionalVersao, 'politica_operacional_id' | 'cedente_fundo_id' | 'versao' | 'vigente_desde' | 'conteudo_hash'> & Record<string, unknown>; Update: UpdateShape<PoliticaOperacionalVersao> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'politica_operacional_versoes_politica_operacional_id_fkey'; columns: ['politica_operacional_id']; isOneToOne: false; referencedRelation: 'politicas_operacionais'; referencedColumns: ['id'] }, { foreignKeyName: 'politica_operacional_versoes_cedente_fundo_id_fkey'; columns: ['cedente_fundo_id']; isOneToOne: false; referencedRelation: 'cedente_fundos'; referencedColumns: ['id'] }, { foreignKeyName: 'politica_operacional_versoes_publicada_por_fkey'; columns: ['publicada_por']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      politica_requisitos_documentais: { Row: PoliticaRequisitoDocumental & Record<string, unknown>; Insert: InsertShape<PoliticaRequisitoDocumental, 'politica_operacional_versao_id' | 'politica_operacional_id' | 'cedente_fundo_id' | 'codigo' | 'escopo' | 'tipo_documento_codigo' | 'responsavel_upload' | 'responsavel_aprovacao'> & Record<string, unknown>; Update: UpdateShape<PoliticaRequisitoDocumental> & Record<string, unknown>; Relationships: [] }
      devedores_solidarios: { Row: DevedorSolidario & Record<string, unknown>; Insert: InsertShape<DevedorSolidario, 'cedente_id' | 'nome' | 'doc_numero' | 'cpf'> & Record<string, unknown>; Update: UpdateShape<DevedorSolidario> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'devedores_solidarios_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      notas_fiscais: { Row: NotaFiscal & Record<string, unknown>; Insert: InsertShape<NotaFiscal, 'cedente_id' | 'numero_nf' | 'data_emissao' | 'data_vencimento' | 'cnpj_emitente' | 'razao_social_emitente' | 'cnpj_destinatario' | 'razao_social_destinatario' | 'valor_bruto'> & Record<string, unknown>; Update: UpdateShape<NotaFiscal> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'notas_fiscais_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      operacoes: { Row: Operacao & Record<string, unknown>; Insert: InsertShape<Operacao, 'cedente_id' | 'valor_bruto_total' | 'taxa_desconto' | 'prazo_dias' | 'valor_liquido_desembolso' | 'data_vencimento'> & Record<string, unknown>; Update: UpdateShape<Operacao> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'operacoes_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }, { foreignKeyName: 'operacoes_conta_escrow_id_fkey'; columns: ['conta_escrow_id']; isOneToOne: false; referencedRelation: 'contas_escrow'; referencedColumns: ['id'] }, { foreignKeyName: 'operacoes_aprovado_por_fkey'; columns: ['aprovado_por']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }, { foreignKeyName: 'operacoes_testemunha_1_id_fkey'; columns: ['testemunha_1_id']; isOneToOne: false; referencedRelation: 'testemunhas'; referencedColumns: ['id'] }, { foreignKeyName: 'operacoes_testemunha_2_id_fkey'; columns: ['testemunha_2_id']; isOneToOne: false; referencedRelation: 'testemunhas'; referencedColumns: ['id'] }] }
      operacoes_nfs: { Row: OperacaoNf & Record<string, unknown>; Insert: OperacaoNf & Record<string, unknown>; Update: Partial<OperacaoNf> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'operacoes_nfs_operacao_id_fkey'; columns: ['operacao_id']; isOneToOne: false; referencedRelation: 'operacoes'; referencedColumns: ['id'] }, { foreignKeyName: 'operacoes_nfs_nota_fiscal_id_fkey'; columns: ['nota_fiscal_id']; isOneToOne: false; referencedRelation: 'notas_fiscais'; referencedColumns: ['id'] }] }
      taxas_cedente: { Row: TaxaCedente & Record<string, unknown>; Insert: InsertShape<TaxaCedente, 'cedente_id' | 'prazo_min' | 'prazo_max' | 'taxa_percentual'> & Record<string, unknown>; Update: UpdateShape<TaxaCedente> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'taxas_cedente_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      consultor_cedente: { Row: ConsultorCedente & Record<string, unknown>; Insert: InsertShape<ConsultorCedente, 'consultor_id' | 'cedente_id'> & Record<string, unknown>; Update: UpdateShape<ConsultorCedente> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'consultor_cedente_consultor_id_fkey'; columns: ['consultor_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }, { foreignKeyName: 'consultor_cedente_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      sacados: { Row: Sacado & Record<string, unknown>; Insert: InsertShape<Sacado, 'user_id' | 'cnpj' | 'razao_social'> & Record<string, unknown>; Update: UpdateShape<Sacado> & Record<string, unknown>; Relationships: [] }
      testemunhas: { Row: Testemunha & Record<string, unknown>; Insert: InsertShape<Testemunha, 'nome' | 'cpf'> & Record<string, unknown>; Update: UpdateShape<Testemunha> & Record<string, unknown>; Relationships: [] }
      solicitacoes_alteracao_cedente: { Row: SolicitacaoAlteracaoCedente & Record<string, unknown>; Insert: InsertShape<SolicitacaoAlteracaoCedente, 'cedente_id' | 'dados_atuais' | 'dados_propostos'> & Record<string, unknown>; Update: UpdateShape<SolicitacaoAlteracaoCedente> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'solicitacoes_alteracao_cedente_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }] }
      cedente_acessos: { Row: CedenteAcesso & Record<string, unknown>; Insert: InsertShape<CedenteAcesso, 'cedente_id' | 'user_id'> & Record<string, unknown>; Update: UpdateShape<CedenteAcesso> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'cedente_acessos_cedente_id_fkey'; columns: ['cedente_id']; isOneToOne: false; referencedRelation: 'cedentes'; referencedColumns: ['id'] }, { foreignKeyName: 'cedente_acessos_user_id_fkey'; columns: ['user_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      logs_auditoria: { Row: LogAuditoria & Record<string, unknown>; Insert: InsertShape<LogAuditoria, 'tipo_evento' | 'entidade_tipo' | 'ator_tipo' | 'origem'> & Record<string, unknown>; Update: UpdateShape<LogAuditoria> & Record<string, unknown>; Relationships: [{ foreignKeyName: 'logs_auditoria_usuario_id_fkey'; columns: ['usuario_id']; isOneToOne: false; referencedRelation: 'profiles'; referencedColumns: ['id'] }] }
      notificacoes: { Row: Notificacao & Record<string, unknown>; Insert: InsertShape<Notificacao, 'usuario_id' | 'titulo' | 'mensagem' | 'tipo'> & Record<string, unknown>; Update: UpdateShape<Notificacao> & Record<string, unknown>; Relationships: [] }
    }
    Views: Record<string, never>
    Functions: {
      get_user_role: { Args: Record<string, never>; Returns: string }
      get_user_cedente_id: { Args: Record<string, never>; Returns: string | null }
      get_user_sacado_cnpj: { Args: Record<string, never>; Returns: string | null }
      get_user_operacao_ids: { Args: Record<string, never>; Returns: string[] }
      instanciar_requisitos_nota: { Args: { p_nota_fiscal_id: string; p_politica_operacional_id: string; p_politica_versao_id: string }; Returns: Record<string, unknown> }
      registrar_documento_upload: { Args: { p_nota_fiscal_id: string; p_requisito_id: string; p_documento_tipo_id: string; p_nome_original: string; p_mime_type: string; p_tamanho_bytes: number; p_sha256: string; p_bucket: string; p_path: string; p_enviado_por: string; p_substitui_versao_id?: string | null }; Returns: Record<string, unknown> }
      analisar_documento_versao: { Args: { p_documento_versao_id: string; p_resultado: string; p_observacoes?: string | null; p_dados_estruturados?: Record<string, unknown> }; Returns: Record<string, unknown> }
      processar_aceite_sacado: { Args: { p_nota_fiscal_ids: string[]; p_acao: string; p_motivo?: string | null }; Returns: Record<string, unknown> }
      desembolsar_operacao_com_logistica: { Args: { p_operacao_id: string }; Returns: Record<string, unknown> }
      registrar_cte_documento: { Args: { p_nota_fiscal_ids: string[]; p_documento_tipo_codigo: string; p_nome_original: string; p_mime_type: string; p_tamanho_bytes: number; p_sha256: string; p_bucket: string; p_path: string; p_chave_cte?: string | null; p_numero?: string | null; p_serie?: string | null; p_data_emissao?: string | null; p_cnpj_transportadora?: string | null; p_cnpj_remetente?: string | null; p_cnpj_destinatario?: string | null; p_valor_frete?: number | null; p_nivel_validacao?: string; p_dados_extraidos?: Record<string, unknown> }; Returns: Record<string, unknown> }
      registrar_canhoto_documento: { Args: { p_nota_fiscal_entrega_id: string; p_nome_original: string; p_mime_type: string; p_tamanho_bytes: number; p_sha256: string; p_bucket: string; p_path: string; p_data_assinatura?: string | null; p_nome_recebedor?: string | null; p_documento_recebedor?: string | null; p_possui_assinatura?: boolean; p_possui_ressalva?: boolean; p_descricao_ressalva?: string | null }; Returns: Record<string, unknown> }
      analisar_cte_documento: { Args: { p_cte_id: string; p_documento_versao_id: string; p_resultado: string; p_motivo?: string | null }; Returns: Record<string, unknown> }
      analisar_canhoto_documento: { Args: { p_canhoto_id: string; p_documento_versao_id: string; p_resultado: string; p_motivo?: string | null }; Returns: Record<string, unknown> }
      processar_prazos_entrega: { Args: { p_data?: string | null }; Returns: Record<string, unknown> }
      reservar_sequencial_remessa: { Args: { p_configuracao_cnab_id: string; p_data_referencia: string }; Returns: number }
      usuario_pode_ler_remessa_cnab: { Args: { p_remessa_id: string }; Returns: boolean }
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
