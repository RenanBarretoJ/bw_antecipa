-- Diagnostic quarantine only. Does not change callback acceptance, financial events or existing grants.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';

CREATE TABLE private.vortx_callback_diagnosticos (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 endpoint_id uuid NOT NULL REFERENCES private.vortx_callback_endpoints(id) ON DELETE RESTRICT,
 fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
 ambiente text NOT NULL CHECK(ambiente IN ('producao','homologacao')),
 revisao integer NOT NULL CHECK(revisao>0),
 motivo text NOT NULL CHECK(motivo IN ('JSON_INVALIDO','CONTRATO_INVALIDO')),
 bytes integer NOT NULL CHECK(bytes BETWEEN 0 AND 16384),
 hash_corpo text NOT NULL CHECK(hash_corpo ~ '^[0-9a-f]{64}$'),
 payload_criptografado text NOT NULL CHECK(length(payload_criptografado) BETWEEN 32 AND 160000 AND payload_criptografado LIKE 'v1:%'),
 chave_versao text NOT NULL CHECK(length(chave_versao) BETWEEN 1 AND 80),
 recebido_em timestamptz NOT NULL DEFAULT clock_timestamp(),
 expira_em timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
 UNIQUE(endpoint_id,hash_corpo)
);
CREATE INDEX vortx_callback_diagnosticos_expira_idx ON private.vortx_callback_diagnosticos(expira_em);
ALTER TABLE private.vortx_callback_diagnosticos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.vortx_callback_diagnosticos FROM PUBLIC,anon,authenticated,service_role;

-- SECURITY DEFINER is necessary solely for this private quarantine; no direct table grants or read RPC.
CREATE FUNCTION public.vortx_registrar_callback_rejeitado(p_id uuid,p_segredo_hash text,p_revisao integer,
 p_motivo text,p_bytes integer,p_hash text,p_ciphertext text,p_chave_versao text,p_capturar_ate timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e private.vortx_callback_endpoints%ROWTYPE; inserted_id uuid;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 IF p_capturar_ate IS NULL OR p_capturar_ate<=clock_timestamp() OR p_capturar_ate>clock_timestamp()+interval '24 hours' THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Janela de diagnostico invalida';
 END IF;
 SELECT * INTO e FROM private.vortx_callback_endpoints WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR NOT e.ativo OR e.segredo_hash IS DISTINCT FROM p_segredo_hash OR e.revisao IS DISTINCT FROM p_revisao
  OR NOT EXISTS(SELECT 1 FROM public.fundos WHERE id=e.fundo_id AND ativo)
  OR NOT EXISTS(SELECT 1 FROM public.integracoes_fundo WHERE id=e.integracao_id AND fundo_id=e.fundo_id AND status='ativa' AND provider_key='VORTX') THEN
  RAISE EXCEPTION USING ERRCODE='42501',MESSAGE='Callback nao autorizado';
 END IF;
 IF p_motivo IS NULL OR p_motivo NOT IN ('JSON_INVALIDO','CONTRATO_INVALIDO')
  OR p_bytes IS NULL OR p_bytes NOT BETWEEN 0 AND 16384
  OR p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$'
  OR p_ciphertext IS NULL OR length(p_ciphertext) NOT BETWEEN 32 AND 160000 OR p_ciphertext NOT LIKE 'v1:%'
  OR p_chave_versao IS NULL OR length(p_chave_versao) NOT BETWEEN 1 AND 80 THEN
  RAISE EXCEPTION USING ERRCODE='22023',MESSAGE='Diagnostico invalido';
 END IF;
 IF EXISTS(SELECT 1 FROM private.vortx_callback_diagnosticos WHERE endpoint_id=e.id AND hash_corpo=p_hash) THEN
  RETURN jsonb_build_object('estado','DUPLICADO');
 END IF;
 -- Serialised by the endpoint lock. Repeated invalid events cannot grow storage without bound.
 IF (SELECT count(*) FROM private.vortx_callback_diagnosticos WHERE endpoint_id=e.id)>=20 THEN
  RETURN jsonb_build_object('estado','LIMITE');
 END IF;
 INSERT INTO private.vortx_callback_diagnosticos(endpoint_id,fundo_id,ambiente,revisao,motivo,bytes,hash_corpo,payload_criptografado,chave_versao)
 VALUES(e.id,e.fundo_id,e.ambiente,e.revisao,p_motivo,p_bytes,p_hash,p_ciphertext,p_chave_versao)
 RETURNING id INTO inserted_id;
 RETURN jsonb_build_object('estado','SALVO');
END;
$$;

-- Explicit operator maintenance, not a cron and never deletes valid/historical callback events.
CREATE FUNCTION public.vortx_limpar_callback_diagnosticos_expirados() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE removed integer;
BEGIN
 PERFORM private.vortx_callback_exigir_worker();
 DELETE FROM private.vortx_callback_diagnosticos WHERE expira_em<=clock_timestamp();
 GET DIAGNOSTICS removed = ROW_COUNT;
 RETURN removed;
END;
$$;
REVOKE ALL ON FUNCTION public.vortx_registrar_callback_rejeitado(uuid,text,integer,text,integer,text,text,text,timestamptz),
 public.vortx_limpar_callback_diagnosticos_expirados() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.vortx_registrar_callback_rejeitado(uuid,text,integer,text,integer,text,text,text,timestamptz),
 public.vortx_limpar_callback_diagnosticos_expirados() TO service_role;
COMMENT ON TABLE private.vortx_callback_diagnosticos IS 'Quarentena diagnostica privada e criptografada. Maximo 20 corpos por endpoint. Expiracao 24h com limpeza explicita; nao e inbox valido nem importacao.';
COMMIT;
