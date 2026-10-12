-- Revalidate the persisted consultant during infrastructure staging without
-- installing a human JWT. The RLS helper intentionally binds p_user_id to
-- auth.uid(), which is null for this service-role request. Keep that helper
-- unchanged; reuse the canonical organization/fund predicates and require the
-- active consultant/cedente relationship for the stored, MFA-verified actor.
BEGIN;

CREATE OR REPLACE FUNCTION private.fiscal_validate_stored_actor(r private.fiscal_identity_reservations)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_role text;
BEGIN
  IF NOT private.estabelecimento_pode_originar(r.estabelecimento_id,r.cedente_id,r.fundo_id)
    THEN RAISE EXCEPTION 'FISCAL_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  IF r.source_channel='EMAIL_INTAKE' THEN
    PERFORM private.fiscal_validate_email_claim(jsonb_build_object('integrationId',r.integration_id,'messageId',r.message_id,
      'attachmentId',r.attachment_id,'attachmentToken',r.attachment_token),r.fundo_id,r.cedente_id);
  END IF;
  IF r.actor_type='SYSTEM' THEN RETURN; END IF;
  SELECT role::text INTO v_role FROM public.profiles WHERE id=r.actor_user_id AND status::text='ativo';
  IF v_role IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.sessions s JOIN public.sessoes_elevadas e ON e.session_id=s.id AND e.user_id=s.user_id
    JOIN auth.mfa_factors f ON f.id::text=e.factor_id AND f.user_id=s.user_id AND f.status='verified'
    WHERE s.id=r.actor_session_id AND s.user_id=r.actor_user_id AND s.aal='aal2'
      AND (s.not_after IS NULL OR s.not_after>clock_timestamp()) AND e.revogada_em IS NULL
      AND e.expira_em>clock_timestamp() AND e.metodo='totp'
  ) THEN RAISE EXCEPTION 'FISCAL_ACTOR_DENIED' USING ERRCODE='42501'; END IF;
  IF NOT coalesce(CASE v_role
    WHEN 'cedente' THEN private.cedente_usuario_tem_acesso(r.actor_user_id,r.cedente_id)
    WHEN 'consultor' THEN EXISTS (
      SELECT 1 FROM public.consultor_cedentes cc
      JOIN public.cedentes c ON c.id=cc.cedente_id AND c.status='ativo'::public.cedente_status
      WHERE cc.consultor_id=private.consultor_organizacao_ativa_do_usuario(r.actor_user_id)
        AND cc.cedente_id=r.cedente_id AND cc.status='ativo'
    ) AND private.consultor_usuario_tem_acesso_fundo(r.actor_user_id,r.fundo_id)
    WHEN 'gestor' THEN EXISTS (SELECT 1 FROM public.usuario_fundos uf WHERE uf.usuario_id=r.actor_user_id AND uf.fundo_id=r.fundo_id AND uf.status='ativo')
    ELSE false END,false) THEN RAISE EXCEPTION 'FISCAL_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.fiscal_validate_stored_actor(private.fiscal_identity_reservations) FROM PUBLIC,anon,authenticated,service_role;

COMMIT;
