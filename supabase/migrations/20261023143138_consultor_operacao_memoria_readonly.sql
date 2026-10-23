-- Read-only financial projection for an active consultancy of the exact operation fund.
-- No writes, new grants, privileged functions, historical policy edits or data changes.
CREATE POLICY operacao_calculo_nfs_consultor_select
  ON public.operacao_calculo_nfs FOR SELECT TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'consultor'
    AND (SELECT private.consultor_tem_acesso_cedente(cedente_id))
    AND EXISTS (
      SELECT 1
      FROM public.operacoes o
      JOIN public.cedente_fundos cf ON cf.id = o.cedente_fundo_id
        AND cf.cedente_id = o.cedente_id AND cf.status = 'ativo'
      JOIN public.fundos f ON f.id = cf.fundo_id AND f.ativo = true
      JOIN public.consultor_cedentes cc ON cc.cedente_id = o.cedente_id AND cc.status = 'ativo'
      JOIN public.consultor_fundos cfu ON cfu.consultor_id = cc.consultor_id
        AND cfu.fundo_id = cf.fundo_id AND cfu.status = 'ativo'
      JOIN public.consultor_usuarios cu ON cu.consultor_id = cc.consultor_id
        AND cu.user_id = (SELECT auth.uid()) AND cu.status = 'ativo'
        AND cu.papel IN ('OWNER', 'ADMIN', 'OPERADOR')
      JOIN public.consultores co ON co.id = cu.consultor_id AND co.status = 'ativo'
      WHERE o.id = operacao_calculo_nfs.operacao_id
        AND o.cedente_id = operacao_calculo_nfs.cedente_id
        AND cf.fundo_id = operacao_calculo_nfs.fundo_id
    )
  );
