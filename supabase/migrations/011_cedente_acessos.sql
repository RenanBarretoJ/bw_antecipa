-- Migration 011: Múltiplos acessos por cedente
CREATE TABLE cedente_acessos (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_id   uuid        NOT NULL REFERENCES cedentes(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  perfil       text        NOT NULL DEFAULT 'operador'
                           CHECK (perfil IN ('administrador', 'operador')),
  ativo        boolean     NOT NULL DEFAULT true,
  convidado_por uuid       REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cedente_id, user_id)
);

CREATE INDEX idx_cedente_acessos_cedente_id ON cedente_acessos(cedente_id);
CREATE INDEX idx_cedente_acessos_user_id    ON cedente_acessos(user_id, ativo);

-- Atualizar get_user_cedente_id para cobrir usuarios vinculados via cedente_acessos
CREATE OR REPLACE FUNCTION get_user_cedente_id()
RETURNS uuid AS $$
BEGIN
  RETURN COALESCE(
    (SELECT id FROM cedentes WHERE user_id = auth.uid()),
    (SELECT cedente_id FROM cedente_acessos
     WHERE user_id = auth.uid() AND ativo = true LIMIT 1)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Usuarios vinculados via cedente_acessos podem ler o cedente deles
CREATE POLICY cedentes_acesso_select ON cedentes
  FOR SELECT USING (id = get_user_cedente_id());

-- RLS na nova tabela
ALTER TABLE cedente_acessos ENABLE ROW LEVEL SECURITY;

CREATE POLICY ca_gestor_all ON cedente_acessos
  FOR ALL USING (get_user_role() = 'gestor');

-- Cedente (dono ou vinculado) lista acessos do proprio cedente
CREATE POLICY ca_cedente_select ON cedente_acessos
  FOR SELECT USING (cedente_id = get_user_cedente_id());
