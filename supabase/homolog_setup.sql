-- ============================================================
-- BW Antecipa — Setup Completo do Homolog
-- Execute este arquivo inteiro no SQL Editor do Supabase homolog
-- ============================================================

-- ============================================================
-- PARTE 1: SCHEMA (tabelas, enums, RLS, triggers)
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
  'em_antecipacao', 'liquidada', 'cancelada'
);
CREATE TYPE operacao_status AS ENUM (
  'solicitada', 'em_analise', 'aprovada', 'em_andamento',
  'liquidada', 'inadimplente', 'reprovada', 'cancelada'
);
CREATE TYPE tipo_conta_bancaria AS ENUM ('corrente', 'poupanca');

-- Funções auxiliares
CREATE OR REPLACE FUNCTION get_user_role()
RETURNS text AS $$
  SELECT role::text FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_user_cedente_id()
RETURNS uuid AS $$
  SELECT c.id FROM cedentes c WHERE c.user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION get_user_sacado_cnpj()
RETURNS text AS $$
  SELECT s.cnpj FROM sacados s WHERE s.user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Função para IDs de operações do cedente (evita recursão em RLS operacoes <-> operacoes_nfs)
CREATE OR REPLACE FUNCTION get_user_operacao_ids()
RETURNS SETOF uuid AS $$
  SELECT id FROM operacoes WHERE cedente_id = get_user_cedente_id()
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Tabelas
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
CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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
  -- colunas da migration 002
  fundo_id uuid,
  sacado_razao_social text,
  sacado_cnpj text,
  sacado_descricao text,
  contrato_url text,
  contrato_gerado_em timestamptz,
  testemunha_1_nome text DEFAULT 'BRENO JOSE ALVIM DA SILVA',
  testemunha_1_cpf text DEFAULT '378.341.578-09',
  testemunha_2_nome text DEFAULT 'KAIO MIGUEL RUIZ',
  testemunha_2_cpf text DEFAULT '423.679.188-99',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER cedentes_updated_at BEFORE UPDATE ON cedentes FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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
CREATE TRIGGER documentos_updated_at BEFORE UPDATE ON documentos FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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
CREATE TRIGGER representantes_updated_at BEFORE UPDATE ON representantes FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE documentos ADD COLUMN representante_id uuid REFERENCES representantes(id) ON DELETE SET NULL;

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
CREATE TRIGGER contas_escrow_updated_at BEFORE UPDATE ON contas_escrow FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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
  ativo boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- FK cedentes -> fundos (após criação de fundos)
ALTER TABLE cedentes ADD CONSTRAINT cedentes_fundo_id_fkey FOREIGN KEY (fundo_id) REFERENCES fundos(id);

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
  valor_bruto numeric NOT NULL CHECK (valor_bruto >= 0),
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
  -- colunas da migration 002
  pedido_sap text,
  status_sap text DEFAULT 'Pagamento Agendado',
  taxa_desagio decimal(10,4),
  valor_antecipado decimal(15,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER notas_fiscais_updated_at BEFORE UPDATE ON notas_fiscais FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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
  -- colunas da migration 002
  termo_url text,
  termo_gerado_em timestamptz,
  taxa_desagio decimal(10,4),
  valor_face_total decimal(15,2),
  preco_aquisicao decimal(15,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER operacoes_updated_at BEFORE UPDATE ON operacoes FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE movimentos_escrow ADD CONSTRAINT fk_movimentos_operacao FOREIGN KEY (operacao_id) REFERENCES operacoes(id);

CREATE TABLE operacoes_nfs (
  operacao_id uuid NOT NULL REFERENCES operacoes(id) ON DELETE CASCADE,
  nota_fiscal_id uuid NOT NULL REFERENCES notas_fiscais(id) ON DELETE CASCADE,
  PRIMARY KEY (operacao_id, nota_fiscal_id)
);

CREATE TABLE sacados (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cnpj text NOT NULL UNIQUE,
  razao_social text NOT NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER sacados_updated_at BEFORE UPDATE ON sacados FOR EACH ROW EXECUTE FUNCTION update_updated_at();

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

CREATE TABLE notificacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  titulo text NOT NULL,
  mensagem text NOT NULL,
  tipo text NOT NULL,
  lida boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índices
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
-- PARTE 2: ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE cedentes ENABLE ROW LEVEL SECURITY;
ALTER TABLE documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE contas_escrow ENABLE ROW LEVEL SECURITY;
ALTER TABLE movimentos_escrow ENABLE ROW LEVEL SECURITY;
ALTER TABLE notas_fiscais ENABLE ROW LEVEL SECURITY;
ALTER TABLE operacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE operacoes_nfs ENABLE ROW LEVEL SECURITY;
ALTER TABLE sacados ENABLE ROW LEVEL SECURITY;
ALTER TABLE logs_auditoria ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE fundos ENABLE ROW LEVEL SECURITY;
ALTER TABLE devedores_solidarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE representantes ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY profiles_gestor_all ON profiles FOR ALL USING (get_user_role() = 'gestor');
CREATE POLICY profiles_own_select ON profiles FOR SELECT USING (id = auth.uid());
CREATE POLICY profiles_own_update ON profiles FOR UPDATE USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- Cedentes
CREATE POLICY cedentes_gestor_all ON cedentes FOR ALL USING (get_user_role() = 'gestor');
CREATE POLICY cedentes_own_select ON cedentes FOR SELECT USING (user_id = auth.uid());
CREATE POLICY cedentes_own_update ON cedentes FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY cedentes_own_insert ON cedentes FOR INSERT WITH CHECK (user_id = auth.uid() AND get_user_role() = 'cedente');
CREATE POLICY cedentes_consultor_select ON cedentes FOR SELECT USING (get_user_role() = 'consultor');

-- Documentos
CREATE POLICY documentos_gestor_all ON documentos FOR ALL USING (get_user_role() = 'gestor');
CREATE POLICY documentos_cedente_select ON documentos FOR SELECT USING (cedente_id = get_user_cedente_id());
CREATE POLICY documentos_cedente_insert ON documentos FOR INSERT WITH CHECK (cedente_id = get_user_cedente_id());
CREATE POLICY documentos_cedente_update ON documentos FOR UPDATE USING (cedente_id = get_user_cedente_id()) WITH CHECK (cedente_id = get_user_cedente_id());

-- Representantes
CREATE POLICY representantes_gestor_all ON representantes FOR ALL USING (get_user_role() = 'gestor');
CREATE POLICY representantes_cedente_select ON representantes FOR SELECT USING (cedente_id = get_user_cedente_id());
CREATE POLICY representantes_cedente_insert ON representantes FOR INSERT WITH CHECK (cedente_id = get_user_cedente_id());
CREATE POLICY representantes_cedente_update ON representantes FOR UPDATE USING (cedente_id = get_user_cedente_id()) WITH CHECK (cedente_id = get_user_cedente_id());
CREATE POLICY representantes_cedente_delete ON representantes FOR DELETE USING (cedente_id = get_user_cedente_id());
CREATE POLICY representantes_consultor_select ON representantes FOR SELECT USING (get_user_role() = 'consultor');

-- Contas escrow
CREATE POLICY contas_escrow_gestor_all ON contas_escrow FOR ALL USING (get_user_role() = 'gestor');
CREATE POLICY contas_escrow_cedente_select ON contas_escrow FOR SELECT USING (cedente_id = get_user_cedente_id());
CREATE POLICY contas_escrow_consultor_select ON contas_escrow FOR SELECT USING (get_user_role() = 'consultor');

-- Movimentos escrow
CREATE POLICY movimentos_escrow_gestor_all ON movimentos_escrow FOR ALL USING (get_user_role() = 'gestor');
CREATE POLICY movimentos_escrow_cedente_select ON movimentos_escrow FOR SELECT USING (
  conta_escrow_id IN (SELECT id FROM contas_escrow WHERE cedente_id = get_user_cedente_id())
);
CREATE POLICY movimentos_escrow_consultor_select ON movimentos_escrow FOR SELECT USING (get_user_role() = 'consultor');

-- Notas fiscais
CREATE POLICY notas_fiscais_gestor_all ON notas_fiscais FOR ALL USING (get_user_role() = 'gestor');
CREATE POLICY notas_fiscais_cedente_select ON notas_fiscais FOR SELECT USING (cedente_id = get_user_cedente_id());
CREATE POLICY notas_fiscais_cedente_insert ON notas_fiscais FOR INSERT WITH CHECK (cedente_id = get_user_cedente_id());
CREATE POLICY notas_fiscais_cedente_update ON notas_fiscais FOR UPDATE USING (cedente_id = get_user_cedente_id()) WITH CHECK (cedente_id = get_user_cedente_id());
CREATE POLICY notas_fiscais_cedente_delete ON notas_fiscais FOR DELETE USING (cedente_id = get_user_cedente_id() AND status = 'rascunho');
CREATE POLICY notas_fiscais_sacado_select ON notas_fiscais FOR SELECT USING (cnpj_destinatario = get_user_sacado_cnpj());
CREATE POLICY notas_fiscais_consultor_select ON notas_fiscais FOR SELECT USING (get_user_role() = 'consultor');

-- Operações
CREATE POLICY operacoes_gestor_all ON operacoes FOR ALL USING (get_user_role() = 'gestor');
CREATE POLICY operacoes_cedente_select ON operacoes FOR SELECT USING (cedente_id = get_user_cedente_id());
CREATE POLICY operacoes_cedente_insert ON operacoes FOR INSERT WITH CHECK (cedente_id = get_user_cedente_id());
CREATE POLICY operacoes_sacado_select ON operacoes FOR SELECT USING (
  id IN (
    SELECT onf.operacao_id FROM operacoes_nfs onf
    JOIN notas_fiscais nf ON nf.id = onf.nota_fiscal_id
    WHERE nf.cnpj_destinatario = get_user_sacado_cnpj()
  )
);
CREATE POLICY operacoes_consultor_select ON operacoes FOR SELECT USING (get_user_role() = 'consultor');

-- Operações NFs (usa SECURITY DEFINER para evitar recursão operacoes <-> operacoes_nfs)
CREATE POLICY operacoes_nfs_gestor_all ON operacoes_nfs FOR ALL USING (get_user_role() = 'gestor');
CREATE POLICY operacoes_nfs_cedente_select ON operacoes_nfs FOR SELECT USING (
  operacao_id IN (SELECT get_user_operacao_ids())
);
CREATE POLICY operacoes_nfs_cedente_insert ON operacoes_nfs FOR INSERT WITH CHECK (
  operacao_id IN (SELECT get_user_operacao_ids())
);
CREATE POLICY operacoes_nfs_sacado_select ON operacoes_nfs FOR SELECT USING (
  nota_fiscal_id IN (SELECT id FROM notas_fiscais WHERE cnpj_destinatario = get_user_sacado_cnpj())
);
CREATE POLICY operacoes_nfs_consultor_select ON operacoes_nfs FOR SELECT USING (get_user_role() = 'consultor');

-- Sacados
CREATE POLICY sacados_gestor_all ON sacados FOR ALL USING (get_user_role() = 'gestor');
CREATE POLICY sacados_own_select ON sacados FOR SELECT USING (user_id = auth.uid());
CREATE POLICY sacados_own_update ON sacados FOR UPDATE USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Logs
CREATE POLICY logs_auditoria_gestor_all ON logs_auditoria FOR ALL USING (get_user_role() = 'gestor');
CREATE POLICY logs_auditoria_insert ON logs_auditoria FOR INSERT WITH CHECK (usuario_id = auth.uid());

-- Notificações
CREATE POLICY notificacoes_gestor_all ON notificacoes FOR ALL USING (get_user_role() = 'gestor');
CREATE POLICY notificacoes_own_select ON notificacoes FOR SELECT USING (usuario_id = auth.uid());
CREATE POLICY notificacoes_own_update ON notificacoes FOR UPDATE USING (usuario_id = auth.uid()) WITH CHECK (usuario_id = auth.uid());

-- Fundos
CREATE POLICY fundos_gestor_all ON fundos FOR ALL USING (get_user_role() = 'gestor');
CREATE POLICY fundos_gestor_select ON fundos FOR SELECT USING (get_user_role() = 'gestor');

-- Devedores solidários
CREATE POLICY devedores_gestor_all ON devedores_solidarios FOR ALL USING (get_user_role() = 'gestor');
CREATE POLICY devedores_gestor_select ON devedores_solidarios FOR SELECT USING (get_user_role() = 'gestor');
CREATE POLICY devedores_cedente_select ON devedores_solidarios FOR SELECT USING (
  cedente_id IN (SELECT id FROM cedentes WHERE user_id = auth.uid())
);

-- ============================================================
-- PARTE 3: TRIGGER DE CRIAÇÃO DE PROFILE NO SIGNUP
-- ============================================================

CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, nome_completo, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nome_completo', NEW.email),
    COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'cedente')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ============================================================
-- PARTE 4: STORAGE — buckets e policies
-- ============================================================

INSERT INTO storage.buckets (id, name, public) VALUES ('documentos-cedentes', 'documentos-cedentes', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('notas-fiscais', 'notas-fiscais', false) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('contratos', 'contratos', false) ON CONFLICT (id) DO NOTHING;

-- Storage: documentos-cedentes
CREATE POLICY storage_docs_cedente_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'documentos-cedentes' AND get_user_role() = 'cedente'
  AND (storage.foldername(name))[1] = (SELECT cnpj FROM cedentes WHERE user_id = auth.uid())
);
CREATE POLICY storage_docs_cedente_select ON storage.objects FOR SELECT USING (
  bucket_id = 'documentos-cedentes' AND get_user_role() = 'cedente'
  AND (storage.foldername(name))[1] = (SELECT cnpj FROM cedentes WHERE user_id = auth.uid())
);
CREATE POLICY storage_docs_cedente_update ON storage.objects FOR UPDATE USING (
  bucket_id = 'documentos-cedentes' AND get_user_role() = 'cedente'
  AND (storage.foldername(name))[1] = (SELECT cnpj FROM cedentes WHERE user_id = auth.uid())
);
CREATE POLICY storage_docs_gestor_select ON storage.objects FOR SELECT USING (
  bucket_id = 'documentos-cedentes' AND get_user_role() = 'gestor'
);
CREATE POLICY storage_docs_gestor_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'documentos-cedentes' AND get_user_role() = 'gestor'
);
CREATE POLICY storage_docs_consultor_select ON storage.objects FOR SELECT USING (
  bucket_id = 'documentos-cedentes' AND get_user_role() = 'consultor'
);

-- Storage: notas-fiscais
CREATE POLICY storage_nfs_cedente_insert ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'notas-fiscais' AND get_user_role() = 'cedente'
  AND (storage.foldername(name))[1] = (SELECT cnpj FROM cedentes WHERE user_id = auth.uid())
);
CREATE POLICY storage_nfs_cedente_select ON storage.objects FOR SELECT USING (
  bucket_id = 'notas-fiscais' AND get_user_role() = 'cedente'
  AND (storage.foldername(name))[1] = (SELECT cnpj FROM cedentes WHERE user_id = auth.uid())
);
CREATE POLICY storage_nfs_gestor_select ON storage.objects FOR SELECT USING (
  bucket_id = 'notas-fiscais' AND get_user_role() = 'gestor'
);
CREATE POLICY storage_nfs_consultor_select ON storage.objects FOR SELECT USING (
  bucket_id = 'notas-fiscais' AND get_user_role() = 'consultor'
);

-- Storage: contratos
CREATE POLICY storage_contratos_gestor_all ON storage.objects FOR ALL USING (
  bucket_id = 'contratos' AND get_user_role() = 'gestor'
);
CREATE POLICY storage_contratos_cedente_select ON storage.objects FOR SELECT USING (
  bucket_id = 'contratos' AND get_user_role() = 'cedente'
  AND (storage.foldername(name))[1] = (SELECT cnpj FROM cedentes WHERE user_id = auth.uid())
);
