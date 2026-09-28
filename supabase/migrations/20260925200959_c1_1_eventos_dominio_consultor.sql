-- C1.1 hotfix: Consultores operacionais conseguiam concluir as actions, mas
-- eventos_dominio descartava silenciosamente o historico porque a policy de
-- INSERT contemplava apenas Gestor, Cedente e Sacado.
--
-- As policies abaixo sao adicionais e permissivas. Elas nao alteram os ramos
-- existentes e delegam papel, membership, organizacao, carteira e Fundo aos
-- predicates canonicos do C1.1. O recurso do evento tambem precisa coincidir
-- com Cedente, vinculo e Fundo informados, impedindo UUID/fundo adulterado.

BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.eventos_dominio') IS NULL
     OR to_regprocedure('private.consultor_tem_acesso_cedente(uuid)') IS NULL
     OR to_regprocedure('private.consultor_tem_acesso_fundo(uuid)') IS NULL THEN
    RAISE EXCEPTION 'C1.1 eventos_dominio: pre-requisitos ausentes';
  END IF;
END;
$preflight$;

DROP POLICY IF EXISTS eventos_dominio_consultor_select
  ON public.eventos_dominio;
CREATE POLICY eventos_dominio_consultor_select
  ON public.eventos_dominio
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'consultor'
    AND visibilidade IN ('cedente', 'ambos')
    AND cedente_id IS NOT NULL
    AND fundo_id IS NOT NULL
    AND cedente_fundo_id IS NOT NULL
    AND (SELECT private.consultor_tem_acesso_cedente(cedente_id))
    AND (SELECT private.consultor_tem_acesso_fundo(fundo_id))
  );

DROP POLICY IF EXISTS eventos_dominio_consultor_insert
  ON public.eventos_dominio;
CREATE POLICY eventos_dominio_consultor_insert
  ON public.eventos_dominio
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT public.get_user_role()) = 'consultor'
    AND ator_usuario_id = (SELECT auth.uid())
    AND visibilidade IN ('cedente', 'ambos')
    AND cedente_id IS NOT NULL
    AND fundo_id IS NOT NULL
    AND cedente_fundo_id IS NOT NULL
    AND (SELECT private.consultor_tem_acesso_cedente(cedente_id))
    AND (SELECT private.consultor_tem_acesso_fundo(fundo_id))
    AND EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.id = eventos_dominio.cedente_fundo_id
        AND cf.cedente_id = eventos_dominio.cedente_id
        AND cf.fundo_id = eventos_dominio.fundo_id
        AND cf.status = 'ativo'
    )
    AND (
      nota_fiscal_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.notas_fiscais nf
        WHERE nf.id = eventos_dominio.nota_fiscal_id
          AND nf.cedente_id = eventos_dominio.cedente_id
          AND nf.cedente_fundo_id = eventos_dominio.cedente_fundo_id
          AND nf.fundo_id = eventos_dominio.fundo_id
      )
    )
    AND (
      operacao_id IS NULL
      OR EXISTS (
        SELECT 1
        FROM public.operacoes op
        WHERE op.id = eventos_dominio.operacao_id
          AND op.cedente_id = eventos_dominio.cedente_id
          AND op.cedente_fundo_id = eventos_dominio.cedente_fundo_id
      )
    )
  );

COMMENT ON POLICY eventos_dominio_consultor_select ON public.eventos_dominio IS
  'C1.1: Consultor ativo le historico cedente/ambos somente da carteira e dos Fundos operacionais da organizacao.';
COMMENT ON POLICY eventos_dominio_consultor_insert ON public.eventos_dominio IS
  'C1.1: OWNER, ADMIN e OPERADOR registram eventos como ator individual somente em recursos da carteira/fundo autorizados; LEITOR e cross-org sao negados.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Rollback operacional deste hotfix:
-- DROP POLICY IF EXISTS eventos_dominio_consultor_insert ON public.eventos_dominio;
-- DROP POLICY IF EXISTS eventos_dominio_consultor_select ON public.eventos_dominio;
