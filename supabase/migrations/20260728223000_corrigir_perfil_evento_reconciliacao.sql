-- Corrige a reconciliação de documentos-base quando a migration original já foi aplicada.
-- user_role contém apenas perfis de acesso; `sistema` é ator de auditoria e deve
-- permanecer como texto no snapshot do evento.

CREATE OR REPLACE FUNCTION public.reconciliar_documentos_base_nf(
  p_nota_fiscal_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item record;
  nf_context record;
  satisfeitas integer := 0;
  pendentes integer := 0;
  divergencias integer := 0;
  reconciliadas integer := 0;
  auto_aprovadas integer := 0;
  aprovacao_manual integer := 0;
  v_satisfeito boolean;
  v_event_origin text;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() NOT IN ('gestor', 'cedente') THEN
    RAISE EXCEPTION 'Usuario sem permissao para reconciliar documentos da NF';
  END IF;

  SELECT nf.id, nf.fundo_id, nf.cedente_id, nf.cedente_fundo_id
    INTO nf_context
  FROM public.notas_fiscais nf
  WHERE nf.id = p_nota_fiscal_id
    AND (
      get_user_role() = 'gestor'
      OR nf.cedente_id = get_user_cedente_id()
    );

  IF nf_context.id IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal nao encontrada ou fora do contexto autorizado';
  END IF;

  FOR item IN
    SELECT
      dri.id AS requisito_id,
      dri.tipo_documento_codigo_snapshot,
      dri.status AS requisito_status,
      dri.documento_id AS documento_atual_id,
      dri.nivel_validacao_snapshot,
      candidate.documento_id AS documento_base_id,
      candidate.versao_id AS versao_base_id,
      candidate.versao_status AS versao_base_status,
      candidate.numero_versao AS versao_base_numero
    FROM public.documento_requisito_instancias dri
    LEFT JOIN LATERAL (
      SELECT
        dr.id AS documento_id,
        dv.id AS versao_id,
        dv.status AS versao_status,
        dv.numero_versao
      FROM public.documento_vinculos vinculo
      JOIN public.documentos_repositorio dr
        ON dr.id = vinculo.documento_id
       AND dr.deleted_at IS NULL
      JOIN public.documento_tipos document_type
        ON document_type.id = dr.documento_tipo_id
       AND document_type.codigo = dri.tipo_documento_codigo_snapshot
      JOIN LATERAL (
        SELECT dv.id, dv.status, dv.numero_versao, dv.created_at
        FROM public.documento_versoes dv
        WHERE dv.documento_id = dr.id
        ORDER BY dv.numero_versao DESC, dv.created_at DESC
        LIMIT 1
      ) dv ON dv.status IN ('enviado', 'em_analise', 'aprovado')
      WHERE vinculo.nota_fiscal_id = p_nota_fiscal_id
      ORDER BY dv.numero_versao DESC, dv.created_at DESC
      LIMIT 1
    ) candidate ON true
    WHERE dri.nota_fiscal_id = p_nota_fiscal_id
      AND dri.escopo_snapshot = 'nf_pre_cessao'
      AND dri.tipo_documento_codigo_snapshot IN ('nf_xml', 'nf_danfe_pdf')
      AND dri.status NOT IN ('cancelado', 'dispensado')
    ORDER BY dri.id
    FOR UPDATE OF dri
  LOOP
    IF item.documento_base_id IS NULL THEN
      IF item.documento_atual_id IS NOT NULL THEN
        divergencias := divergencias + 1;
        v_event_origin := item.requisito_id::text || ':incompativel';
        INSERT INTO public.eventos_dominio (
          tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
          tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
          ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
          origem_evento, origem_registro_id
        )
        SELECT
          nf_context.fundo_id, nf_context.fundo_id, nf_context.cedente_id,
          nf_context.cedente_fundo_id, p_nota_fiscal_id,
          'documento_base_nf_incompativel', 'documento', auth.uid(),
          COALESCE(profile.nome_completo, profile.email, 'Sistema'),
          COALESCE(profile.role::text, 'sistema'), 'reconciliacao_checklist',
          'Documento-base existente nao corresponde ao tipo documental do requisito.',
          jsonb_build_object(
            'requisito_id', item.requisito_id,
            'documento_id', item.documento_atual_id,
            'tipo_esperado', 'nf_xml ou nf_danfe_pdf'
          ), 'interno', 'documento_requisito_instancias', v_event_origin
        FROM public.profiles profile
        WHERE profile.id = auth.uid()
        ON CONFLICT (origem_evento, origem_registro_id, tipo_evento)
          WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL
        DO NOTHING;
      END IF;

      IF item.requisito_status = 'satisfeito' THEN
        UPDATE public.documento_requisito_instancias
        SET status = 'pendente', versao_aprovada_id = NULL, satisfeito_em = NULL
        WHERE id = item.requisito_id;
      END IF;
      pendentes := pendentes + 1;
      CONTINUE;
    END IF;

    reconciliadas := reconciliadas + 1;
    v_satisfeito := item.versao_base_status = 'aprovado';

    IF item.nivel_validacao_snapshot = 'estrutural'
       AND item.versao_base_status IN ('enviado', 'em_analise') THEN
      -- O upload da NF e validado no backend antes de chegar ao repositorio.
      -- Para o requisito estrutural, a evidencia-base validada pode ser
      -- aprovada pelo sistema sem criar uma aprovacao manual ficticia.
      UPDATE public.documento_versoes
      SET status = 'aprovado'
      WHERE id = item.versao_base_id
        AND status IN ('enviado', 'em_analise');

      UPDATE public.documentos_repositorio
      SET status = 'aprovado'
      WHERE id = item.documento_base_id;

      IF NOT EXISTS (
        SELECT 1
        FROM public.documento_analises da
        WHERE da.documento_versao_id = item.versao_base_id
          AND da.resultado = 'aprovado'
      ) THEN
        INSERT INTO public.documento_analises (
          documento_versao_id, resultado, analisado_por, ator_tipo,
          observacoes, dados_estruturados
        ) VALUES (
          item.versao_base_id, 'aprovado', NULL, 'sistema',
          'Documento-base da NF validado estruturalmente no cadastro.',
          jsonb_build_object('origem', 'documento_base_nf', 'nota_fiscal_id', p_nota_fiscal_id)
        );
      END IF;

      v_satisfeito := true;
      auto_aprovadas := auto_aprovadas + 1;
    ELSIF item.versao_base_status <> 'aprovado' THEN
      aprovacao_manual := aprovacao_manual + 1;
    END IF;

    IF v_satisfeito THEN
      UPDATE public.documento_requisito_instancias
      SET documento_id = item.documento_base_id,
          versao_aprovada_id = item.versao_base_id,
          status = 'satisfeito',
          satisfeito_em = COALESCE(satisfeito_em, now()),
          origem_snapshot = 'documento_base_nf'
      WHERE id = item.requisito_id;
      satisfeitas := satisfeitas + 1;
    ELSE
      UPDATE public.documento_requisito_instancias
      SET documento_id = item.documento_base_id,
          versao_aprovada_id = NULL,
          status = 'pendente',
          satisfeito_em = NULL,
          origem_snapshot = 'documento_base_nf'
      WHERE id = item.requisito_id;
      pendentes := pendentes + 1;
    END IF;

    v_event_origin := item.versao_base_id::text;
    INSERT INTO public.eventos_dominio (
      tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
      tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
      ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
      origem_evento, origem_registro_id
    )
    SELECT
      nf_context.fundo_id, nf_context.fundo_id, nf_context.cedente_id,
      nf_context.cedente_fundo_id, p_nota_fiscal_id,
      CASE WHEN v_satisfeito THEN 'documento_base_nf_reconciliado' ELSE 'documento_base_nf_enviado' END,
      'documento', auth.uid(), COALESCE(profile.nome_completo, profile.email, 'Sistema'),
      COALESCE(profile.role::text, 'sistema'), 'reconciliacao_checklist',
      CASE
        WHEN item.tipo_documento_codigo_snapshot = 'nf_xml' AND v_satisfeito THEN 'O XML da NF-e utilizado no cadastro satisfez o requisito documental.'
        WHEN item.tipo_documento_codigo_snapshot = 'nf_danfe_pdf' AND v_satisfeito THEN 'O DANFE utilizado no cadastro satisfez o requisito documental.'
        ELSE 'Documento-base da NF localizado e aguardando analise conforme a politica.'
      END,
      jsonb_build_object(
        'requisito_id', item.requisito_id,
        'documento_id', item.documento_base_id,
        'documento_versao_id', item.versao_base_id,
        'numero_versao', item.versao_base_numero,
        'tipo_validacao', item.nivel_validacao_snapshot,
        'status', CASE WHEN v_satisfeito THEN 'satisfeito' ELSE 'pendente' END,
        'origem', 'documento_base_nf'
      ), 'ambos', 'documento_requisito_instancias', v_event_origin
    FROM public.profiles profile
    WHERE profile.id = auth.uid()
    ON CONFLICT (origem_evento, origem_registro_id, tipo_evento)
      WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL
    DO NOTHING;
  END LOOP;

  RETURN jsonb_build_object(
    'nota_fiscal_id', p_nota_fiscal_id,
    'instanciasCriadas', 0,
    'instanciasSatisfeitas', satisfeitas,
    'instanciasPendentes', pendentes,
    'reconciliados', reconciliadas,
    'autoAprovados', auto_aprovadas,
    'aguardandoAnalise', aprovacao_manual,
    'divergencias', divergencias
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reconciliar_documentos_base_nf(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reconciliar_documentos_base_nf(uuid) TO authenticated;
