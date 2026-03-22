-- Migration: Tabelas e colunas para geracao automatica de contratos PDF
-- BW Antecipa - Sistema de Antecipacao de Recebiveis

-- 1. Tabela de fundos (cessionarios)
CREATE TABLE IF NOT EXISTS fundos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nome TEXT NOT NULL,
  cnpj TEXT NOT NULL,
  administradora_nome TEXT NOT NULL,
  administradora_cnpj TEXT NOT NULL,
  gestora_nome TEXT NOT NULL DEFAULT 'BLUEWAVE ASSET LTDA',
  gestora_cnpj TEXT NOT NULL DEFAULT '13.703.306/0001-56',
  custodiante_nome TEXT NOT NULL DEFAULT 'TERRA INVESTIMENTOS DISTRIBUIDORA DE TITULOS E VALORES MOBILIARIOS LTDA',
  custodiante_cnpj TEXT NOT NULL DEFAULT '03.751.794/0001-13',
  conta_vinculada TEXT,
  agencia TEXT,
  banco TEXT,
  ativo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Devedores solidarios (relacionada ao cedente)
CREATE TABLE IF NOT EXISTS devedores_solidarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_id UUID NOT NULL REFERENCES cedentes(id) ON DELETE CASCADE,
  nome TEXT NOT NULL,
  nacionalidade TEXT DEFAULT 'brasileiro(a)',
  estado_civil TEXT,
  profissao TEXT,
  data_nascimento DATE,
  doc_tipo TEXT DEFAULT 'RG',
  doc_numero TEXT NOT NULL,
  doc_expedidor TEXT,
  doc_data DATE,
  cpf TEXT NOT NULL,
  endereco TEXT,
  telefone TEXT,
  email TEXT,
  ordem INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Colunas adicionais na tabela cedentes
ALTER TABLE cedentes
  ADD COLUMN IF NOT EXISTS fundo_id UUID REFERENCES fundos(id),
  ADD COLUMN IF NOT EXISTS sacado_razao_social TEXT,
  ADD COLUMN IF NOT EXISTS sacado_cnpj TEXT,
  ADD COLUMN IF NOT EXISTS sacado_descricao TEXT,
  ADD COLUMN IF NOT EXISTS contrato_url TEXT,
  ADD COLUMN IF NOT EXISTS contrato_gerado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS testemunha_1_nome TEXT DEFAULT 'BRENO JOSE ALVIM DA SILVA',
  ADD COLUMN IF NOT EXISTS testemunha_1_cpf TEXT DEFAULT '378.341.578-09',
  ADD COLUMN IF NOT EXISTS testemunha_2_nome TEXT DEFAULT 'KAIO MIGUEL RUIZ',
  ADD COLUMN IF NOT EXISTS testemunha_2_cpf TEXT DEFAULT '423.679.188-99';

-- 4. Colunas adicionais na tabela operacoes
ALTER TABLE operacoes
  ADD COLUMN IF NOT EXISTS termo_url TEXT,
  ADD COLUMN IF NOT EXISTS termo_gerado_em TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS taxa_desagio DECIMAL(10,4),
  ADD COLUMN IF NOT EXISTS valor_face_total DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS preco_aquisicao DECIMAL(15,2);

-- 5. Colunas adicionais na tabela notas_fiscais
ALTER TABLE notas_fiscais
  ADD COLUMN IF NOT EXISTS pedido_sap TEXT,
  ADD COLUMN IF NOT EXISTS status_sap TEXT DEFAULT 'Pagamento Agendado',
  ADD COLUMN IF NOT EXISTS taxa_desagio DECIMAL(10,4),
  ADD COLUMN IF NOT EXISTS valor_antecipado DECIMAL(15,2);

-- 6. RLS para fundos (gestores podem ler/escrever)
ALTER TABLE fundos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Gestores podem ver fundos" ON fundos
  FOR SELECT USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'gestor'
  );

CREATE POLICY "Gestores podem gerenciar fundos" ON fundos
  FOR ALL USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'gestor'
  );

-- 7. RLS para devedores_solidarios
ALTER TABLE devedores_solidarios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Gestores podem ver devedores" ON devedores_solidarios
  FOR SELECT USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'gestor'
  );

CREATE POLICY "Gestores podem gerenciar devedores" ON devedores_solidarios
  FOR ALL USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'gestor'
  );

CREATE POLICY "Cedentes podem ver seus devedores" ON devedores_solidarios
  FOR SELECT USING (
    cedente_id IN (SELECT id FROM cedentes WHERE user_id = auth.uid())
  );

-- Nota: Criar bucket 'contratos' no Supabase Dashboard como privado
-- INSERT INTO storage.buckets (id, name, public) VALUES ('contratos', 'contratos', false);
