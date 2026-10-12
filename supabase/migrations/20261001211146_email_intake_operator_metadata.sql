BEGIN;
-- UI-only metadata, fetched in bounded batches after authenticated fund authorization.
ALTER TABLE private.email_intake_messages ADD COLUMN metadata_token uuid, ADD COLUMN metadata_requested_at timestamptz;
CREATE INDEX email_metadata_token_idx ON private.email_intake_messages(metadata_token) WHERE metadata_token IS NOT NULL;

CREATE FUNCTION public.email_operator_begin_metadata(p_fundo uuid,p_ids uuid[]) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE token uuid:=gen_random_uuid();
BEGIN
 IF NOT private.email_operator_allowed(p_fundo) THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 50 OR array_position(p_ids,NULL) IS NOT NULL THEN RAISE EXCEPTION 'EMAIL_INVALID_FILTER'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(p_ids) x WHERE NOT EXISTS(SELECT 1 FROM private.email_intake_messages m JOIN private.email_integrations i ON i.id=m.integration_id WHERE m.id=x AND i.fundo_id=p_fundo)) THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 UPDATE private.email_intake_messages SET metadata_token=token,metadata_requested_at=now()
 WHERE id=ANY(p_ids) AND metadata_fetched_at IS NULL AND (metadata_requested_at IS NULL OR metadata_requested_at<now()-interval '5 minutes');
 RETURN token;
END $$;

-- Opaque Graph identities and legacy credential references never cross the server boundary.
CREATE FUNCTION public.email_operator_metadata_source(p_fundo uuid,p_token uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('integrationId',i.id,'fundoId',i.fundo_id,'provider',i.provider,'mailbox',i.mailbox_address,
  'folderId',i.folder_id,'credentialEnvRef',i.credential_env_ref,'credentialCiphertext',i.credential_ciphertext,'credentialKeyVersion',i.credential_key_version,
  'messages',m.rows)),'[]'::jsonb)
 FROM private.email_integrations i JOIN public.fundos f ON f.id=i.fundo_id AND f.ativo
 JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('id',id,'externalId',external_id) ORDER BY id) rows
   FROM private.email_intake_messages WHERE integration_id=i.id AND metadata_token=p_token AND metadata_requested_at>now()-interval '2 minutes') m ON m.rows IS NOT NULL
 WHERE i.fundo_id=p_fundo;
$$;

CREATE FUNCTION public.email_operator_complete_metadata(p_token uuid,p_rows jsonb) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE row jsonb; affected integer:=0;
BEGIN
 IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(p_rows)>50 THEN RAISE EXCEPTION 'EMAIL_INVALID_METADATA'; END IF;
 FOR row IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  IF length(row->>'subject')>240 OR length(row->>'sender')>320 OR row->>'subject' ~ '[[:cntrl:]]' OR row->>'sender' ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'EMAIL_INVALID_METADATA'; END IF;
  UPDATE private.email_intake_messages SET subject_preview=row->>'subject',sender_masked=row->>'sender',metadata_fetched_at=now(),metadata_token=NULL
  WHERE id=(row->>'id')::uuid AND metadata_token=p_token AND metadata_requested_at>now()-interval '2 minutes';
  IF FOUND THEN affected:=affected+1; END IF;
 END LOOP;
 RETURN affected;
END $$;

REVOKE ALL ON FUNCTION public.email_operator_begin_metadata(uuid,uuid[]) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.email_operator_begin_metadata(uuid,uuid[]) TO authenticated;
REVOKE ALL ON FUNCTION public.email_operator_metadata_source(uuid,uuid),public.email_operator_complete_metadata(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.email_operator_metadata_source(uuid,uuid),public.email_operator_complete_metadata(uuid,jsonb) TO service_role;
COMMIT;
