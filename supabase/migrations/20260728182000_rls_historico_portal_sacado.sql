-- Auditoria Portal Sacado: permitir leitura e escrita controlada do historico operacional visivel ao sacado.
-- O modelo atual de visibilidade possui apenas interno/cedente/ambos. Para o sacado,
-- somente eventos "ambos" vinculados a NFs destinadas ao CNPJ autenticado podem ser lidos.

DO $$
BEGIN
  IF to_regclass('public.eventos_dominio') IS NULL THEN
    RAISE NOTICE 'Tabela public.eventos_dominio nao existe; policy do portal sacado nao aplicada.';
    RETURN;
  END IF;

  DROP POLICY IF EXISTS eventos_dominio_sacado_select ON public.eventos_dominio;

  CREATE POLICY eventos_dominio_sacado_select
    ON public.eventos_dominio
    FOR SELECT
    TO authenticated
    USING (
      public.get_user_role() = 'sacado'
      AND visibilidade = 'ambos'
      AND (
        (
          nota_fiscal_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.notas_fiscais nf
            WHERE nf.id = eventos_dominio.nota_fiscal_id
              AND nf.cnpj_destinatario = public.get_user_sacado_cnpj()
          )
        )
        OR (
          operacao_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.operacoes_nfs onf
            JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
            WHERE onf.operacao_id = eventos_dominio.operacao_id
              AND nf.cnpj_destinatario = public.get_user_sacado_cnpj()
          )
        )
      )
    );

  -- Acoes executadas pelo sacado (aceite, contestacao e aviso de pagamento)
  -- precisam entrar no historico operacional unificado sem usar service role.
  -- A policy preserva as regras existentes de gestor/cedente e adiciona somente
  -- inserts visiveis a ambos, vinculados a NF/operacao do CNPJ do sacado autenticado.
  DROP POLICY IF EXISTS eventos_dominio_insert ON public.eventos_dominio;

  CREATE POLICY eventos_dominio_insert
    ON public.eventos_dominio
    FOR INSERT
    TO authenticated
    WITH CHECK (
      (
        public.get_user_role() = 'gestor'
        AND (
          fundo_id IS NULL
          OR EXISTS (
            SELECT 1
            FROM public.usuario_fundos uf
            WHERE uf.usuario_id = (SELECT auth.uid())
              AND uf.fundo_id = eventos_dominio.fundo_id
              AND uf.status = 'ativo'
          )
        )
      )
      OR (
        public.get_user_role() = 'cedente'
        AND cedente_id = public.get_user_cedente_id()
        AND visibilidade IN ('cedente', 'ambos')
      )
      OR (
        public.get_user_role() = 'sacado'
        AND visibilidade = 'ambos'
        AND (
          (
            nota_fiscal_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.notas_fiscais nf
              WHERE nf.id = eventos_dominio.nota_fiscal_id
                AND nf.cnpj_destinatario = public.get_user_sacado_cnpj()
            )
          )
          OR (
            operacao_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.operacoes_nfs onf
              JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
              WHERE onf.operacao_id = eventos_dominio.operacao_id
                AND nf.cnpj_destinatario = public.get_user_sacado_cnpj()
            )
          )
        )
      )
    );
END $$;
