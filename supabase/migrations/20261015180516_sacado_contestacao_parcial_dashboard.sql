-- Keep individual pending decisions available after a partial contestation.
-- Patch the installed RPC to preserve its audited, entity-scoped notifications.
DO $migration$
DECLARE
  v_definition text;
  v_before text := 'v_nf.aceite_sacado_status <> ''pendente''';
  v_after text := 'v_nf.aceite_sacado_status NOT IN (''pendente'', ''contestado'')';
BEGIN
  v_definition := pg_get_functiondef('public.processar_aceite_sacado(uuid[],text,text)'::regprocedure);
  IF position(v_before IN v_definition) > 0 THEN
    IF (length(v_definition) - length(replace(v_definition, v_before, ''))) / length(v_before) <> 1 THEN
      RAISE EXCEPTION 'Unexpected Sacado decision RPC definition';
    END IF;
    EXECUTE replace(v_definition, v_before, v_after);
  ELSIF position(v_after IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unsupported Sacado decision RPC definition';
  END IF;

  v_definition := pg_get_functiondef('public.listar_cedentes_aprovacao_sacado()'::regprocedure);
  v_before := 'op.aceite_sacado_status = ''pendente''';
  v_after := 'op.aceite_sacado_status IN (''pendente'', ''contestado'')';
  IF position(v_before IN v_definition) > 0 THEN
    IF (length(v_definition) - length(replace(v_definition, v_before, ''))) / length(v_before) <> 1 THEN
      RAISE EXCEPTION 'Unexpected Sacado cedente filter definition';
    END IF;
    EXECUTE replace(v_definition, v_before, v_after);
  ELSIF position(v_after IN v_definition) = 0 THEN
    RAISE EXCEPTION 'Unsupported Sacado cedente filter definition';
  END IF;
END;
$migration$;

-- This private authorization lookup returns IDs only, using the same predicates
-- as sacado_tem_acesso_operacao_nf. It does not expose a business projection or
-- grant table writes. The calling dashboard remains SECURITY INVOKER with RLS.
CREATE OR REPLACE FUNCTION private.sacado_vinculos_autorizados()
RETURNS TABLE(operacao_id uuid, nota_fiscal_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
  WITH contexto AS MATERIALIZED (
    SELECT c.cnpj, c.fundo_id FROM private.sacado_contexto() c
    WHERE c.user_id = (SELECT auth.uid())
  )
  SELECT onf.operacao_id, onf.nota_fiscal_id
  FROM contexto ctx
  JOIN public.notas_fiscais nf
    ON regexp_replace(nf.cnpj_destinatario, '\D', '', 'g') = ctx.cnpj
    AND nf.fundo_id = ctx.fundo_id
  JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id = nf.id
  JOIN public.operacoes op ON op.id = onf.operacao_id
  JOIN public.cedente_fundos cf
    ON cf.id = op.cedente_fundo_id AND cf.fundo_id = nf.fundo_id;
$function$;
REVOKE ALL ON FUNCTION private.sacado_vinculos_autorizados() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.sacado_vinculos_autorizados() TO authenticated;

-- Uncorrelated membership subqueries allow one authorization-set evaluation per
-- statement, replacing the repeated per-row calls. Preserve CNPJ + fund pairs:
-- independent IN lists would incorrectly authorize a cross-product of scopes.
ALTER POLICY notas_fiscais_sacado_select ON public.notas_fiscais USING (
  (regexp_replace(cnpj_destinatario, '\D', '', 'g'), fundo_id)
  IN (SELECT c.cnpj, c.fundo_id FROM private.sacado_contexto() c)
);
ALTER POLICY operacoes_nfs_sacado_select ON public.operacoes_nfs USING (
  (operacao_id, nota_fiscal_id)
  IN (SELECT v.operacao_id, v.nota_fiscal_id FROM private.sacado_vinculos_autorizados() v)
);
ALTER POLICY operacoes_sacado_select ON public.operacoes USING (
  id IN (SELECT v.operacao_id FROM private.sacado_vinculos_autorizados() v)
);
