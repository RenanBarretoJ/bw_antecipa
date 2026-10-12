BEGIN;
-- Human access to the SAME receipt; no mailbox credentials cross this RPC.
CREATE FUNCTION public.fiscal_intake_read_email_review(p_fundo_id uuid,p_cedente_fundo_id uuid,p_review_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r private.fiscal_identity_reservations%ROWTYPE; v public.nfse_review_intents%ROWTYPE; v_matriz uuid;
BEGIN
  SELECT e.id INTO v_matriz FROM public.cedente_fundos cf JOIN public.cedente_estabelecimentos e ON e.cedente_id=cf.cedente_id AND e.tipo='matriz'
    WHERE cf.id=p_cedente_fundo_id AND cf.fundo_id=p_fundo_id;
  IF v_matriz IS NULL THEN RAISE EXCEPTION 'FISCAL_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
  PERFORM private.fiscal_validate_actor(jsonb_build_object('type','HUMAN','userId',auth.uid()),p_fundo_id,p_cedente_fundo_id,v_matriz);
  SELECT r0.* INTO r FROM private.fiscal_identity_reservations r0
    JOIN public.nfse_review_intents v0 ON v0.id=r0.review_intent_id
    WHERE r0.fundo_id=p_fundo_id AND r0.cedente_fundo_id=p_cedente_fundo_id AND r0.source_channel='EMAIL_INTAKE'
      AND r0.state='REQUIRES_REVIEW' AND v0.state='REVIEW' AND v0.expires_at>clock_timestamp()
      AND (p_review_id IS NULL OR v0.id=p_review_id) ORDER BY r0.created_at,r0.id LIMIT 1;
  IF r.id IS NULL THEN RETURN NULL; END IF;
  PERFORM private.fiscal_validate_actor(jsonb_build_object('type','HUMAN','userId',auth.uid()),r.fundo_id,r.cedente_fundo_id,r.estabelecimento_id);
  SELECT * INTO v FROM public.nfse_review_intents WHERE id=r.review_intent_id;
  RETURN jsonb_build_object('id',v.id,'fileSha256',v.file_sha256,'fiscalSha256',v.fiscal_sha256,'identitySha256',v.identity_sha256);
END;
$$;
REVOKE ALL ON FUNCTION public.fiscal_intake_read_email_review(uuid,uuid,uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.fiscal_intake_read_email_review(uuid,uuid,uuid) TO authenticated;

-- Called only after the authenticated receipt read by the server action. The
-- provider configuration is server-only and revalidates the domain routing.
CREATE FUNCTION public.fiscal_intake_get_review_source(p_review_id uuid,p_fundo_id uuid,p_cedente_fundo_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_result jsonb;
BEGIN
  SELECT jsonb_build_object('integrationId',i.id,'fundoId',i.fundo_id,'provider',i.provider,
    'mailbox',i.mailbox_address,'folderId',i.folder_id,'credentialEnvRef',i.credential_env_ref,
    'credentialCiphertext',i.credential_ciphertext,'credentialKeyVersion',i.credential_key_version,
    'messageExternalId',m.external_id,'attachmentExternalId',a.external_id,'fileName',a.file_name,
    'contentType',a.content_type,'size',a.size_bytes,'inline',a.inline,'kind',a.kind)
    INTO v_result FROM public.nfse_review_intents v JOIN private.fiscal_identity_reservations r ON r.id=v.fiscal_reservation_id
    JOIN private.email_intake_attachments a ON a.id=r.attachment_id AND a.message_id=r.message_id
    JOIN private.email_intake_messages m ON m.id=a.message_id AND m.integration_id=r.integration_id
    JOIN private.email_integrations i ON i.id=m.integration_id AND i.fundo_id=r.fundo_id
    JOIN public.fundos f ON f.id=i.fundo_id
    WHERE v.id=p_review_id AND r.fundo_id=p_fundo_id AND r.cedente_fundo_id=p_cedente_fundo_id
      AND v.state='REVIEW' AND v.expires_at>clock_timestamp() AND r.state='REQUIRES_REVIEW'
      AND r.source_channel='EMAIL_INTAKE' AND a.status='REQUIRES_REVIEW' AND i.enabled AND f.ativo
      AND m.received_at>=i.start_at AND a.kind='FILE' AND NOT a.inline AND a.size_bytes BETWEEN 1 AND 20971520
      AND private.estabelecimento_pode_originar(r.estabelecimento_id,r.cedente_id,r.fundo_id)
      AND (i.routing_mode='ALL_ACTIVE_CEDENTES' OR EXISTS (SELECT 1 FROM private.email_integration_cedentes c
        WHERE c.integration_id=i.id AND c.cedente_id=r.cedente_id AND c.active));
  IF v_result IS NULL THEN RAISE EXCEPTION 'FISCAL_REVIEW_DENIED' USING ERRCODE='42501'; END IF;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.fiscal_intake_get_review_source(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.fiscal_intake_get_review_source(uuid,uuid,uuid) TO service_role;
COMMIT;
