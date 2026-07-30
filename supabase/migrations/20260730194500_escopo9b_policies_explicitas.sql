-- Escopo 9B - separa policies administrativas por comando para que cada
-- operacao tenha USING/WITH CHECK explicitamente auditavel.

BEGIN;

DROP POLICY IF EXISTS usuario_fundos_gestor_manage ON public.usuario_fundos;
DROP POLICY IF EXISTS usuario_fundos_gestor_insert ON public.usuario_fundos;
DROP POLICY IF EXISTS usuario_fundos_gestor_update ON public.usuario_fundos;
DROP POLICY IF EXISTS usuario_fundos_gestor_delete ON public.usuario_fundos;

CREATE POLICY usuario_fundos_gestor_insert ON public.usuario_fundos
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT private.usuario_tem_acesso_fundo(usuario_fundos.fundo_id)));

CREATE POLICY usuario_fundos_gestor_update ON public.usuario_fundos
  FOR UPDATE TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(usuario_fundos.fundo_id)))
  WITH CHECK ((SELECT private.usuario_tem_acesso_fundo(usuario_fundos.fundo_id)));

CREATE POLICY usuario_fundos_gestor_delete ON public.usuario_fundos
  FOR DELETE TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(usuario_fundos.fundo_id)));

DROP POLICY IF EXISTS cedente_fundos_gestor_all ON public.cedente_fundos;
DROP POLICY IF EXISTS cedente_fundos_gestor_select ON public.cedente_fundos;
DROP POLICY IF EXISTS cedente_fundos_gestor_insert ON public.cedente_fundos;
DROP POLICY IF EXISTS cedente_fundos_gestor_update ON public.cedente_fundos;
DROP POLICY IF EXISTS cedente_fundos_gestor_delete ON public.cedente_fundos;

CREATE POLICY cedente_fundos_gestor_select ON public.cedente_fundos
  FOR SELECT TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(cedente_fundos.fundo_id)));

CREATE POLICY cedente_fundos_gestor_insert ON public.cedente_fundos
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT private.usuario_tem_acesso_fundo(cedente_fundos.fundo_id))
    AND EXISTS (
      SELECT 1 FROM public.fundos f
      WHERE f.id = cedente_fundos.fundo_id
        AND f.ativo IS TRUE
    )
  );

CREATE POLICY cedente_fundos_gestor_update ON public.cedente_fundos
  FOR UPDATE TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(cedente_fundos.fundo_id)))
  WITH CHECK (
    (SELECT private.usuario_tem_acesso_fundo(cedente_fundos.fundo_id))
    AND EXISTS (
      SELECT 1 FROM public.fundos f
      WHERE f.id = cedente_fundos.fundo_id
        AND f.ativo IS TRUE
    )
  );

CREATE POLICY cedente_fundos_gestor_delete ON public.cedente_fundos
  FOR DELETE TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(cedente_fundos.fundo_id)));

DROP POLICY IF EXISTS consultor_cedente_gestor_all ON public.consultor_cedente;
DROP POLICY IF EXISTS consultor_cedente_gestor_select ON public.consultor_cedente;
DROP POLICY IF EXISTS consultor_cedente_gestor_insert ON public.consultor_cedente;
DROP POLICY IF EXISTS consultor_cedente_gestor_update ON public.consultor_cedente;
DROP POLICY IF EXISTS consultor_cedente_gestor_delete ON public.consultor_cedente;

CREATE POLICY consultor_cedente_gestor_select ON public.consultor_cedente
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.cedente_id = consultor_cedente.cedente_id
        AND cf.status IN ('ativo', 'suspenso')
        AND (SELECT private.usuario_tem_acesso_fundo(cf.fundo_id))
    )
  );

CREATE POLICY consultor_cedente_gestor_insert ON public.consultor_cedente
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.cedente_id = consultor_cedente.cedente_id
        AND cf.status IN ('ativo', 'suspenso')
        AND (SELECT private.usuario_tem_acesso_fundo(cf.fundo_id))
    )
  );

CREATE POLICY consultor_cedente_gestor_update ON public.consultor_cedente
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.cedente_id = consultor_cedente.cedente_id
        AND cf.status IN ('ativo', 'suspenso')
        AND (SELECT private.usuario_tem_acesso_fundo(cf.fundo_id))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.cedente_id = consultor_cedente.cedente_id
        AND cf.status IN ('ativo', 'suspenso')
        AND (SELECT private.usuario_tem_acesso_fundo(cf.fundo_id))
    )
  );

CREATE POLICY consultor_cedente_gestor_delete ON public.consultor_cedente
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.cedente_id = consultor_cedente.cedente_id
        AND cf.status IN ('ativo', 'suspenso')
        AND (SELECT private.usuario_tem_acesso_fundo(cf.fundo_id))
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
