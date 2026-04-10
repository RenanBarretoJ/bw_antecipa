-- ============================================================
-- BW Antecipa - Schema Completo do Banco de Dados
-- Sistema de Antecipação de Recebíveis por Cessão de NF
-- ============================================================

-- ============================================================
-- 1. ENUMS
-- ============================================================

CREATE TYPE user_role AS ENUM ('gestor', 'cedente', 'sacado', 'consultor');
CREATE TYPE user_status AS ENUM ('ativo', 'inativo', 'bloqueado');
CREATE TYPE cedente_status AS ENUM ('pendente', 'em_analise', 'ativo', 'reprovado', 'bloqueado');
CREATE TYPE documento_tipo AS ENUM (
  'contrato_social', 'cartao_cnpj', 'rg_cpf', 'comprovante_endereco',
  'extrato_bancario', 'balanco_patrimonial', 'dre', 'procuracao', 'comprovante_de_renda'
);
CREATE TYPE documento_status AS ENUM ('aguardando_envio', 'enviado', 'em_analise', 'aprovado', 'reprovado');
CREATE TYPE conta_escrow_status AS ENUM ('ativa', 'bloqueada', 'encerrada');
CREATE TYPE movimento_tipo AS ENUM ('credito', 'debito');
CREATE TYPE nf_status AS ENUM (
  'rascunho', 'submetida', 'em_analise', 'aprovada',
  'em_antecipacao', 'aceita', 'contestada', 'liquidada', 'cancelada'
);
CREATE TYPE operacao_status AS ENUM (
  'solicitada', 'em_analise', 'aprovada', 'em_andamento',
  'liquidada', 'inadimplente', 'reprovada', 'cancelada'
);
CREATE TYPE tipo_conta_bancaria AS ENUM ('corrente', 'poupanca');

-- ============================================================
-- 2. FUNÇÕES AUXILIARES
-- ============================================================

-- Função para pegar a role do usuário logado (usada nas policies RLS)
-- Usa plpgsql para evitar validação de tabelas em tempo de criação
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text AS $$
BEGIN
  RETURN (SELECT role::text FROM profiles WHERE id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Função para pegar o cedente_id do usuário logado
CREATE OR REPLACE FUNCTION get_user_cedente_id()
RETURNS uuid AS $$
BEGIN
  RETURN (SELECT c.id FROM cedentes c WHERE c.user_id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Função para pegar o CNPJ do sacado logado
CREATE OR REPLACE FUNCTION get_user_sacado_cnpj()
RETURNS text AS $$
BEGIN
  RETURN (SELECT s.cnpj FROM sacados s WHERE s.user_id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Função para pegar IDs de operações do cedente logado (evita recursão em RLS)
CREATE OR REPLACE FUNCTION get_user_operacao_ids()
RETURNS SETOF uuid AS $$
BEGIN
  RETURN QUERY SELECT id FROM operacoes WHERE cedente_id = get_user_cedente_id();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Função para atualizar updated_at automaticamente
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 3. TABELAS
-- ============================================================

-- PROFILES
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role user_role NOT NULL DEFAULT 'cedente',
  nome_completo text NOT NULL,
  email text NOT NULL,
  telefone text,
  status user_status NOT NULL DEFAULT 'ativo',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- CEDENTES
CREATE TABLE cedentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cnpj text NOT NULL UNIQUE,
  razao_social text NOT NULL,
  nome_fantasia text,
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  estado text,
  telefone_comercial text,
  email_comercial text,
  cnae text,
  nome_representante text,
  cpf_representante text,
  rg_representante text,
  cargo_representante text,
  email_representante text,
  telefone_representante text,
  banco text,
  agencia text,
  conta text,
  tipo_conta tipo_conta_bancaria,
  status cedente_status NOT NULL DEFAULT 'pendente',
  fundo_id uuid,
  sacado_razao_social text,
  sacado_cnpj text,
  sacado_descricao text,
  sacado_banco_escrow text,
  sacado_conta_escrow text,
  sacado_agencia_escrow text,
  sacado_tipo_conta_escrow text DEFAULT 'Conta Escrow',
  contrato_url text,
  contrato_gerado_em timestamptz,
  testemunha_1_nome text DEFAULT 'BRENO JOSE ALVIM DA SILVA',
  testemunha_1_cpf text DEFAULT '378.341.578-09',
  testemunha_2_nome text DEFAULT 'KAIO MIGUEL RUIZ',
  testemunha_2_cpf text DEFAULT '423.679.188-99',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER cedentes_updated_at
  BEFORE UPDATE ON cedentes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- DOCUMENTOS
CREATE TABLE documentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_id uuid NOT NULL REFERENCES cedentes(id) ON DELETE CASCADE,
  tipo documento_tipo NOT NULL,
  versao integer NOT NULL DEFAULT 1,
  status documento_status NOT NULL DEFAULT 'aguardando_envio',
  url_arquivo text,
  nome_arquivo text,
  motivo_reprovacao text,
  analisado_por uuid REFERENCES profiles(id),
  analisado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER documentos_updated_at
  BEFORE UPDATE ON documentos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- 2.X REPRESENTANTES LEGAIS
-- ============================================================
CREATE TABLE representantes (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_id uuid        NOT NULL REFERENCES cedentes(id) ON DELETE CASCADE,
  nome       text        NOT NULL,
  cpf        text        NOT NULL,
  rg         text        NOT NULL,
  cargo      text        NOT NULL,
  email      text        NOT NULL,
  telefone   text        NOT NULL,
  principal  boolean     NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER representantes_updated_at
  BEFORE UPDATE ON representantes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE documentos
  ADD COLUMN representante_id uuid REFERENCES representantes(id) ON DELETE SET NULL;

-- CONTAS ESCROW
CREATE TABLE contas_escrow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_id uuid NOT NULL REFERENCES cedentes(id) ON DELETE CASCADE,
  identificador text NOT NULL UNIQUE,
  saldo_disponivel numeric NOT NULL DEFAULT 0,
  saldo_bloqueado numeric NOT NULL DEFAULT 0,
  status conta_escrow_status NOT NULL DEFAULT 'ativa',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER contas_escrow_updated_at
  BEFORE UPDATE ON contas_escrow
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- MOVIMENTOS ESCROW
CREATE TABLE movimentos_escrow (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conta_escrow_id uuid NOT NULL REFERENCES contas_escrow(id) ON DELETE CASCADE,
  tipo movimento_tipo NOT NULL,
  descricao text NOT NULL,
  valor numeric NOT NULL CHECK (valor > 0),
  saldo_apos numeric NOT NULL,
  operacao_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- FUNDOS
CREATE TABLE fundos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL,
  cnpj text NOT NULL,
  administradora_nome text NOT NULL,
  administradora_cnpj text NOT NULL,
  gestora_nome text NOT NULL DEFAULT 'BLUEWAVE ASSET LTDA',
  gestora_cnpj text NOT NULL DEFAULT '13.703.306/0001-56',
  custodiante_nome text NOT NULL DEFAULT 'TERRA INVESTIMENTOS DISTRIBUIDORA DE TITULOS E VALORES MOBILIARIOS LTDA',
  custodiante_cnpj text NOT NULL DEFAULT '03.751.794/0001-13',
  conta_vinculada text,
  agencia text,
  banco text,
  administradora_endereco text,
  administradora_ato_declaratorio text,
  contato_nome text,
  contato_email text,
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- FK cedentes -> fundos
ALTER TABLE cedentes ADD CONSTRAINT cedentes_fundo_id_fkey FOREIGN KEY (fundo_id) REFERENCES fundos(id);

-- DEVEDORES SOLIDARIOS
CREATE TABLE devedores_solidarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_id uuid NOT NULL REFERENCES cedentes(id) ON DELETE CASCADE,
  nome text NOT NULL,
  nacionalidade text DEFAULT 'brasileiro(a)',
  estado_civil text,
  profissao text,
  data_nascimento date,
  doc_tipo text DEFAULT 'RG',
  doc_numero text NOT NULL,
  doc_expedidor text,
  doc_data date,
  cpf text NOT NULL,
  endereco text,
  telefone text,
  email text,
  ordem integer DEFAULT 1,
  created_at timestamptz DEFAULT now()
);

-- NOTAS FISCAIS
CREATE TABLE notas_fiscais (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_id uuid NOT NULL REFERENCES cedentes(id) ON DELETE CASCADE,
  numero_nf text NOT NULL,
  serie text,
  chave_acesso text UNIQUE,
  data_emissao date NOT NULL,
  data_vencimento date NOT NULL,
  cnpj_emitente text NOT NULL,
  razao_social_emitente text NOT NULL,
  cnpj_destinatario text NOT NULL,
  razao_social_destinatario text NOT NULL,
  valor_bruto numeric NOT NULL CHECK (valor_bruto > 0),
  valor_liquido numeric,
  valor_icms numeric DEFAULT 0,
  valor_iss numeric DEFAULT 0,
  valor_pis numeric DEFAULT 0,
  valor_cofins numeric DEFAULT 0,
  valor_ipi numeric DEFAULT 0,
  descricao_itens text,
  condicao_pagamento text,
  arquivo_url text,
  status nf_status NOT NULL DEFAULT 'rascunho',
  pedido_sap text,
  status_sap text DEFAULT 'Pagamento Agendado',
  taxa_desagio decimal(10,4),
  valor_antecipado decimal(15,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER notas_fiscais_updated_at
  BEFORE UPDATE ON notas_fiscais
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- OPERAÇÕES
CREATE TABLE operacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_id uuid NOT NULL REFERENCES cedentes(id) ON DELETE CASCADE,
  conta_escrow_id uuid REFERENCES contas_escrow(id),
  valor_bruto_total numeric NOT NULL CHECK (valor_bruto_total > 0),
  taxa_desconto numeric NOT NULL CHECK (taxa_desconto >= 0),
  prazo_dias integer NOT NULL CHECK (prazo_dias > 0),
  valor_liquido_desembolso numeric NOT NULL,
  data_vencimento date NOT NULL,
  status operacao_status NOT NULL DEFAULT 'solicitada',
  aprovado_por uuid REFERENCES profiles(id),
  aprovado_em timestamptz,
  motivo_reprovacao text,
  termo_url text,
  termo_gerado_em timestamptz,
  taxa_desagio decimal(10,4),
  valor_face_total decimal(15,2),
  preco_aquisicao decimal(15,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER operacoes_updated_at
  BEFORE UPDATE ON operacoes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- FK de movimentos_escrow → operacoes (adicionada após criação de operacoes)
ALTER TABLE movimentos_escrow
  ADD CONSTRAINT fk_movimentos_operacao
  FOREIGN KEY (operacao_id) REFERENCES operacoes(id);

-- OPERAÇÕES ↔ NOTAS FISCAIS (junção)
CREATE TABLE operacoes_nfs (
  operacao_id uuid NOT NULL REFERENCES operacoes(id) ON DELETE CASCADE,
  nota_fiscal_id uuid NOT NULL REFERENCES notas_fiscais(id) ON DELETE CASCADE,
  PRIMARY KEY (operacao_id, nota_fiscal_id)
);

-- TAXAS POR CEDENTE
CREATE TABLE taxas_cedente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_id uuid NOT NULL REFERENCES cedentes(id) ON DELETE CASCADE,
  prazo_min integer NOT NULL,
  prazo_max integer NOT NULL,
  taxa_percentual numeric NOT NULL CHECK (taxa_percentual >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- CONSULTOR ↔ CEDENTE
CREATE TABLE consultor_cedente (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultor_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cedente_id uuid NOT NULL REFERENCES cedentes(id) ON DELETE CASCADE,
  comissao_percentual numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consultor_id, cedente_id)
);

-- SACADOS
CREATE TABLE sacados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cnpj text NOT NULL UNIQUE,
  razao_social text NOT NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER sacados_updated_at
  BEFORE UPDATE ON sacados
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- LOGS DE AUDITORIA
CREATE TABLE logs_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES profiles(id),
  tipo_evento text NOT NULL,
  entidade_tipo text NOT NULL,
  entidade_id uuid,
  dados_antes jsonb,
  dados_depois jsonb,
  ip_origem text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- NOTIFICAÇÕES
CREATE TABLE notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  mensagem text NOT NULL,
  tipo text NOT NULL,
  lida boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- 4. ÍNDICES
-- ============================================================

CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_cedentes_user_id ON cedentes(user_id);
CREATE INDEX idx_cedentes_cnpj ON cedentes(cnpj);
CREATE INDEX idx_cedentes_status ON cedentes(status);
CREATE INDEX idx_documentos_cedente_id ON documentos(cedente_id);
CREATE INDEX idx_documentos_status ON documentos(status);
CREATE INDEX idx_contas_escrow_cedente_id ON contas_escrow(cedente_id);
CREATE INDEX idx_movimentos_escrow_conta_id ON movimentos_escrow(conta_escrow_id);
CREATE INDEX idx_notas_fiscais_cedente_id ON notas_fiscais(cedente_id);
CREATE INDEX idx_notas_fiscais_cnpj_destinatario ON notas_fiscais(cnpj_destinatario);
CREATE INDEX idx_notas_fiscais_status ON notas_fiscais(status);
CREATE INDEX idx_operacoes_cedente_id ON operacoes(cedente_id);
CREATE INDEX idx_operacoes_status ON operacoes(status);
CREATE INDEX idx_sacados_user_id ON sacados(user_id);
CREATE INDEX idx_sacados_cnpj ON sacados(cnpj);
CREATE INDEX idx_logs_auditoria_usuario_id ON logs_auditoria(usuario_id);
CREATE INDEX idx_logs_auditoria_tipo_evento ON logs_auditoria(tipo_evento);
CREATE INDEX idx_logs_auditoria_entidade ON logs_auditoria(entidade_tipo, entidade_id);
CREATE INDEX idx_notificacoes_usuario_id ON notificacoes(usuario_id);
CREATE INDEX idx_notificacoes_lida ON notificacoes(usuario_id, lida);
CREATE INDEX idx_representantes_cedente_id ON representantes(cedente_id);
CREATE INDEX idx_representantes_principal   ON representantes(cedente_id, principal);
CREATE INDEX idx_documentos_representante_id ON documentos(representante_id);

-- ============================================================
-- 5. ROW LEVEL SECURITY (RLS)
-- ============================================================

-- Habilitar RLS em todas as tabelas
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE cedentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE representantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE contas_escrow ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimentos_escrow ENABLE ROW LEVEL SECURITY;
ALTER TABLE notas_fiscais ENABLE ROW LEVEL SECURITY;
ALTER TABLE operacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE operacoes_nfs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sacados ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificacoes ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 5.1 PROFILES
-- ============================================================

-- Gestor: acesso total
CREATE POLICY profiles_gestor_all ON profiles
  FOR ALL USING (get_user_role() = 'gestor');

-- Cedente/Sacado/Consultor: apenas o próprio perfil
CREATE POLICY profiles_own_select ON profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY profiles_own_update ON profiles
  FOR UPDATE USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ============================================================
-- 5.2 CEDENTES
-- ============================================================

-- Gestor: acesso total
CREATE POLICY cedentes_gestor_all ON cedentes
  FOR ALL USING (get_user_role() = 'gestor');

-- Cedente: apenas o próprio registro
CREATE POLICY cedentes_own_select ON cedentes
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY cedentes_own_update ON cedentes
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY cedentes_own_insert ON cedentes
  FOR INSERT WITH CHECK (user_id = auth.uid() AND get_user_role() = 'cedente');

-- Consultor: somente leitura
CREATE POLICY cedentes_consultor_select ON cedentes
  FOR SELECT USING (get_user_role() = 'consultor');

-- ============================================================
-- 5.3 DOCUMENTOS
-- ============================================================

-- Gestor: acesso total
CREATE POLICY documentos_gestor_all ON documentos
  FOR ALL USING (get_user_role() = 'gestor');

-- Cedente: apenas os documentos do próprio cedente
CREATE POLICY documentos_cedente_select ON documentos
  FOR SELECT USING (cedente_id = get_user_cedente_id());

CREATE POLICY documentos_cedente_insert ON documentos
  FOR INSERT WITH CHECK (cedente_id = get_user_cedente_id());

CREATE POLICY documentos_cedente_update ON documentos
  FOR UPDATE USING (cedente_id = get_user_cedente_id())
  WITH CHECK (cedente_id = get_user_cedente_id());

-- ============================================================
-- 5.3.1 REPRESENTANTES LEGAIS
-- ============================================================

CREATE POLICY representantes_gestor_all ON representantes
  FOR ALL USING (get_user_role() = 'gestor');

CREATE POLICY representantes_cedente_select ON representantes
  FOR SELECT USING (cedente_id = get_user_cedente_id());

CREATE POLICY representantes_cedente_insert ON representantes
  FOR INSERT WITH CHECK (cedente_id = get_user_cedente_id());

CREATE POLICY representantes_cedente_update ON representantes
  FOR UPDATE USING (cedente_id = get_user_cedente_id())
  WITH CHECK (cedente_id = get_user_cedente_id());

CREATE POLICY representantes_cedente_delete ON representantes
  FOR DELETE USING (cedente_id = get_user_cedente_id());

CREATE POLICY representantes_consultor_select ON representantes
  FOR SELECT USING (get_user_role() = 'consultor');

-- ============================================================
-- 5.4 CONTAS ESCROW
-- ============================================================

-- Gestor: acesso total
CREATE POLICY contas_escrow_gestor_all ON contas_escrow
  FOR ALL USING (get_user_role() = 'gestor');

-- Cedente: apenas a própria conta (somente leitura)
CREATE POLICY contas_escrow_cedente_select ON contas_escrow
  FOR SELECT USING (cedente_id = get_user_cedente_id());

-- Consultor: somente leitura
CREATE POLICY contas_escrow_consultor_select ON contas_escrow
  FOR SELECT USING (get_user_role() = 'consultor');

-- ============================================================
-- 5.5 MOVIMENTOS ESCROW
-- ============================================================

-- Gestor: acesso total
CREATE POLICY movimentos_escrow_gestor_all ON movimentos_escrow
  FOR ALL USING (get_user_role() = 'gestor');

-- Cedente: apenas movimentos da própria conta
CREATE POLICY movimentos_escrow_cedente_select ON movimentos_escrow
  FOR SELECT USING (
    conta_escrow_id IN (
      SELECT id FROM contas_escrow WHERE cedente_id = get_user_cedente_id()
    )
  );

-- Consultor: somente leitura
CREATE POLICY movimentos_escrow_consultor_select ON movimentos_escrow
  FOR SELECT USING (get_user_role() = 'consultor');

-- ============================================================
-- 5.6 NOTAS FISCAIS
-- ============================================================

-- Gestor: acesso total
CREATE POLICY notas_fiscais_gestor_all ON notas_fiscais
  FOR ALL USING (get_user_role() = 'gestor');

-- Cedente: apenas as próprias NFs
CREATE POLICY notas_fiscais_cedente_select ON notas_fiscais
  FOR SELECT USING (cedente_id = get_user_cedente_id());

CREATE POLICY notas_fiscais_cedente_insert ON notas_fiscais
  FOR INSERT WITH CHECK (cedente_id = get_user_cedente_id());

CREATE POLICY notas_fiscais_cedente_update ON notas_fiscais
  FOR UPDATE USING (cedente_id = get_user_cedente_id())
  WITH CHECK (cedente_id = get_user_cedente_id());

CREATE POLICY notas_fiscais_cedente_delete ON notas_fiscais
  FOR DELETE USING (cedente_id = get_user_cedente_id() AND status = 'rascunho');

-- Sacado: apenas NFs onde é o destinatário
CREATE POLICY notas_fiscais_sacado_select ON notas_fiscais
  FOR SELECT USING (cnpj_destinatario = get_user_sacado_cnpj());

CREATE POLICY notas_fiscais_sacado_aceitar ON notas_fiscais
  FOR UPDATE USING (cnpj_destinatario = get_user_sacado_cnpj() AND status = 'em_antecipacao')
  WITH CHECK (status = 'aceita');

CREATE POLICY notas_fiscais_sacado_contestar ON notas_fiscais
  FOR UPDATE USING (cnpj_destinatario = get_user_sacado_cnpj() AND status = 'em_antecipacao')
  WITH CHECK (status = 'contestada');

-- Consultor: somente leitura
CREATE POLICY notas_fiscais_consultor_select ON notas_fiscais
  FOR SELECT USING (get_user_role() = 'consultor');

-- ============================================================
-- 5.7 OPERAÇÕES
-- ============================================================

-- Gestor: acesso total
CREATE POLICY operacoes_gestor_all ON operacoes
  FOR ALL USING (get_user_role() = 'gestor');

-- Cedente: SELECT e INSERT das próprias operações
CREATE POLICY operacoes_cedente_select ON operacoes
  FOR SELECT USING (cedente_id = get_user_cedente_id());

CREATE POLICY operacoes_cedente_insert ON operacoes
  FOR INSERT WITH CHECK (cedente_id = get_user_cedente_id());

-- Sacado: SELECT apenas de operações vinculadas às suas NFs
CREATE POLICY operacoes_sacado_select ON operacoes
  FOR SELECT USING (
    id IN (
      SELECT onf.operacao_id FROM operacoes_nfs onf
      JOIN notas_fiscais nf ON nf.id = onf.nota_fiscal_id
      WHERE nf.cnpj_destinatario = get_user_sacado_cnpj()
    )
  );

-- Consultor: somente leitura
CREATE POLICY operacoes_consultor_select ON operacoes
  FOR SELECT USING (get_user_role() = 'consultor');

-- ============================================================
-- 5.8 OPERAÇÕES ↔ NFS (junção)
-- ============================================================

-- Gestor: acesso total
CREATE POLICY operacoes_nfs_gestor_all ON operacoes_nfs
  FOR ALL USING (get_user_role() = 'gestor');

-- Cedente: usa função SECURITY DEFINER para evitar recursão infinita
-- (operacoes_nfs -> operacoes -> operacoes_nfs)
CREATE POLICY operacoes_nfs_cedente_select ON operacoes_nfs
  FOR SELECT USING (operacao_id IN (SELECT get_user_operacao_ids()));

CREATE POLICY operacoes_nfs_cedente_insert ON operacoes_nfs
  FOR INSERT WITH CHECK (operacao_id IN (SELECT get_user_operacao_ids()));

-- Sacado: apenas registros vinculados às suas NFs
CREATE POLICY operacoes_nfs_sacado_select ON operacoes_nfs
  FOR SELECT USING (
    nota_fiscal_id IN (
      SELECT id FROM notas_fiscais WHERE cnpj_destinatario = get_user_sacado_cnpj()
    )
  );

-- Consultor: somente leitura
CREATE POLICY operacoes_nfs_consultor_select ON operacoes_nfs
  FOR SELECT USING (get_user_role() = 'consultor');

-- ============================================================
-- 5.9 SACADOS
-- ============================================================

-- Gestor: acesso total
CREATE POLICY sacados_gestor_all ON sacados
  FOR ALL USING (get_user_role() = 'gestor');

-- Sacado: apenas o próprio registro
CREATE POLICY sacados_own_select ON sacados
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY sacados_own_update ON sacados
  FOR UPDATE USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- ============================================================
-- 5.10 LOGS DE AUDITORIA
-- ============================================================

-- Gestor: acesso total (leitura e escrita)
CREATE POLICY logs_auditoria_gestor_all ON logs_auditoria
  FOR ALL USING (get_user_role() = 'gestor');

-- Todos os usuários autenticados podem inserir logs (via server actions)
CREATE POLICY logs_auditoria_insert ON logs_auditoria
  FOR INSERT WITH CHECK (usuario_id = auth.uid());

-- ============================================================
-- 5.11 NOTIFICAÇÕES
-- ============================================================

-- Gestor: acesso total
CREATE POLICY notificacoes_gestor_all ON notificacoes
  FOR ALL USING (get_user_role() = 'gestor');

-- Usuário: apenas as próprias notificações
CREATE POLICY notificacoes_own_select ON notificacoes
  FOR SELECT USING (usuario_id = auth.uid());

CREATE POLICY notificacoes_own_update ON notificacoes
  FOR UPDATE USING (usuario_id = auth.uid())
  WITH CHECK (usuario_id = auth.uid());

-- ============================================================
-- 6. FUNÇÃO PARA CRIAR PROFILE AUTOMATICAMENTE NO SIGNUP
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, nome_completo, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nome_completo', NEW.email),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'cedente')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
