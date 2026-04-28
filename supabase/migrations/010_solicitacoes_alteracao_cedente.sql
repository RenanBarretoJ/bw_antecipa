-- Migration 010: Solicitações de alteração cadastral do cedente
CREATE TABLE solicitacoes_alteracao_cedente (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_id               uuid        NOT NULL REFERENCES cedentes(id) ON DELETE CASCADE,
  dados_atuais             jsonb       NOT NULL,
  dados_propostos          jsonb       NOT NULL,
  representantes_atuais    jsonb       NOT NULL DEFAULT '[]',
  representantes_propostos jsonb       NOT NULL DEFAULT '[]',
  status                   text        NOT NULL DEFAULT 'pendente'
                                       CHECK (status IN ('pendente', 'aprovada', 'reprovada')),
  motivo_reprovacao        text,
  solicitado_em            timestamptz NOT NULL DEFAULT now(),
  analisado_por            uuid        REFERENCES auth.users(id),
  analisado_em             timestamptz
);

CREATE INDEX idx_sac_cedente_id ON solicitacoes_alteracao_cedente(cedente_id);
CREATE INDEX idx_sac_status     ON solicitacoes_alteracao_cedente(status);

ALTER TABLE solicitacoes_alteracao_cedente ENABLE ROW LEVEL SECURITY;

-- Cedente vê apenas as próprias solicitações
CREATE POLICY sac_cedente_select ON solicitacoes_alteracao_cedente
  FOR SELECT USING (cedente_id = get_user_cedente_id());

CREATE POLICY sac_cedente_insert ON solicitacoes_alteracao_cedente
  FOR INSERT WITH CHECK (cedente_id = get_user_cedente_id());

-- Gestor acessa tudo
CREATE POLICY sac_gestor_all ON solicitacoes_alteracao_cedente
  FOR ALL USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'gestor')
  );
