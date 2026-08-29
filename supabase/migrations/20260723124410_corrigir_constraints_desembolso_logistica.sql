-- Corrige bancos onde a tabela de logística já existia antes da Fase 5.
--
-- A RPC public.desembolsar_operacao_com_logistica usa:
--   ON CONFLICT (operacao_id, nota_fiscal_id)
--   ON CONFLICT (politica_requisito_id, nota_fiscal_entrega_id)
--
-- Em ambientes onde as tabelas já existiam, o CREATE TABLE IF NOT EXISTS da
-- Fase 5 não reaplicou constraints declaradas no CREATE TABLE, causando:
-- "there is no unique or exclusion constraint matching the ON CONFLICT specification".

DO $$
BEGIN
  IF to_regclass('public.nota_fiscal_entregas') IS NULL THEN
    RAISE EXCEPTION 'Tabela public.nota_fiscal_entregas nao existe. Aplique a migration da Fase 5 antes desta correcao.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.nota_fiscal_entregas
    GROUP BY operacao_id, nota_fiscal_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Existem entregas duplicadas para a mesma operacao_id e nota_fiscal_id. Resolva os dados antes de adicionar a constraint nota_fiscal_entregas_operacao_nf_unique.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = to_regclass('public.nota_fiscal_entregas')
      AND conname = 'nota_fiscal_entregas_operacao_nf_unique'
  ) THEN
    ALTER TABLE public.nota_fiscal_entregas
      ADD CONSTRAINT nota_fiscal_entregas_operacao_nf_unique
      UNIQUE (operacao_id, nota_fiscal_id);
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.documento_requisito_instancias') IS NULL THEN
    RAISE EXCEPTION 'Tabela public.documento_requisito_instancias nao existe. Aplique a migration da Fase 3 antes desta correcao.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.documento_requisito_instancias
    WHERE nota_fiscal_entrega_id IS NOT NULL
    GROUP BY politica_requisito_id, nota_fiscal_entrega_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Existem requisitos logisticos duplicados para a mesma politica_requisito_id e nota_fiscal_entrega_id. Resolva os dados antes de adicionar a constraint documento_requisito_entrega_unique.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = to_regclass('public.documento_requisito_instancias')
      AND conname = 'documento_requisito_entrega_unique'
  ) THEN
    ALTER TABLE public.documento_requisito_instancias
      ADD CONSTRAINT documento_requisito_entrega_unique
      UNIQUE (politica_requisito_id, nota_fiscal_entrega_id);
  END IF;
END $$;
