-- O bucket contratos e o cadastro do Cedente permanecem sem escrita direta.
-- Esta RPC e a unica mutacao nova: referencia versionada + auditoria atomicas.
BEGIN;

CREATE FUNCTION public.registrar_contrato_assinado_cedente(
  p_cedente_id uuid, p_fundo_id uuid, p_path_anterior text, p_path_novo text,
  p_sha256 text, p_tamanho bigint, p_nome_original text
) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_anterior text;
  v_objeto storage.objects%ROWTYPE;
BEGIN
  IF v_actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_actor AND p.role::text = 'gestor' AND p.status::text = 'ativo'
    FOR SHARE
  ) OR NOT EXISTS (
    SELECT 1 FROM public.obter_sessao_mfa_atual() m WHERE m.status = 'valid' AND m.metodo = 'totp'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CONTRACT_SESSION_DENIED';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.usuario_fundos uf JOIN public.fundos f ON f.id = uf.fundo_id
    WHERE uf.usuario_id = v_actor AND uf.fundo_id = p_fundo_id AND uf.status = 'ativo'
      AND uf.perfil_no_fundo IN ('gestor', 'administrador', 'operador', 'plataforma') AND f.ativo IS TRUE
    FOR SHARE OF uf, f
  ) OR NOT EXISTS (
    SELECT 1 FROM public.cedente_fundos cf
    WHERE cf.cedente_id = p_cedente_id AND cf.fundo_id = p_fundo_id AND cf.status = 'ativo'
    FOR SHARE
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'CONTRACT_FUND_DENIED';
  END IF;

  IF p_path_novo IS NULL OR p_path_novo !~ (
    '^cedentes/' || p_cedente_id::text || '/assinados/contrato-cessao/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
  ) OR p_sha256 IS NULL OR p_sha256 !~ '^[0-9a-f]{64}$'
    OR p_tamanho IS NULL OR p_tamanho NOT BETWEEN 1 AND 4194304
    OR p_nome_original IS NULL OR p_nome_original !~ '^[a-zA-Z0-9._-]{1,180}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONTRACT_INVALID_METADATA';
  END IF;

  SELECT c.contrato_assinado_url INTO v_anterior FROM public.cedentes c
    WHERE c.id = p_cedente_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'CONTRACT_CEDENTE_NOT_FOUND';
  END IF;

  SELECT o.* INTO v_objeto FROM storage.objects o
    WHERE o.bucket_id = 'contratos' AND o.name = p_path_novo FOR SHARE;
  IF NOT FOUND OR v_objeto.metadata->>'mimetype' IS DISTINCT FROM 'application/pdf'
    OR v_objeto.metadata->>'size' IS DISTINCT FROM p_tamanho::text
    OR v_objeto.user_metadata->>'sha256' IS DISTINCT FROM p_sha256
    OR v_objeto.user_metadata->>'usuario_id' IS DISTINCT FROM v_actor::text
    OR v_objeto.user_metadata->>'fundo_id' IS DISTINCT FROM p_fundo_id::text THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONTRACT_OBJECT_NOT_VERIFIED';
  END IF;

  -- Retry do mesmo objeto nao cria um segundo evento de auditoria.
  IF v_anterior = p_path_novo AND EXISTS (
    SELECT 1 FROM public.logs_auditoria l WHERE l.entidade_id = p_cedente_id
      AND l.entidade_tipo = 'cedentes' AND l.usuario_id = v_actor
      AND l.origem = 'api_cedente_contrato_assinado'
      AND l.dados_depois->>'storage_path' = p_path_novo
      AND l.dados_depois->>'sha256' = p_sha256
  ) THEN RETURN p_path_novo; END IF;

  IF v_anterior IS DISTINCT FROM p_path_anterior THEN
    RAISE EXCEPTION USING ERRCODE = '40001', MESSAGE = 'CONTRACT_CONCURRENT_REPLACEMENT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.logs_auditoria l WHERE l.origem = 'api_cedente_contrato_assinado'
      AND l.entidade_id = p_cedente_id AND l.dados_depois->>'storage_path' = p_path_novo
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'CONTRACT_VERSION_ALREADY_USED';
  END IF;

  UPDATE public.cedentes SET contrato_assinado_url = p_path_novo WHERE id = p_cedente_id;
  INSERT INTO public.logs_auditoria (
    usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_antes, dados_depois
  ) VALUES (
    v_actor, 'usuario', 'api_cedente_contrato_assinado',
    CASE WHEN v_anterior IS NULL THEN 'DOCUMENTO_ASSINADO_ANEXADO' ELSE 'DOCUMENTO_ASSINADO_SUBSTITUIDO' END,
    'cedentes', p_cedente_id,
    jsonb_build_object('storage_path', v_anterior, 'tipo_documento', 'contrato_assinado'),
    jsonb_build_object('storage_path', p_path_novo, 'tipo_documento', 'contrato_assinado',
      'fundo_id', p_fundo_id, 'sha256', p_sha256, 'tamanho_bytes', p_tamanho,
      'mime_type', 'application/pdf', 'nome_original', p_nome_original)
  );
  -- O objeto anterior e privado e historico: nunca e removido por substituicao.
  RETURN p_path_novo;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_contrato_assinado_cedente(uuid,uuid,text,text,text,bigint,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.registrar_contrato_assinado_cedente(uuid,uuid,text,text,text,bigint,text) TO authenticated;
COMMENT ON FUNCTION public.registrar_contrato_assinado_cedente(uuid,uuid,text,text,text,bigint,text)
  IS 'Registro atomico de contrato privado pelo Gestor: MFA, Fundo, vinculo, objeto verificado, CAS e auditoria. Sem grants diretos.';

COMMIT;
