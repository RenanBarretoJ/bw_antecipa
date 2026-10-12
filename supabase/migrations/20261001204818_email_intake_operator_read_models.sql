BEGIN;
ALTER TABLE private.email_intake_messages ADD COLUMN subject_preview text CHECK(length(subject_preview)<=240),
 ADD COLUMN sender_masked text CHECK(length(sender_masked)<=320), ADD COLUMN metadata_fetched_at timestamptz;

CREATE VIEW private.email_attachment_operator WITH(security_invoker=true) AS
 SELECT a.id,a.message_id,left(regexp_replace(a.file_name,'[[:cntrl:]]','','g'),260) file_name,
 a.content_type,a.size_bytes,left(a.sha256,12) sha_preview,a.status,a.last_error_code,a.attempts,a.available_at,a.completed_at,
 n.id nota_fiscal_id,coalesce(r.cedente_id,n.cedente_id) cedente_id,c.razao_social cedente_name,
 r.review_intent_id,coalesce(r.document_type,n.tipo_documento_fiscal) document_type,v.state review_state,
 CASE WHEN a.status='REQUIRES_REVIEW' AND r.state='REQUIRES_REVIEW' AND v.state='REVIEW' AND v.expires_at>now() THEN true ELSE false END review_available,
 CASE WHEN n.fiscal_proveniencia->>'strategy' IN('xml','pdf','pdf-text','pdf-vision','text','vision','danfse_v2_labels','danfse_v2_visual') THEN n.fiscal_proveniencia->>'strategy' END parser_strategy
 FROM private.email_intake_attachments a
 JOIN private.email_intake_messages m ON m.id=a.message_id
 JOIN private.email_integrations i ON i.id=m.integration_id
 LEFT JOIN LATERAL(SELECT * FROM private.fiscal_identity_reservations rr WHERE rr.attachment_id=a.id AND rr.fundo_id=i.fundo_id ORDER BY rr.updated_at DESC,rr.id LIMIT 1) r ON true
 LEFT JOIN public.notas_fiscais n ON n.id=a.nota_fiscal_id AND n.fundo_id=i.fundo_id
 LEFT JOIN public.cedentes c ON c.id=coalesce(r.cedente_id,n.cedente_id)
 LEFT JOIN public.nfse_review_intents v ON v.id=r.review_intent_id;
REVOKE ALL ON private.email_attachment_operator FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.email_operator_dashboard(p_fundo uuid,p_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT private.email_operator_allowed(p_fundo) THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF p_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.email_integrations WHERE id=p_id AND fundo_id=p_fundo) THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('integrations',coalesce(jsonb_agg(jsonb_build_object(
  'id',i.id,'name',i.name,'provider',i.provider,'environment',i.environment,'mailbox',i.mailbox_address,'mailboxObjectId',i.mailbox_object_id,
  'folderId',i.folder_id,'credentialId',i.credential_id,'routingMode',i.routing_mode,'startAt',i.start_at,'enabled',i.enabled,
  'configStatus',CASE WHEN i.enabled THEN 'ACTIVE' ELSE i.config_status END,'revision',i.config_revision,'testCompletedAt',i.test_completed_at,'testErrorCode',i.test_error_code,
  'testRevision',i.test_revision,'healthStatus',coalesce(a.health_status,'DISABLED'),'healthCheckedAt',a.health_checked_at,
  'health',private.email_health_snapshot(i.id),'cedenteIds',coalesce((SELECT jsonb_agg(cedente_id ORDER BY cedente_id) FROM private.email_integration_cedentes WHERE integration_id=i.id AND active),'[]'::jsonb),
  'alerts',coalesce((SELECT jsonb_agg(jsonb_build_object('code',error_class,'active',active,'firstSeen',raised_at,'lastSeen',last_notified_at,'resolvedAt',resolved_at) ORDER BY active DESC,raised_at DESC) FROM private.email_operational_alerts WHERE integration_id=i.id),'[]'::jsonb)
 ) ORDER BY i.name,i.id),'[]'::jsonb)) INTO result FROM (
  SELECT * FROM private.email_integrations WHERE fundo_id=p_fundo AND (p_id IS NULL OR id=p_id) ORDER BY name,id LIMIT 100
 ) i LEFT JOIN private.email_automation a ON a.integration_id=i.id;
 RETURN result||jsonb_build_object('canManageCredentials',private.usuario_e_super_admin(),'credentials',(
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',nome,'provider',provider_key,'environment',ambiente,'status',status,
    'lastTestAt',(SELECT max(test_completed_at) FROM private.email_integrations WHERE credential_id=c.id AND test_error_code IS NULL)) ORDER BY nome,c.id),'[]'::jsonb)
  FROM public.credenciais_integracao c WHERE fundo_id=p_fundo AND credential_type='oauth_client_credentials'
  AND provider_key='OUTLOOK_GRAPH' AND status='ativa' AND revogada_em IS NULL AND capabilities @> ARRAY['EMAIL_INTAKE']::text[]));
END $$;

CREATE FUNCTION public.email_operator_cedentes(p_fundo uuid,p_search text DEFAULT '',p_page integer DEFAULT 1) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF NOT private.email_operator_allowed(p_fundo) THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF p_page IS NULL OR p_page<1 OR p_page>10000 OR length(coalesce(p_search,''))>100 THEN RAISE EXCEPTION 'EMAIL_INVALID_FILTER'; END IF;
 WITH eligible AS(SELECT DISTINCT c.id,c.razao_social FROM public.cedentes c JOIN public.cedente_fundos cf ON cf.cedente_id=c.id
  WHERE cf.fundo_id=p_fundo AND cf.status='ativo' AND c.status='ativo' AND (coalesce(p_search,'')='' OR c.razao_social ILIKE '%'||replace(replace(replace(p_search,'\','\\'),'%','\%'),'_','\_')||'%')),
 page AS(SELECT * FROM eligible ORDER BY razao_social,id LIMIT 25 OFFSET (p_page-1)*25)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM eligible),'rows',coalesce(jsonb_agg(jsonb_build_object('id',id,'name',razao_social) ORDER BY razao_social,id),'[]'::jsonb)) INTO result FROM page;
 RETURN result;
END $$;

CREATE FUNCTION public.email_operator_inbox(p_fundo uuid,p_filter jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb; page_no integer:=coalesce((p_filter->>'page')::integer,1); page_size integer:=coalesce((p_filter->>'pageSize')::integer,25);
 v_id uuid:=(p_filter->>'integrationId')::uuid; v_cedente uuid:=(p_filter->>'cedenteId')::uuid;
 v_since timestamptz:=(p_filter->>'since')::timestamptz; v_until timestamptz:=(p_filter->>'until')::timestamptz; v_status text:=coalesce(p_filter->>'status','ALL');
BEGIN
 IF NOT private.email_operator_allowed(p_fundo) THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF page_no<1 OR page_no>100000 OR page_size NOT IN(25,50) OR v_status NOT IN('ALL','REVIEW','ERROR','IMPORTED','DUPLICATE')
  OR (v_since IS NOT NULL AND v_until IS NOT NULL AND v_since>v_until) OR length(coalesce(p_filter->>'errorCode',''))>80 THEN RAISE EXCEPTION 'EMAIL_INVALID_FILTER'; END IF;
 IF v_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM private.email_integrations WHERE id=v_id AND fundo_id=p_fundo) THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 WITH messages AS(
 SELECT m.id,m.received_at,m.subject_preview,m.sender_masked,m.discovery_source,i.name integration_name,i.provider,i.id integration_id,
  count(a.id)::integer attachment_count,count(a.id) FILTER(WHERE a.status='IMPORTED')::integer imported,
  count(a.id) FILTER(WHERE a.status='DUPLICATE')::integer duplicates,
  count(a.id) FILTER(WHERE a.status='REQUIRES_REVIEW')::integer review,
  count(a.id) FILTER(WHERE a.status IN('QUARANTINED','REJECTED','FAILED','CLEANUP_PENDING'))::integer errors,
  count(a.id) FILTER(WHERE a.status IN('PENDING','PROCESSING','RETRY'))::integer pending
 FROM private.email_integrations i JOIN private.email_intake_messages m ON m.integration_id=i.id
 LEFT JOIN private.email_intake_attachments a ON a.message_id=m.id
 WHERE i.fundo_id=p_fundo AND (v_id IS NULL OR i.id=v_id) AND (v_since IS NULL OR m.received_at>=v_since) AND (v_until IS NULL OR m.received_at<=v_until)
  AND (v_cedente IS NULL OR EXISTS(SELECT 1 FROM private.email_attachment_operator x WHERE x.message_id=m.id AND x.cedente_id=v_cedente))
  AND (nullif(p_filter->>'errorCode','') IS NULL OR EXISTS(SELECT 1 FROM private.email_intake_attachments x WHERE x.message_id=m.id AND x.last_error_code=p_filter->>'errorCode'))
  AND (nullif(p_filter->>'documentType','') IS NULL OR EXISTS(SELECT 1 FROM private.email_attachment_operator x WHERE x.message_id=m.id AND x.document_type=p_filter->>'documentType'))
 GROUP BY m.id,i.id), filtered AS(
 SELECT * FROM messages m WHERE (v_status='ALL' OR (v_status='REVIEW' AND review>0) OR (v_status='ERROR' AND errors>0)
  OR (v_status='IMPORTED' AND imported>0) OR (v_status='DUPLICATE' AND duplicates>0))
  AND (NOT coalesce((p_filter->>'reviewOnly')::boolean,false) OR EXISTS(SELECT 1 FROM private.email_attachment_operator x WHERE x.message_id=m.id AND x.review_available))),
 paged AS(SELECT * FROM filtered ORDER BY received_at DESC,id DESC LIMIT page_size OFFSET (page_no-1)*page_size)
 SELECT jsonb_build_object('total',(SELECT count(*) FROM filtered),'page',page_no,'pageSize',page_size,
  'rows',coalesce(jsonb_agg(to_jsonb(paged) ORDER BY received_at DESC,id DESC),'[]'::jsonb)) INTO result FROM paged;
 RETURN result;
END $$;

CREATE FUNCTION public.email_operator_message(p_fundo uuid,p_message uuid,p_page integer DEFAULT 1) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE m private.email_intake_messages; i private.email_integrations; result jsonb;
BEGIN
 IF NOT private.email_operator_allowed(p_fundo) THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 SELECT mm.* INTO m FROM private.email_intake_messages mm JOIN private.email_integrations ii ON ii.id=mm.integration_id WHERE mm.id=p_message AND ii.fundo_id=p_fundo;
 IF NOT FOUND THEN RAISE EXCEPTION 'EMAIL_ACCESS_DENIED' USING ERRCODE='42501'; END IF;
 IF p_page IS NULL OR p_page<1 OR p_page>1000 THEN RAISE EXCEPTION 'EMAIL_INVALID_FILTER'; END IF;
 SELECT * INTO i FROM private.email_integrations WHERE id=m.integration_id;
 SELECT jsonb_build_object('id',m.id,'receivedAt',m.received_at,'integrationId',i.id,'integrationName',i.name,'provider',i.provider,
  'subject',m.subject_preview,'sender',m.sender_masked,'discoverySource',m.discovery_source,
  'total',(SELECT count(*) FROM private.email_intake_attachments WHERE message_id=m.id),'page',p_page,
  'attachments',coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.id),'[]'::jsonb)) INTO result
 FROM(SELECT * FROM private.email_attachment_operator WHERE message_id=m.id ORDER BY id LIMIT 25 OFFSET(p_page-1)*25) a;
 RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.email_operator_dashboard(uuid,uuid),public.email_operator_cedentes(uuid,text,integer),
 public.email_operator_inbox(uuid,jsonb),public.email_operator_message(uuid,uuid,integer) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.email_operator_dashboard(uuid,uuid),public.email_operator_cedentes(uuid,text,integer),
 public.email_operator_inbox(uuid,jsonb),public.email_operator_message(uuid,uuid,integer) TO authenticated;
COMMIT;
