-- Temporary diagnostic quarantine, not callback authentication or a business-event inbox.
-- An operator must insert ONE bounded window in the isolated Preview. No public arming/read RPC.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE private.vortx_callback_capturas_temporarias (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 endpoint_id uuid NOT NULL REFERENCES private.vortx_callback_endpoints(id) ON DELETE RESTRICT,
 fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
 revisao integer NOT NULL CHECK(revisao>0),
 criada_em timestamptz NOT NULL DEFAULT clock_timestamp(),
 capturar_ate timestamptz NOT NULL,
 expira_em timestamptz NOT NULL,
 reservada_em timestamptz,
 concluida_em timestamptz,
 payload_criptografado text,
 chave_versao text,
 hash_captura text,
 bytes_corpo integer,
 corpo_completo boolean,
 status_http integer,
 CHECK(capturar_ate>criada_em AND capturar_ate<=criada_em+interval '2 hours'),
 CHECK(expira_em>capturar_ate AND expira_em<=criada_em+interval '24 hours'),
 CHECK(reservada_em IS NULL OR reservada_em>=criada_em),
 CHECK((concluida_em IS NULL AND payload_criptografado IS NULL AND chave_versao IS NULL
   AND hash_captura IS NULL AND bytes_corpo IS NULL AND corpo_completo IS NULL AND status_http IS NULL)
  OR (concluida_em IS NOT NULL AND reservada_em IS NOT NULL AND concluida_em>=reservada_em
   AND payload_criptografado IS NOT NULL AND length(payload_criptografado) BETWEEN 32 AND 180000
   AND payload_criptografado LIKE 'rsa1:%'
   AND chave_versao IS NOT NULL AND length(chave_versao) BETWEEN 1 AND 80
   AND hash_captura IS NOT NULL AND hash_captura ~ '^[0-9a-f]{64}$'
   AND bytes_corpo IS NOT NULL AND bytes_corpo BETWEEN 0 AND 16384
   AND corpo_completo IS NOT NULL AND status_http IS NOT NULL AND status_http BETWEEN 100 AND 599))
);
CREATE INDEX vortx_callback_capturas_expira_idx ON private.vortx_callback_capturas_temporarias(expira_em);
ALTER TABLE private.vortx_callback_capturas_temporarias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.vortx_callback_capturas_temporarias FROM PUBLIC,anon,authenticated,service_role;

-- SECURITY DEFINER is limited to reserving the operator-armed private diagnostic slot.
-- It does NOT authenticate the incoming sender or grant access to the regular callback inbox.
CREATE FUNCTION public.vortx_reservar_captura_callback(p_id uuid,p_endpoint_id uuid,p_fundo_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.vortx_callback_capturas_temporarias%ROWTYPE;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 SELECT * INTO c FROM private.vortx_callback_capturas_temporarias WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR c.reservada_em IS NOT NULL OR c.capturar_ate<=clock_timestamp()
  OR c.endpoint_id IS DISTINCT FROM p_endpoint_id OR c.fundo_id IS DISTINCT FROM p_fundo_id
  OR NOT EXISTS(SELECT 1 FROM private.vortx_callback_endpoints e
    JOIN public.fundos f ON f.id=e.fundo_id AND f.ativo
    JOIN public.integracoes_fundo i ON i.id=e.integracao_id AND i.fundo_id=e.fundo_id
      AND i.status='ativa' AND i.provider_key='VORTX'
    WHERE e.id=c.endpoint_id AND e.fundo_id=c.fundo_id AND e.revisao=c.revisao AND e.ativo) THEN
  RETURN jsonb_build_object('estado','IGNORADA');
 END IF;
 UPDATE private.vortx_callback_capturas_temporarias SET reservada_em=clock_timestamp() WHERE id=c.id;
 RETURN jsonb_build_object('estado','RESERVADA');
END;
$$;

CREATE FUNCTION public.vortx_concluir_captura_callback(p_id uuid,p_ciphertext text,p_chave_versao text,
 p_hash text,p_bytes integer,p_completo boolean,p_status integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE c private.vortx_callback_capturas_temporarias%ROWTYPE;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 SELECT * INTO c FROM private.vortx_callback_capturas_temporarias WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR c.reservada_em IS NULL OR c.concluida_em IS NOT NULL
  OR c.capturar_ate<=clock_timestamp() OR c.reservada_em<clock_timestamp()-interval '10 seconds'
  OR NOT EXISTS(SELECT 1 FROM private.vortx_callback_endpoints e
    JOIN public.fundos f ON f.id=e.fundo_id AND f.ativo
    JOIN public.integracoes_fundo i ON i.id=e.integracao_id AND i.fundo_id=e.fundo_id
      AND i.status='ativa' AND i.provider_key='VORTX'
    WHERE e.id=c.endpoint_id AND e.fundo_id=c.fundo_id AND e.revisao=c.revisao AND e.ativo) THEN
  RETURN jsonb_build_object('estado','IGNORADA');
 END IF;
 IF p_ciphertext IS NULL OR length(p_ciphertext) NOT BETWEEN 32 AND 180000 OR p_ciphertext NOT LIKE 'rsa1:%'
  OR p_chave_versao IS NULL OR length(p_chave_versao) NOT BETWEEN 1 AND 80
  OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' OR p_bytes IS NULL OR p_bytes NOT BETWEEN 0 AND 16384
  OR p_completo IS NULL OR p_status IS NULL OR p_status NOT BETWEEN 100 AND 599 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Captura diagnostica invalida';
 END IF;
 UPDATE private.vortx_callback_capturas_temporarias SET concluida_em=clock_timestamp(),
  payload_criptografado=p_ciphertext,chave_versao=p_chave_versao,hash_captura=p_hash,
  bytes_corpo=p_bytes,corpo_completo=p_completo,status_http=p_status WHERE id=c.id;
 RETURN jsonb_build_object('estado','SALVA');
END;
$$;

-- Expiry is logical until this explicit maintenance runs. No existing event/history is deleted.
CREATE FUNCTION public.vortx_limpar_capturas_callback_expiradas() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE removed integer;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 DELETE FROM private.vortx_callback_capturas_temporarias WHERE expira_em<=clock_timestamp();
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION public.vortx_reservar_captura_callback(uuid,uuid,uuid),
 public.vortx_concluir_captura_callback(uuid,text,text,text,integer,boolean,integer),
 public.vortx_limpar_capturas_callback_expiradas() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.vortx_reservar_captura_callback(uuid,uuid,uuid),
 public.vortx_concluir_captura_callback(uuid,text,text,text,integer,boolean,integer),
 public.vortx_limpar_capturas_callback_expiradas() TO service_role;
COMMENT ON TABLE private.vortx_callback_capturas_temporarias IS
 'Preview opt-in only: one unattributed raw application request per operator-armed window (max 2h). Encrypted; logical expiry max 24h, explicit purge. No operational event or sender authentication.';
COMMIT;
