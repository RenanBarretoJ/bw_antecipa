-- Migration: tabela global de testemunhas + seleção por operação

CREATE TABLE IF NOT EXISTS testemunhas (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome       text NOT NULL,
  cpf        text NOT NULL,
  email      text,
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Testemunhas padrão
INSERT INTO testemunhas (nome, cpf, email) VALUES
  ('BRENO JOSE ALVIM DA SILVA', '378.341.578-09', null),
  ('DAVI DE PAULA YANG', '469.942.738-30', null)
ON CONFLICT DO NOTHING;

-- RLS: apenas gestores gerenciam
ALTER TABLE testemunhas ENABLE ROW LEVEL SECURITY;

CREATE POLICY testemunhas_gestor_all ON testemunhas
  FOR ALL USING (get_user_role() = 'gestor');

CREATE POLICY testemunhas_select_all ON testemunhas
  FOR SELECT USING (true);

-- Seleção de testemunhas por operação
ALTER TABLE operacoes
  ADD COLUMN IF NOT EXISTS testemunha_1_id uuid REFERENCES testemunhas(id),
  ADD COLUMN IF NOT EXISTS testemunha_2_id uuid REFERENCES testemunhas(id);
