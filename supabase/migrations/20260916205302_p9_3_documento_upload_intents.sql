-- P9.3: transport state is distinct from the canonical document version.
CREATE TABLE public.documento_upload_intents (
  id uuid PRIMARY KEY,
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id),
  usuario_id uuid NOT NULL REFERENCES auth.users(id),
  tipo_documento public.documento_tipo NOT NULL,
  representante_id uuid REFERENCES public.representantes(id),
  storage_bucket text NOT NULL DEFAULT 'documentos-cedentes' CHECK (storage_bucket = 'documentos-cedentes'),
  storage_path text NOT NULL UNIQUE CHECK (length(storage_path) BETWEEN 1 AND 1024 AND storage_path !~ '(^|/)\.\.(/|$)' AND storage_path !~ '[\\]'),
  nome_original text NOT NULL CHECK (length(nome_original) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png')),
  tamanho_esperado bigint NOT NULL CHECK (tamanho_esperado BETWEEN 1 AND 20971520),
  status text NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED','UPLOADED','FINALIZING','FINALIZED','FAILED','EXPIRED','CLEANUP_PENDING','CLEANED')),
  documento_id uuid REFERENCES public.documentos(id) ON DELETE SET NULL,
  documento_versao_id uuid REFERENCES public.documentos(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  uploaded_at timestamptz,
  finalized_at timestamptz,
  cleanup_after timestamptz NOT NULL,
  cleaned_at timestamptz,
  last_error_code text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT documento_upload_intents_timing CHECK (expires_at > created_at AND cleanup_after > created_at + interval '2 hours 5 minutes'),
  CONSTRAINT documento_upload_intents_finalized CHECK (status <> 'FINALIZED' OR (documento_id IS NOT NULL AND documento_versao_id IS NOT NULL AND finalized_at IS NOT NULL)),
  CONSTRAINT documento_upload_intents_cleaned CHECK (status <> 'CLEANED' OR cleaned_at IS NOT NULL)
);
CREATE INDEX documento_upload_intents_cleanup_idx ON public.documento_upload_intents(cleanup_after, id)
  WHERE status IN ('PREPARED','UPLOADED','FAILED','EXPIRED','CLEANUP_PENDING');
CREATE INDEX documento_upload_intents_owner_idx ON public.documento_upload_intents(usuario_id, created_at DESC);
CREATE UNIQUE INDEX documento_upload_intents_versao_unique ON public.documento_upload_intents(documento_versao_id) WHERE documento_versao_id IS NOT NULL;
ALTER TABLE public.documento_upload_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.documento_upload_intents FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.documento_upload_intents TO authenticated;
GRANT ALL ON public.documento_upload_intents TO service_role;
CREATE POLICY documento_upload_intents_select_own ON public.documento_upload_intents
  FOR SELECT TO authenticated USING (usuario_id = (SELECT auth.uid()) AND cedente_id = public.get_user_cedente_id());

-- Both the legacy document RPC and the P9.3 RPC insert into documentos. This
-- trigger serializes that insert with a claimed cleanup, so service-role
-- Storage deletion cannot race a new canonical version for the same path.
CREATE FUNCTION private.proteger_documento_upload_intent_em_limpeza()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_status text;
BEGIN
  SELECT status INTO v_status FROM public.documento_upload_intents
  WHERE storage_path = NEW.url_arquivo FOR UPDATE;
  IF v_status IN ('CLEANUP_PENDING','CLEANED') THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Upload em limpeza nao pode ser registrado';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.proteger_documento_upload_intent_em_limpeza() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER proteger_documento_upload_intent_em_limpeza
  BEFORE INSERT ON public.documentos FOR EACH ROW
  EXECUTE FUNCTION private.proteger_documento_upload_intent_em_limpeza();

CREATE FUNCTION public.finalizar_documento_upload_intent(p_intent_id uuid)
RETURNS TABLE (documento_id uuid, versao integer, status public.documento_status, storage_path text, novo_registro boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_intent public.documento_upload_intents%ROWTYPE;
  v_result record;
  v_objeto record;
BEGIN
  IF auth.uid() IS NULL OR (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Autenticacao obrigatoria';
  END IF;
  SELECT * INTO v_intent FROM public.documento_upload_intents
  WHERE id = p_intent_id FOR UPDATE;
  IF NOT FOUND OR v_intent.usuario_id IS DISTINCT FROM auth.uid()
    OR v_intent.cedente_id IS DISTINCT FROM public.get_user_cedente_id() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Upload nao autorizado';
  END IF;
  IF v_intent.status = 'FINALIZED' THEN
    RETURN QUERY SELECT d.id, d.versao, d.status, d.url_arquivo, false
      FROM public.documentos d WHERE d.id = v_intent.documento_versao_id
        AND d.cedente_id = v_intent.cedente_id AND d.url_arquivo = v_intent.storage_path;
    IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Versao finalizada inconsistente'; END IF;
    RETURN;
  END IF;
  IF v_intent.status IN ('CLEANUP_PENDING','CLEANED','EXPIRED') OR now() >= v_intent.expires_at THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Upload expirado ou em limpeza';
  END IF;
  SELECT o.owner_id, o.metadata INTO v_objeto FROM storage.objects o
    WHERE o.bucket_id = v_intent.storage_bucket AND o.name = v_intent.storage_path;
  IF NOT FOUND OR v_objeto.owner_id IS DISTINCT FROM auth.uid()::text
    OR lower(coalesce(v_objeto.metadata->>'mimetype','')) <> v_intent.mime_type
    OR coalesce(v_objeto.metadata->>'size','') !~ '^[0-9]+$'
    OR (v_objeto.metadata->>'size')::bigint <> v_intent.tamanho_esperado THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Objeto nao corresponde ao intent';
  END IF;
  SELECT * INTO v_result FROM public.registrar_documento_cadastral_cedente(
    v_intent.tipo_documento, v_intent.storage_path, v_intent.nome_original, v_intent.representante_id);
  IF NOT FOUND THEN RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'Registro documental sem versao'; END IF;
  UPDATE public.documento_upload_intents i SET status='FINALIZED', documento_id=v_result.documento_id,
    documento_versao_id=v_result.documento_id, uploaded_at=coalesce(i.uploaded_at, now()),
    finalized_at=now(), updated_at=now(), last_error_code=null WHERE i.id=p_intent_id;
  INSERT INTO public.logs_auditoria (usuario_id, tipo_evento, entidade_tipo, entidade_id, dados_depois, origem)
    VALUES (auth.uid(), 'DOCUMENTO_ENVIADO', 'documentos', v_result.documento_id,
      pg_catalog.jsonb_build_object('upload_intent_id', p_intent_id, 'tipo', v_intent.tipo_documento,
        'versao', v_result.versao, 'nome_arquivo', v_intent.nome_original), 'upload_intent');
  RETURN QUERY SELECT v_result.documento_id::uuid, v_result.versao::integer,
    v_result.status::public.documento_status, v_result.storage_path::text, true;
END;
$$;
REVOKE ALL ON FUNCTION public.finalizar_documento_upload_intent(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalizar_documento_upload_intent(uuid) TO authenticated;
