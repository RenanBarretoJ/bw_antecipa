-- C4 follow-up: consolida a leitura em uma unica policy permissiva para
-- preservar os papeis existentes e evitar avaliacao duplicada por consulta.

BEGIN;

DROP POLICY IF EXISTS cedente_estabelecimentos_consultor_select_c4
  ON public.cedente_estabelecimentos;
DROP POLICY IF EXISTS cedente_estabelecimentos_select
  ON public.cedente_estabelecimentos;

CREATE POLICY cedente_estabelecimentos_select
  ON public.cedente_estabelecimentos FOR SELECT TO authenticated
  USING (
    private.usuario_tem_acesso_cedente(cedente_estabelecimentos.cedente_id)
    OR private.gestor_tem_acesso_cedente(cedente_estabelecimentos.cedente_id)
    OR (
      (SELECT public.get_user_role()) = 'consultor'
      AND (SELECT private.usuario_pode_operar_cedente(cedente_estabelecimentos.cedente_id))
      AND EXISTS (
        SELECT 1
        FROM public.cedente_fundos cf
        WHERE cf.cedente_id = cedente_estabelecimentos.cedente_id
          AND cf.status = 'ativo'
          AND cf.vigente_desde <= now()
          AND (cf.vigente_ate IS NULL OR cf.vigente_ate > now())
          AND (SELECT private.consultor_tem_acesso_fundo(cf.fundo_id))
      )
    )
  );

COMMIT;
