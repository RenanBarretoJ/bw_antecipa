-- R2: shared registration/documents notify each active canonical fund separately.
-- Backend-only producer, invoked after the domain action has authorized and
-- persisted the event. Never expose a broadcast action to authenticated clients.
-- The invoker bridge needs namespace lookup, not CREATE or blanket EXECUTE.
-- R1 producers retain their explicit service_role EXECUTE revocations.
GRANT USAGE ON SCHEMA private TO service_role;
CREATE FUNCTION private.notificar_gestores_cadastro_cedente(
  p_cedente_id uuid, p_titulo text, p_mensagem text, p_tipo text, p_evento_key text
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_link record; v_count integer := 0;
BEGIN
  IF p_cedente_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.cedentes WHERE id = p_cedente_id
  ) THEN
    RAISE EXCEPTION 'NOTIFICACAO_CEDENTE_INVALIDO' USING ERRCODE = '22023';
  END IF;
  IF p_tipo IS NULL OR p_tipo NOT IN (
    'cadastro_cedente','documento_enviado','alteracao_cadastral',
    'documento_vencido','documento_a_vencer'
  ) OR nullif(btrim(p_evento_key),'') IS NULL OR length(p_evento_key) > 400
    OR nullif(btrim(p_titulo),'') IS NULL OR length(p_titulo) > 300
    OR nullif(btrim(p_mensagem),'') IS NULL OR length(p_mensagem) > 10000 THEN
    RAISE EXCEPTION 'NOTIFICACAO_EVENTO_CADASTRAL_INVALIDO' USING ERRCODE = '22023';
  END IF;

  FOR v_link IN
    SELECT cf.id, cf.fundo_id FROM public.cedente_fundos cf
    JOIN public.fundos f ON f.id = cf.fundo_id AND f.ativo IS TRUE
    WHERE cf.cedente_id = p_cedente_id AND cf.status = 'ativo'
      AND cf.vigente_desde <= now() AND (cf.vigente_ate IS NULL OR cf.vigente_ate > now())
    ORDER BY cf.fundo_id, cf.id
  LOOP
    v_count := v_count + private.notificar_gestores_fundo(
      v_link.fundo_id, p_titulo, p_mensagem, p_tipo,
      'cadastro:' || p_cedente_id::text || ':event:' || p_tipo || ':' || p_evento_key,
      v_link.id, p_cedente_id, 'cedente_fundo', v_link.id
    );
  END LOOP;
  -- No active link means no recipient, not GLOBAL or an inferred fund.
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION private.notificar_gestores_cadastro_cedente(uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.notificar_gestores_cadastro_cedente(uuid,text,text,text,text) TO service_role;

CREATE FUNCTION public.notificar_gestores_cadastro_cedente(
  p_cedente_id uuid, p_titulo text, p_mensagem text, p_tipo text, p_evento_key text
) RETURNS integer LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
  SELECT private.notificar_gestores_cadastro_cedente(p_cedente_id,p_titulo,p_mensagem,p_tipo,p_evento_key);
$$;
REVOKE ALL ON FUNCTION public.notificar_gestores_cadastro_cedente(uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.notificar_gestores_cadastro_cedente(uuid,text,text,text,text) TO service_role;
