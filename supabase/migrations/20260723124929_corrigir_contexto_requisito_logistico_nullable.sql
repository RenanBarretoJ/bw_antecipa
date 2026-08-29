-- Permite instâncias de requisito documental vinculadas ao acompanhamento
-- pós-cessão por entrega, sem exigir nota_fiscal_id direto.
--
-- A Fase 5 ampliou public.documento_requisito_instancias com:
--   nota_fiscal_entrega_id
-- e alterou o check de contexto para:
--   exactly one of nota_fiscal_id, operacao_id, nota_fiscal_entrega_id
--
-- Porém, em bases existentes, nota_fiscal_id permaneceu NOT NULL por ter sido
-- criada assim na Fase 3. Isso impede a RPC de desembolso de criar requisitos
-- logísticos de CT-e/canhoto vinculados somente à entrega.

DO $$
BEGIN
  IF to_regclass('public.documento_requisito_instancias') IS NULL THEN
    RAISE EXCEPTION 'Tabela public.documento_requisito_instancias nao existe. Aplique a migration da Fase 3 antes desta correcao.';
  END IF;

  ALTER TABLE public.documento_requisito_instancias
    ALTER COLUMN nota_fiscal_id DROP NOT NULL;

  ALTER TABLE public.documento_requisito_instancias
    DROP CONSTRAINT IF EXISTS documento_requisito_contexto_check;

  ALTER TABLE public.documento_requisito_instancias
    ADD CONSTRAINT documento_requisito_contexto_check
    CHECK (num_nonnulls(nota_fiscal_id, operacao_id, nota_fiscal_entrega_id) = 1);
END $$;
