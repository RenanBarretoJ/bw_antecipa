-- Emergency regression fix: permissive RLS evaluates the Sacado helpers for
-- other authenticated roles too. Exit before traversing operations/invoices.
-- PL/pgSQL IF guarantees the branch is skipped (SQL AND may be reordered).
-- Preserve exact CNPJ + canonical fund checks, function ACLs and all data.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

CREATE OR REPLACE FUNCTION private.sacado_tem_acesso_cnpj_fundo(p_cnpj text, p_fundo_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.get_user_role() IS DISTINCT FROM 'sacado' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM private.sacado_contexto() c
    WHERE c.cnpj = regexp_replace(p_cnpj, '\D', '', 'g') AND c.fundo_id = p_fundo_id);
END;
$$;

CREATE OR REPLACE FUNCTION private.sacado_tem_acesso_operacao_nf(
  p_operacao_id uuid, p_nota_fiscal_id uuid
)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.get_user_role() IS DISTINCT FROM 'sacado' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.operacoes_nfs onf
    JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
    JOIN public.operacoes op ON op.id = onf.operacao_id
    JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
    WHERE onf.operacao_id = p_operacao_id AND nf.id = p_nota_fiscal_id
      AND nf.fundo_id = cf.fundo_id
      AND private.sacado_tem_acesso_cnpj_fundo(nf.cnpj_destinatario, cf.fundo_id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION private.sacado_tem_acesso_operacao(p_operacao_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.get_user_role() IS DISTINCT FROM 'sacado' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.operacoes_nfs onf WHERE onf.operacao_id = p_operacao_id
      AND private.sacado_tem_acesso_operacao_nf(p_operacao_id, onf.nota_fiscal_id)
  );
END;
$$;

COMMIT;
