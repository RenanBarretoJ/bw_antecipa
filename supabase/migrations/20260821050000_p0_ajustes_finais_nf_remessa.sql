-- P0 Claude: Ajustes finais NF de Remessa.
--
-- Fecha a pendencia 2 do ticket de ajustes finais: torna
-- canhotos.nota_fiscal_remessa_id (adicionado em
-- 20260821040000_p0_nf_remessa_lastro_logistico.sql, mas apenas como
-- coluna informativa) funcional -- registrar_canhoto_documento passa a
-- aceitar e revalidar o vinculo com uma NF de remessa VALIDADA da mesma
-- venda.
--
-- Assinatura estendida apenas com um parametro DEFAULT no final --
-- chamadas existentes (sem remessa) continuam funcionando sem alteracao.

BEGIN;

CREATE OR REPLACE FUNCTION public.registrar_canhoto_documento(
  p_nota_fiscal_entrega_id uuid,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text,
  p_bucket text,
  p_path text,
  p_data_assinatura date DEFAULT NULL,
  p_nome_recebedor text DEFAULT NULL,
  p_documento_recebedor text DEFAULT NULL,
  p_possui_assinatura boolean DEFAULT false,
  p_possui_ressalva boolean DEFAULT false,
  p_descricao_ressalva text DEFAULT NULL,
  p_nota_fiscal_remessa_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor_role text := get_user_role();
  actor_id uuid := auth.uid();
  entrega record;
  tipo record;
  remessa record;
  doc_id uuid;
  version_id uuid;
  canhoto_id uuid;
BEGIN
  IF actor_id IS NULL OR actor_role NOT IN ('cedente', 'gestor') THEN
    RAISE EXCEPTION 'Usuario sem permissao para enviar canhoto';
  END IF;
  SELECT nfe.*, op.cedente_id INTO entrega
  FROM public.nota_fiscal_entregas nfe
  JOIN public.operacoes op ON op.id = nfe.operacao_id
  WHERE nfe.id = p_nota_fiscal_entrega_id;
  IF entrega.id IS NULL OR entrega.status_entrega IN ('nao_aplicavel', 'cancelada', 'devolvida', 'entregue') THEN
    RAISE EXCEPTION 'Entrega nao esta aberta para canhoto';
  END IF;
  IF actor_role = 'cedente' AND entrega.cedente_id <> get_user_cedente_id() THEN
    RAISE EXCEPTION 'Entrega fora do cedente autenticado';
  END IF;
  IF p_possui_ressalva AND length(trim(coalesce(p_descricao_ressalva, ''))) = 0 THEN
    RAISE EXCEPTION 'Descricao da ressalva e obrigatoria';
  END IF;
  IF p_bucket <> 'documentos-v2' OR p_tamanho_bytes <= 0 OR p_sha256 !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Metadados de armazenamento invalidos';
  END IF;
  SELECT * INTO tipo FROM public.documento_tipos WHERE codigo = 'canhoto' AND ativo = true;
  IF tipo.id IS NULL OR lower(p_mime_type) <> ALL (SELECT lower(unnest(tipo.mime_types_aceitos))) THEN
    RAISE EXCEPTION 'Arquivo de canhoto em formato invalido';
  END IF;

  -- Item 2 do ticket de ajustes finais: quando informada, a remessa
  -- precisa existir, estar VALIDADA e pertencer a MESMA NF de venda desta
  -- entrega -- nunca confia no id isoladamente. Uma remessa de outra
  -- venda, ou nao validada, e rejeitada (fail-closed). O SELECT INTO roda
  -- sempre (mesmo com p_nota_fiscal_remessa_id NULL) para que a variavel
  -- "remessa" fique assinalada (record vazio) e possa ser referenciada
  -- adiante sem erro de "record is not assigned yet".
  SELECT * INTO remessa FROM public.nota_fiscal_remessas WHERE id = p_nota_fiscal_remessa_id;
  IF p_nota_fiscal_remessa_id IS NOT NULL THEN
    IF remessa.id IS NULL THEN
      RAISE EXCEPTION 'NF de remessa informada nao encontrada';
    END IF;
    IF remessa.status_validacao <> 'VALIDADA' THEN
      RAISE EXCEPTION 'NF de remessa informada nao esta validada';
    END IF;
    IF remessa.nota_fiscal_venda_id <> entrega.nota_fiscal_id THEN
      RAISE EXCEPTION 'NF de remessa informada nao pertence a esta NF de venda';
    END IF;
  END IF;

  INSERT INTO public.documentos_repositorio (documento_tipo_id, status, criado_por)
  VALUES (tipo.id, 'enviado', actor_id)
  RETURNING id INTO doc_id;

  INSERT INTO public.documento_versoes (
    documento_id, numero_versao, bucket, path, nome_original, mime_type, tamanho_bytes, sha256,
    status, enviado_por
  )
  VALUES (doc_id, 1, p_bucket, p_path, p_nome_original, lower(p_mime_type), p_tamanho_bytes, lower(p_sha256), 'em_analise', actor_id)
  RETURNING id INTO version_id;

  INSERT INTO public.documento_vinculos (documento_id, nota_fiscal_entrega_id, cedente_id)
  VALUES (doc_id, p_nota_fiscal_entrega_id, entrega.cedente_id);

  INSERT INTO public.canhotos (
    nota_fiscal_entrega_id, status, data_assinatura, nome_recebedor,
    documento_recebedor, possui_assinatura, possui_ressalva, descricao_ressalva,
    recebido_em, documento_id, documento_versao_atual_id, nota_fiscal_remessa_id
  )
  VALUES (
    p_nota_fiscal_entrega_id, 'em_analise', p_data_assinatura, p_nome_recebedor,
    NULLIF(regexp_replace(coalesce(p_documento_recebedor, ''), '\D', '', 'g'), ''), coalesce(p_possui_assinatura, false),
    coalesce(p_possui_ressalva, false), p_descricao_ressalva, now(), doc_id, version_id, remessa.id
  )
  RETURNING id INTO canhoto_id;

  PERFORM public.registrar_evento_entrega(p_nota_fiscal_entrega_id, 'canhoto_enviado', entrega.status_entrega, entrega.status_entrega, 'usuario', jsonb_build_object('canhoto_id', canhoto_id, 'versao_id', version_id, 'nota_fiscal_remessa_id', remessa.id));

  INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT p.id, 'Canhoto enviado', 'Um canhoto foi enviado para analise.', 'canhoto_enviado',
         'canhoto:' || canhoto_id::text || ':enviado:' || p.id::text
  FROM public.profiles p WHERE p.role = 'gestor'
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;

  RETURN jsonb_build_object('canhoto_id', canhoto_id, 'documento_id', doc_id, 'versao_id', version_id, 'nota_fiscal_remessa_id', remessa.id);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_canhoto_documento(uuid, text, text, bigint, text, text, text, date, text, text, boolean, boolean, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_canhoto_documento(uuid, text, text, bigint, text, text, text, date, text, text, boolean, boolean, text, uuid)
  TO authenticated;

COMMIT;
