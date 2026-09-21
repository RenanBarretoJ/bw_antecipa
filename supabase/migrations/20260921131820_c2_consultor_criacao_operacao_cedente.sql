-- C2 - Consultor cria operacao somente para Cedente ativo da propria carteira.
-- A coluna de status e a menor extensao estrutural necessaria para representar
-- vinculo revogado sem apagar historico. A RPC de criacao permanece a fronteira
-- transacional autoritativa e registra o usuario real em logs_auditoria.

BEGIN;

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA extensions;

ALTER TABLE public.consultor_cedente
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ativo';

ALTER TABLE public.consultor_cedente
  DROP CONSTRAINT IF EXISTS consultor_cedente_status_check;

ALTER TABLE public.consultor_cedente
  ADD CONSTRAINT consultor_cedente_status_check
  CHECK (status IN ('ativo', 'inativo'));

CREATE INDEX IF NOT EXISTS idx_consultor_cedente_ativos
  ON public.consultor_cedente (consultor_id, cedente_id)
  WHERE status = 'ativo';

CREATE OR REPLACE FUNCTION private.consultor_tem_acesso_cedente(p_cedente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    (SELECT public.get_user_role()) = 'consultor'
    AND EXISTS (
      SELECT 1
      FROM public.consultor_cedente cc
      WHERE cc.consultor_id = (SELECT auth.uid())
        AND cc.cedente_id = p_cedente_id
        AND cc.status = 'ativo'
    );
$$;

REVOKE ALL ON FUNCTION private.consultor_tem_acesso_cedente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.consultor_tem_acesso_cedente(uuid) TO authenticated;

DROP POLICY IF EXISTS cedentes_consultor_select ON public.cedentes;
CREATE POLICY cedentes_consultor_select
  ON public.cedentes
  FOR SELECT
  TO authenticated
  USING (
    cedentes.status = 'ativo'
    AND (SELECT private.consultor_tem_acesso_cedente(cedentes.id))
  );

DROP POLICY IF EXISTS taxas_cedente_consultor_select ON public.taxas_cedente;
CREATE POLICY taxas_cedente_consultor_select
  ON public.taxas_cedente
  FOR SELECT
  TO authenticated
  USING ((SELECT private.consultor_tem_acesso_cedente(taxas_cedente.cedente_id)));

CREATE OR REPLACE FUNCTION private.buscar_cedentes_elegiveis_consultor(
  p_termo text DEFAULT NULL,
  p_limite integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  razao_social text,
  nome_fantasia text,
  cnpj text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH parametros AS (
    SELECT
      pg_catalog.btrim(pg_catalog.coalesce(p_termo, '')) AS termo,
      extensions.unaccent(pg_catalog.lower(pg_catalog.btrim(pg_catalog.coalesce(p_termo, '')))) AS termo_normalizado,
      pg_catalog.regexp_replace(pg_catalog.coalesce(p_termo, ''), '[^0-9]', '', 'g') AS termo_cnpj,
      pg_catalog.greatest(1, pg_catalog.least(pg_catalog.coalesce(p_limite, 10), 10)) AS limite
  )
  SELECT c.id, c.razao_social, c.nome_fantasia, c.cnpj
  FROM public.consultor_cedente cc
  JOIN public.cedentes c ON c.id = cc.cedente_id
  CROSS JOIN parametros p
  WHERE auth.uid() IS NOT NULL
    AND public.get_user_role() = 'consultor'
    AND cc.consultor_id = auth.uid()
    AND cc.status = 'ativo'
    AND c.status = 'ativo'
    AND EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      JOIN public.fundos f ON f.id = cf.fundo_id
      WHERE cf.cedente_id = c.id
        AND cf.status = 'ativo'
        AND pg_catalog.coalesce(f.ativo, true) = true
    )
    AND (
      p.termo = ''
      OR (
        pg_catalog.char_length(p.termo) >= 4
        AND (
          pg_catalog.strpos(extensions.unaccent(pg_catalog.lower(c.razao_social)), p.termo_normalizado) > 0
          OR pg_catalog.strpos(extensions.unaccent(pg_catalog.lower(pg_catalog.coalesce(c.nome_fantasia, ''))), p.termo_normalizado) > 0
          OR (p.termo_cnpj <> '' AND pg_catalog.strpos(pg_catalog.regexp_replace(c.cnpj, '[^0-9]', '', 'g'), p.termo_cnpj) > 0)
        )
      )
    )
  ORDER BY c.razao_social, c.id
  LIMIT (SELECT limite FROM parametros);
$$;

CREATE OR REPLACE FUNCTION public.buscar_cedentes_elegiveis_consultor(
  p_termo text DEFAULT NULL,
  p_limite integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  razao_social text,
  nome_fantasia text,
  cnpj text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT *
  FROM private.buscar_cedentes_elegiveis_consultor(p_termo, p_limite);
$$;

REVOKE ALL ON FUNCTION private.buscar_cedentes_elegiveis_consultor(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.buscar_cedentes_elegiveis_consultor(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.buscar_cedentes_elegiveis_consultor(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.buscar_cedentes_elegiveis_consultor(text, integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.solicitar_operacao_antecipacao_atomica(
  p_cedente_id uuid, p_cedente_fundo_id uuid, p_politica_operacional_id uuid,
  p_politica_operacional_versao_id uuid, p_politica_versao integer, p_politica_snapshot jsonb,
  p_politica_snapshot_hash text, p_aceite_sacado_exigido boolean, p_aceite_sacado_status text,
  p_nota_fiscal_ids uuid[], p_valor_bruto_total numeric, p_taxa_desconto numeric,
  p_prazo_dias integer, p_valor_liquido_desembolso numeric, p_data_vencimento date,
  p_idempotency_key text,
  p_parcela_ids uuid[] DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  actor_id uuid := auth.uid(); actor_role text := public.get_user_role();
  cedente_row record; vinculo_row record; escrow_row record; existing_op record;
  expected_count integer; matched_count integer; already_linked_count integer;
  parcelas_expected_count integer; parcelas_matched_count integer;
  inserted_op_id uuid; now_ts timestamptz := now(); politica_atribuicao_row record;
BEGIN
  IF actor_id IS NULL THEN RAISE EXCEPTION 'Usuario nao autenticado'; END IF;
  IF actor_role NOT IN ('cedente', 'consultor') THEN RAISE EXCEPTION 'Somente Cedente ou Consultor pode solicitar antecipacao'; END IF;
  IF p_nota_fiscal_ids IS NULL OR cardinality(p_nota_fiscal_ids) = 0 THEN RAISE EXCEPTION 'Selecione ao menos uma NF'; END IF;
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 16 THEN RAISE EXCEPTION 'Chave de idempotencia invalida'; END IF;

  SELECT * INTO cedente_row FROM public.cedentes WHERE id = p_cedente_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cadastro de Cedente nao encontrado'; END IF;
  IF cedente_row.status <> 'ativo' THEN RAISE EXCEPTION 'Cedente nao esta aprovado e ativo'; END IF;

  IF actor_role = 'cedente' THEN
    IF public.get_user_cedente_id() IS DISTINCT FROM p_cedente_id THEN
      RAISE EXCEPTION 'Cedente sem acesso ao cadastro informado';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1
    FROM public.consultor_cedente cc
    WHERE cc.consultor_id = actor_id
      AND cc.cedente_id = p_cedente_id
      AND cc.status = 'ativo'
  ) THEN
    RAISE EXCEPTION 'Consultor sem vinculo ativo com o Cedente informado';
  END IF;

  SELECT * INTO existing_op FROM public.operacoes WHERE solicitacao_idempotency_key = p_idempotency_key LIMIT 1;
  IF FOUND THEN
    IF existing_op.cedente_id IS DISTINCT FROM p_cedente_id
       OR existing_op.cedente_fundo_id IS DISTINCT FROM p_cedente_fundo_id THEN
      RAISE EXCEPTION 'Chave de idempotencia pertence a outro contexto operacional';
    END IF;
    RETURN jsonb_build_object('operacao_id', existing_op.id, 'idempotent_replay', true, 'status', existing_op.status);
  END IF;

  SELECT * INTO vinculo_row FROM public.cedente_fundos WHERE id = p_cedente_fundo_id AND cedente_id = p_cedente_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vinculo cedente-fundo nao encontrado'; END IF;
  IF vinculo_row.status <> 'ativo' THEN RAISE EXCEPTION 'Vinculo cedente-fundo nao esta ativo'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = vinculo_row.fundo_id AND coalesce(f.ativo, true) = true) THEN
    RAISE EXCEPTION 'Fundo vinculado ao cedente nao esta ativo';
  END IF;

  SELECT cfp.* INTO politica_atribuicao_row
  FROM public.cedente_fundo_politicas cfp
  JOIN public.politicas_operacionais p ON p.id = cfp.politica_operacional_id
  JOIN public.politica_operacional_versoes v ON v.id = p_politica_operacional_versao_id AND v.politica_operacional_id = p.id
  WHERE cfp.cedente_fundo_id = p_cedente_fundo_id AND cfp.politica_operacional_id = p_politica_operacional_id
    AND cfp.status = 'ativa' AND cfp.vigente_desde <= now_ts AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now_ts)
    AND p.fundo_id = vinculo_row.fundo_id AND p.status = 'ativa'
    AND v.fundo_id = vinculo_row.fundo_id AND v.publicada_em IS NOT NULL AND v.publicada_por IS NOT NULL
    AND v.vigente_ate IS NULL AND v.versao = p_politica_versao
  ORDER BY cfp.vigente_desde DESC LIMIT 1;
  IF politica_atribuicao_row.id IS NULL THEN RAISE EXCEPTION 'Politica operacional vigente nao vinculada ao cedente-fundo'; END IF;

  SELECT * INTO escrow_row FROM public.contas_escrow WHERE cedente_id = p_cedente_id AND status = 'ativa'
  ORDER BY created_at ASC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conta escrow nao encontrada ou inativa'; END IF;

  SELECT count(DISTINCT nf_id) INTO expected_count FROM unnest(p_nota_fiscal_ids) AS item(nf_id);
  IF expected_count <> cardinality(p_nota_fiscal_ids) THEN RAISE EXCEPTION 'A selecao contem NFs repetidas'; END IF;

  WITH locked_nfs AS (
    SELECT nf.id FROM public.notas_fiscais nf
    WHERE nf.id = ANY(p_nota_fiscal_ids) AND nf.cedente_id = p_cedente_id
      AND nf.cedente_fundo_id = p_cedente_fundo_id AND nf.fundo_id = vinculo_row.fundo_id
      AND nf.status = 'aprovada'
    FOR UPDATE
  )
  SELECT count(DISTINCT id) INTO matched_count FROM locked_nfs;
  IF matched_count <> expected_count THEN RAISE EXCEPTION 'Uma ou mais NFs nao pertencem ao contexto ativo ou nao estao aprovadas'; END IF;

  SELECT count(*) INTO already_linked_count
  FROM public.operacoes_nfs onf
  WHERE onf.nota_fiscal_id = ANY(p_nota_fiscal_ids)
    AND NOT EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = onf.nota_fiscal_id);
  IF already_linked_count > 0 THEN RAISE EXCEPTION 'Uma ou mais NFs ja estao vinculadas a uma operacao'; END IF;

  IF p_parcela_ids IS NOT NULL AND cardinality(p_parcela_ids) > 0 THEN
    SELECT count(DISTINCT id) INTO parcelas_expected_count FROM unnest(p_parcela_ids) AS item(id);
    IF parcelas_expected_count <> cardinality(p_parcela_ids) THEN RAISE EXCEPTION 'A selecao contem parcelas repetidas'; END IF;

    WITH locked_parcelas AS (
      SELECT p.id FROM public.nota_fiscal_parcelas p
      JOIN public.notas_fiscais nf ON nf.id = p.nota_fiscal_id
      WHERE p.id = ANY(p_parcela_ids) AND p.status = 'disponivel'
        AND nf.id = ANY(p_nota_fiscal_ids) AND nf.cedente_id = p_cedente_id
        AND nf.cedente_fundo_id = p_cedente_fundo_id AND nf.fundo_id = vinculo_row.fundo_id
      FOR UPDATE OF p
    )
    SELECT count(DISTINCT id) INTO parcelas_matched_count FROM locked_parcelas;
    IF parcelas_matched_count <> parcelas_expected_count THEN
      RAISE EXCEPTION 'Uma ou mais parcelas nao estao disponiveis ou nao pertencem ao contexto ativo';
    END IF;

    IF EXISTS (
      SELECT 1 FROM unnest(p_nota_fiscal_ids) AS item(nf_id)
      WHERE EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = item.nf_id)
        AND NOT EXISTS (
          SELECT 1 FROM public.nota_fiscal_parcelas p
          WHERE p.nota_fiscal_id = item.nf_id AND p.id = ANY(p_parcela_ids)
        )
    ) THEN
      RAISE EXCEPTION 'Toda NF com parcelas precisa ter ao menos uma parcela selecionada';
    END IF;
  ELSIF EXISTS (
    SELECT 1 FROM unnest(p_nota_fiscal_ids) AS item(nf_id)
    WHERE EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = item.nf_id)
  ) THEN
    RAISE EXCEPTION 'NF com parcelas precisa informar quais parcelas foram selecionadas';
  END IF;

  INSERT INTO public.operacoes (
    cedente_id, conta_escrow_id, valor_bruto_total, taxa_desconto, prazo_dias, valor_liquido_desembolso,
    data_vencimento, status, cedente_fundo_id, politica_operacional_id, politica_operacional_versao_id,
    politica_atribuicao_id, politica_versao, politica_snapshot, politica_snapshot_hash,
    contexto_configuracao_status, contexto_capturado_em, aceite_sacado_exigido, aceite_sacado_status,
    aceite_sacado_em, cessao_efetivada_em, solicitacao_idempotency_key
  ) VALUES (
    p_cedente_id, escrow_row.id, p_valor_bruto_total, p_taxa_desconto, p_prazo_dias, greatest(0, p_valor_liquido_desembolso),
    p_data_vencimento, 'solicitada', p_cedente_fundo_id, p_politica_operacional_id, p_politica_operacional_versao_id,
    politica_atribuicao_row.id, p_politica_versao, p_politica_snapshot, p_politica_snapshot_hash,
    'completo', now_ts, p_aceite_sacado_exigido, p_aceite_sacado_status,
    CASE WHEN p_aceite_sacado_exigido THEN NULL ELSE now_ts END, NULL, p_idempotency_key
  ) RETURNING id INTO inserted_op_id;

  INSERT INTO public.operacoes_nfs (operacao_id, nota_fiscal_id)
  SELECT inserted_op_id, DISTINCT_NF.nf_id
  FROM (SELECT DISTINCT nf_id FROM unnest(p_nota_fiscal_ids) AS item(nf_id)) DISTINCT_NF;

  IF p_parcela_ids IS NOT NULL AND cardinality(p_parcela_ids) > 0 THEN
    INSERT INTO public.operacoes_nf_parcelas (operacao_id, nota_fiscal_id, parcela_id)
    SELECT inserted_op_id, p.nota_fiscal_id, p.id
    FROM public.nota_fiscal_parcelas p
    WHERE p.id = ANY(p_parcela_ids);

    UPDATE public.nota_fiscal_parcelas SET status = 'em_operacao' WHERE id = ANY(p_parcela_ids);
  END IF;

  UPDATE public.notas_fiscais nf
  SET status = 'em_antecipacao'
  WHERE nf.id = ANY(p_nota_fiscal_ids) AND nf.cedente_id = p_cedente_id AND nf.cedente_fundo_id = p_cedente_fundo_id
    AND NOT EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas p WHERE p.nota_fiscal_id = nf.id AND p.status = 'disponivel');

  INSERT INTO public.logs_auditoria (usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_depois)
  VALUES (actor_id, 'OPERACAO_SOLICITADA', 'operacoes', inserted_op_id, jsonb_build_object(
      'solicitado_por_role', actor_role, 'cedente_id', p_cedente_id,
      'valor_bruto_total', p_valor_bruto_total, 'taxa_desconto', p_taxa_desconto, 'prazo_dias', p_prazo_dias,
      'nota_fiscal_ids', p_nota_fiscal_ids, 'parcela_ids', p_parcela_ids, 'cedente_fundo_id', p_cedente_fundo_id,
      'politica_atribuicao_id', politica_atribuicao_row.id, 'politica_snapshot_hash', p_politica_snapshot_hash,
      'idempotency_key', p_idempotency_key
  ));

  RETURN jsonb_build_object('operacao_id', inserted_op_id, 'idempotent_replay', false, 'status', 'solicitada',
    'politica_atribuicao_id', politica_atribuicao_row.id);
END;
$$;

REVOKE ALL ON FUNCTION public.solicitar_operacao_antecipacao_atomica(
  uuid, uuid, uuid, uuid, integer, jsonb, text, boolean, text, uuid[], numeric, numeric, integer, numeric, date, text, uuid[]
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.solicitar_operacao_antecipacao_atomica(
  uuid, uuid, uuid, uuid, integer, jsonb, text, boolean, text, uuid[], numeric, numeric, integer, numeric, date, text, uuid[]
) TO authenticated;

COMMENT ON COLUMN public.consultor_cedente.status IS
  'Estado operacional do vinculo. Somente ativo permite leitura e criacao de operacoes pelo Consultor.';
COMMENT ON FUNCTION public.buscar_cedentes_elegiveis_consultor(text, integer) IS
  'Busca limitada aos Cedentes aprovados, ativos e vinculados ao Consultor autenticado.';

NOTIFY pgrst, 'reload schema';

COMMIT;
