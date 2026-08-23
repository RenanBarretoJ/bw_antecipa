-- P0 Claude: consolida o upload de canhoto (comprovante de entrega) dentro
-- do checklist "Requisitos documentais", removendo o card avulso que existia
-- fora dele. registrar_canhoto_documento passa a aceitar tambem o id da
-- instancia de requisito (documento_requisito_instancias.id) que originou o
-- upload, para que o item do checklist generico (cuja UI le item.versoes a
-- partir de documento_id) reflita o canhoto enviado -- mesmo padrao ja usado
-- por registrar_cte_documento (20260821040000_p0_nf_remessa_lastro_logistico.sql).
--
-- Tambem corrige analisar_canhoto_documento: a UPDATE de
-- documento_requisito_instancias na aprovacao filtrava apenas por
-- tipo_documento_codigo_snapshot = 'canhoto', mas uma politica pode
-- configurar o requisito com o codigo 'comprovante_entrega' ou
-- 'comprovante_de_entrega' (mesma familia documental, ver
-- resolverFamiliaDocumentalLogistica em
-- src/lib/logistica/evidencias-logisticas.ts) -- nesse caso a aprovacao
-- nunca marcava o requisito como satisfeito.
--
-- Assinatura de registrar_canhoto_documento estendida apenas com um
-- parametro DEFAULT no final -- chamadas existentes continuam funcionando
-- sem alteracao.

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
  p_nota_fiscal_remessa_id uuid DEFAULT NULL,
  p_requisito_id uuid DEFAULT NULL
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

  -- Fail-closed: se um requisito foi informado, precisa pertencer a esta
  -- MESMA entrega e ser da familia documental de comprovante de entrega --
  -- nunca aceita silenciosamente um requisito de outra entrega/tipo.
  IF p_requisito_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.documento_requisito_instancias
    WHERE id = p_requisito_id
      AND nota_fiscal_entrega_id = p_nota_fiscal_entrega_id
      AND tipo_documento_codigo_snapshot IN ('canhoto', 'comprovante_entrega', 'comprovante_de_entrega')
  ) THEN
    RAISE EXCEPTION 'Requisito informado nao corresponde a esta entrega';
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

  -- Mesmo padrao de registrar_cte_documento (20260821040000): a instancia do
  -- requisito no checklist generico passa a apontar para o documento recem
  -- enviado, com status resetado para 'pendente' (aguardando analise) a cada
  -- novo upload/reenvio.
  IF p_requisito_id IS NOT NULL THEN
    UPDATE public.documento_requisito_instancias
    SET documento_id = doc_id,
        status = 'pendente',
        versao_aprovada_id = NULL,
        satisfeito_em = NULL
    WHERE id = p_requisito_id;
  END IF;

  PERFORM public.registrar_evento_entrega(p_nota_fiscal_entrega_id, 'canhoto_enviado', entrega.status_entrega, entrega.status_entrega, 'usuario', jsonb_build_object('canhoto_id', canhoto_id, 'versao_id', version_id, 'nota_fiscal_remessa_id', remessa.id));

  INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
  SELECT p.id, 'Canhoto enviado', 'Um canhoto foi enviado para analise.', 'canhoto_enviado',
         'canhoto:' || canhoto_id::text || ':enviado:' || p.id::text
  FROM public.profiles p WHERE p.role = 'gestor'
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;

  RETURN jsonb_build_object('canhoto_id', canhoto_id, 'documento_id', doc_id, 'versao_id', version_id, 'nota_fiscal_remessa_id', remessa.id);
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_canhoto_documento(uuid, text, text, bigint, text, text, text, date, text, text, boolean, boolean, text, uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_canhoto_documento(uuid, text, text, bigint, text, text, text, date, text, text, boolean, boolean, text, uuid, uuid)
  TO authenticated;

-- analisar_canhoto_documento: assinatura inalterada, apenas amplia o WHERE
-- da UPDATE de documento_requisito_instancias na aprovacao para cobrir os
-- codigos alternativos da mesma familia documental (ver comentario acima).
-- Corpo copiado de 20260721183540_fase5_logistica_pos_cessao.sql, sem outras
-- alteracoes. Assinatura igual -> nao precisa de novo REVOKE/GRANT.
CREATE OR REPLACE FUNCTION public.analisar_canhoto_documento(
  p_canhoto_id uuid,
  p_documento_versao_id uuid,
  p_resultado text,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  canhoto_row record;
  entrega record;
  novo_status text;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() <> 'gestor' THEN
    RAISE EXCEPTION 'Somente gestor pode analisar canhoto';
  END IF;
  IF p_resultado NOT IN ('aprovado', 'rejeitado') THEN RAISE EXCEPTION 'Resultado invalido'; END IF;
  IF p_resultado = 'rejeitado' AND length(trim(coalesce(p_motivo, ''))) = 0 THEN RAISE EXCEPTION 'Motivo obrigatorio ao rejeitar'; END IF;

  SELECT * INTO canhoto_row FROM public.canhotos WHERE id = p_canhoto_id FOR UPDATE;
  IF canhoto_row.id IS NULL OR canhoto_row.documento_versao_atual_id <> p_documento_versao_id THEN
    RAISE EXCEPTION 'Versao documental nao corresponde ao canhoto';
  END IF;
  SELECT * INTO entrega FROM public.nota_fiscal_entregas WHERE id = canhoto_row.nota_fiscal_entrega_id FOR UPDATE;
  novo_status := CASE WHEN p_resultado = 'aprovado' THEN 'aprovado' ELSE 'rejeitado' END;

  INSERT INTO public.documento_analises (documento_versao_id, resultado, analisado_por, observacoes, dados_estruturados)
  VALUES (p_documento_versao_id, p_resultado, auth.uid(), p_motivo, '{}'::jsonb);

  UPDATE public.documento_versoes SET status = novo_status WHERE id = p_documento_versao_id;
  UPDATE public.documentos_repositorio SET status = novo_status WHERE id = canhoto_row.documento_id;
  UPDATE public.canhotos
  SET status = novo_status,
      analisado_por = auth.uid(),
      analisado_em = now(),
      motivo_rejeicao = CASE WHEN p_resultado = 'rejeitado' THEN p_motivo ELSE NULL END,
      documento_versao_aprovada_id = CASE WHEN p_resultado = 'aprovado' THEN p_documento_versao_id ELSE NULL END
  WHERE id = p_canhoto_id;

  IF p_resultado = 'aprovado' THEN
    UPDATE public.documento_requisito_instancias
    SET status = 'satisfeito', versao_aprovada_id = p_documento_versao_id, satisfeito_em = now()
    WHERE nota_fiscal_entrega_id = canhoto_row.nota_fiscal_entrega_id AND tipo_documento_codigo_snapshot IN ('canhoto', 'comprovante_entrega', 'comprovante_de_entrega');
    PERFORM public.registrar_evento_entrega(canhoto_row.nota_fiscal_entrega_id, 'canhoto_aprovado', entrega.status_entrega, entrega.status_entrega, 'usuario', jsonb_build_object('canhoto_id', p_canhoto_id));
  ELSE
    PERFORM public.registrar_evento_entrega(canhoto_row.nota_fiscal_entrega_id, 'canhoto_rejeitado', entrega.status_entrega, entrega.status_entrega, 'usuario', jsonb_build_object('canhoto_id', p_canhoto_id, 'motivo', p_motivo));
  END IF;

  PERFORM public.avaliar_conclusao_entrega(canhoto_row.nota_fiscal_entrega_id);
  RETURN jsonb_build_object('canhoto_id', p_canhoto_id, 'status', novo_status);
END;
$$;

COMMIT;
