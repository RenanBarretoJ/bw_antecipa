-- Auditoria do Portal do Sacado: normaliza o identificador usado por RLS e
-- garante que o historico e as notificacoes realtime respeitem o fluxo atual.

CREATE OR REPLACE FUNCTION public.get_user_sacado_cnpj()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT NULLIF(regexp_replace(COALESCE(s.cnpj, ''), '\D', '', 'g'), '')
    FROM public.sacados s
    WHERE s.user_id = auth.uid()
    LIMIT 1
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_sacado_cnpj() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_sacado_cnpj() TO authenticated, service_role;

DO $$
BEGIN
  IF to_regclass('public.eventos_dominio') IS NOT NULL THEN
    DROP POLICY IF EXISTS eventos_dominio_sacado_select ON public.eventos_dominio;

    CREATE POLICY eventos_dominio_sacado_select
      ON public.eventos_dominio
      FOR SELECT
      TO authenticated
      USING (
        public.get_user_role() = 'sacado'
        AND visibilidade IN ('cedente', 'ambos')
        AND (
          (
            nota_fiscal_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.notas_fiscais nf
              WHERE nf.id = eventos_dominio.nota_fiscal_id
                AND NULLIF(regexp_replace(COALESCE(nf.cnpj_destinatario, ''), '\D', '', 'g'), '') = public.get_user_sacado_cnpj()
            )
          )
          OR (
            operacao_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.operacoes_nfs onf
              JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
              WHERE onf.operacao_id = eventos_dominio.operacao_id
                AND NULLIF(regexp_replace(COALESCE(nf.cnpj_destinatario, ''), '\D', '', 'g'), '') = public.get_user_sacado_cnpj()
            )
          )
        )
      );
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND to_regclass('public.notificacoes') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'notificacoes'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notificacoes;
  END IF;
END $$;
