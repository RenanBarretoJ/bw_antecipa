-- RLX-EMAIL-03: one persistence core for human and fenced fiscal actors.
-- Official C4/C1.1 business rules are moved, not independently reimplemented.
BEGIN;
ALTER TABLE public.notas_fiscais ADD COLUMN fiscal_reservation_id uuid UNIQUE REFERENCES private.fiscal_identity_reservations(id);
ALTER TABLE public.notas_fiscais ADD COLUMN source_channel text CHECK (source_channel IN ('MANUAL_UPLOAD','EMAIL_INTAKE'));
ALTER TABLE public.documentos_repositorio ALTER COLUMN criado_por DROP NOT NULL;
ALTER TABLE public.documentos_repositorio ADD COLUMN fiscal_reservation_id uuid REFERENCES private.fiscal_identity_reservations(id);
ALTER TABLE public.documentos_repositorio ADD CONSTRAINT documento_fiscal_actor CHECK (criado_por IS NOT NULL OR fiscal_reservation_id IS NOT NULL);
ALTER TABLE public.documento_versoes ALTER COLUMN enviado_por DROP NOT NULL;
ALTER TABLE public.documento_versoes ADD COLUMN fiscal_reservation_id uuid REFERENCES private.fiscal_identity_reservations(id);
ALTER TABLE public.documento_versoes ADD CONSTRAINT versao_fiscal_actor CHECK (enviado_por IS NOT NULL OR fiscal_reservation_id IS NOT NULL);
CREATE INDEX documento_fiscal_reservation ON public.documentos_repositorio(fiscal_reservation_id) WHERE fiscal_reservation_id IS NOT NULL;
CREATE INDEX versao_fiscal_reservation ON public.documento_versoes(fiscal_reservation_id) WHERE fiscal_reservation_id IS NOT NULL;

CREATE FUNCTION private.fiscal_assert_nf(p_nf uuid,p_id uuid,p_token uuid,p_generation bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE r private.fiscal_identity_reservations%ROWTYPE;
BEGIN
  r := private.fiscal_assert_owner(p_id,p_token,p_generation);
  IF NOT EXISTS (SELECT 1 FROM public.notas_fiscais nf WHERE nf.id=p_nf AND nf.fiscal_reservation_id=r.id
    AND nf.fundo_id=r.fundo_id AND nf.cedente_id=r.cedente_id AND nf.cedente_fundo_id=r.cedente_fundo_id
    AND nf.estabelecimento_id=r.estabelecimento_id AND nf.status::text='rascunho'
    AND encode(extensions.digest(nf.chave_acesso,'sha256'),'hex')=r.identity_sha256)
    THEN RAISE EXCEPTION 'FISCAL_SCOPE_DENIED' USING ERRCODE='42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.fiscal_assert_nf(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.fiscal_registrar_parcelas_nota_fiscal(
  p_nota_fiscal_id uuid,
  p_parcelas jsonb
,
  p_reservation_id uuid DEFAULT NULL, p_owner_token uuid DEFAULT NULL, p_generation bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_nf public.notas_fiscais%ROWTYPE;
  v_item jsonb;
  v_soma numeric(15,2) := 0;
  v_tolerancia numeric(15,2);
  v_inseridas integer := 0;
  v_role text := public.get_user_role();
BEGIN
  IF p_reservation_id IS NOT NULL THEN
    PERFORM private.fiscal_assert_nf(p_nota_fiscal_id,p_reservation_id,p_owner_token,p_generation);
  END IF;
  IF p_reservation_id IS NULL AND ((SELECT auth.uid()) IS NULL OR v_role NOT IN ('gestor', 'cedente', 'consultor')) THEN
    RAISE EXCEPTION 'Usuario sem permissao para registrar parcelas';
  END IF;

  SELECT * INTO v_nf FROM public.notas_fiscais WHERE id = p_nota_fiscal_id;
  IF v_nf.id IS NULL THEN RAISE EXCEPTION 'Nota fiscal nao encontrada'; END IF;
  IF v_role = 'cedente' AND v_nf.cedente_id <> (SELECT public.get_user_cedente_id()) THEN
    RAISE EXCEPTION 'Nota fiscal fora do cedente autenticado';
  END IF;
  IF v_role = 'consultor' AND (
    NOT (SELECT private.usuario_pode_operar_cedente(v_nf.cedente_id))
    OR NOT (SELECT private.consultor_tem_acesso_fundo(v_nf.fundo_id))
  ) THEN
    RAISE EXCEPTION 'Consultor sem acesso operacional a nota fiscal';
  END IF;
  IF v_role = 'gestor' AND NOT private.gestor_tem_acesso_cedente(v_nf.cedente_id) THEN
    RAISE EXCEPTION 'Gestor sem vinculo ativo com o fundo desta nota fiscal';
  END IF;

  IF EXISTS (SELECT 1 FROM public.nota_fiscal_parcelas WHERE nota_fiscal_id = p_nota_fiscal_id) THEN
    RAISE EXCEPTION 'Nota fiscal ja possui parcelas registradas';
  END IF;
  IF jsonb_typeof(p_parcelas) <> 'array' OR jsonb_array_length(p_parcelas) = 0 THEN
    RAISE EXCEPTION 'Lista de parcelas invalida';
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_parcelas) LOOP
    IF NOT (v_item ? 'numero_parcela' AND v_item ? 'valor_nominal' AND v_item ? 'data_vencimento') THEN
      RAISE EXCEPTION 'Parcela com campos obrigatorios ausentes';
    END IF;
    INSERT INTO public.nota_fiscal_parcelas (nota_fiscal_id, numero_parcela, valor_nominal, data_vencimento, origem)
    VALUES (
      p_nota_fiscal_id,
      (v_item->>'numero_parcela')::integer,
      (v_item->>'valor_nominal')::numeric,
      (v_item->>'data_vencimento')::date,
      coalesce(v_item->>'origem', 'xml_nfe')
    );
    v_soma := v_soma + (v_item->>'valor_nominal')::numeric;
    v_inseridas := v_inseridas + 1;
  END LOOP;

  v_tolerancia := greatest(v_inseridas * 0.01, 0.01);
  IF abs(v_soma - v_nf.valor_bruto) > v_tolerancia THEN
    RAISE EXCEPTION 'Soma das parcelas (%) nao corresponde ao valor bruto da nota fiscal (%)', v_soma, v_nf.valor_bruto;
  END IF;

  RETURN jsonb_build_object('nota_fiscal_id', p_nota_fiscal_id, 'parcelas_inseridas', v_inseridas, 'soma', v_soma);
END;
$function$;
REVOKE ALL ON FUNCTION private.fiscal_registrar_parcelas_nota_fiscal(uuid,jsonb,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.registrar_parcelas_nota_fiscal(
  p_nota_fiscal_id uuid,
  p_parcelas jsonb
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $wrapper$
  SELECT private.fiscal_registrar_parcelas_nota_fiscal(p_nota_fiscal_id,p_parcelas,NULL,NULL,NULL);
$wrapper$;

CREATE OR REPLACE FUNCTION private.fiscal_reconciliar_documentos_base_nf(
  p_nota_fiscal_id uuid
,
  p_reservation_id uuid DEFAULT NULL, p_owner_token uuid DEFAULT NULL, p_generation bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  item record;
  nf_context record;
  actor_role text;
  satisfeitas integer := 0;
  pendentes integer := 0;
  divergencias integer := 0;
  reconciliadas integer := 0;
  auto_aprovadas integer := 0;
  aprovacao_manual integer := 0;
  v_satisfeito boolean;
  v_event_origin text;
BEGIN
  IF p_reservation_id IS NOT NULL THEN
    PERFORM private.fiscal_assert_nf(p_nota_fiscal_id,p_reservation_id,p_owner_token,p_generation);
  END IF;
  actor_role := public.get_user_role();

  IF p_reservation_id IS NULL AND (auth.uid() IS NULL OR actor_role NOT IN ('gestor', 'cedente', 'consultor')) THEN
    RAISE EXCEPTION 'Usuario sem permissao para reconciliar documentos da NF';
  END IF;

  SELECT nf.id, nf.fundo_id, nf.cedente_id, nf.cedente_fundo_id
    INTO nf_context
  FROM public.notas_fiscais nf
  WHERE nf.id = p_nota_fiscal_id;

  IF nf_context.id IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal nao encontrada';
  END IF;

  IF actor_role = 'cedente'
     AND nf_context.cedente_id <> public.get_user_cedente_id() THEN
    RAISE EXCEPTION 'Nota fiscal fora do cedente autenticado';
  END IF;

  IF actor_role = 'consultor' AND (
    NOT private.usuario_pode_operar_cedente(nf_context.cedente_id)
    OR NOT private.consultor_tem_acesso_fundo(nf_context.fundo_id)
  ) THEN
    RAISE EXCEPTION 'Consultor sem acesso operacional a nota fiscal';
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
          jsonb_build_object('origem', 'documento_base_nf', 'fiscal_reservation_id', p_reservation_id,
        'actor_type', CASE WHEN auth.uid() IS NULL THEN 'SYSTEM' ELSE 'HUMAN' END, 'nota_fiscal_id', p_nota_fiscal_id)
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
    FROM (SELECT 1) actor_row LEFT JOIN public.profiles profile ON profile.id = auth.uid()
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
REVOKE ALL ON FUNCTION private.fiscal_reconciliar_documentos_base_nf(uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.reconciliar_documentos_base_nf(
  p_nota_fiscal_id uuid
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $wrapper$
  SELECT private.fiscal_reconciliar_documentos_base_nf(p_nota_fiscal_id,NULL,NULL,NULL);
$wrapper$;

CREATE OR REPLACE FUNCTION private.fiscal_instanciar_requisitos_nota(
  p_nota_fiscal_id uuid,
  p_politica_operacional_id uuid,
  p_politica_versao_id uuid
,
  p_reservation_id uuid DEFAULT NULL, p_owner_token uuid DEFAULT NULL, p_generation bigint DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  nf_cedente uuid;
  nf_cedente_fundo uuid;
  nf_fundo uuid;
  version_number integer;
  affected_count integer;
  reconciliation jsonb;
BEGIN
  IF p_reservation_id IS NOT NULL THEN
    PERFORM private.fiscal_assert_nf(p_nota_fiscal_id,p_reservation_id,p_owner_token,p_generation);
  END IF;
  IF p_reservation_id IS NULL AND (auth.uid() IS NULL OR public.get_user_role() NOT IN ('gestor', 'cedente', 'consultor')) THEN
    RAISE EXCEPTION 'Usuario sem permissao para instanciar requisitos';
  END IF;

  SELECT cedente_id, cedente_fundo_id, fundo_id
    INTO nf_cedente, nf_cedente_fundo, nf_fundo
  FROM public.notas_fiscais
  WHERE id = p_nota_fiscal_id;

  IF nf_cedente IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal nao encontrada';
  END IF;

  IF nf_cedente_fundo IS NULL OR nf_fundo IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal sem contexto cedente-fundo/fundo';
  END IF;

  IF public.get_user_role() = 'cedente' AND nf_cedente <> public.get_user_cedente_id() THEN
    RAISE EXCEPTION 'Nota fiscal fora do cedente autenticado';
  END IF;
  IF public.get_user_role() = 'consultor' AND (
    NOT private.usuario_pode_operar_cedente(nf_cedente)
    OR NOT private.consultor_tem_acesso_fundo(nf_fundo)
  ) THEN
    RAISE EXCEPTION 'Consultor sem acesso operacional a nota fiscal';
  END IF;

  SELECT pov.versao
    INTO version_number
  FROM public.politica_operacional_versoes pov
  JOIN public.politicas_operacionais po
    ON po.id = pov.politica_operacional_id
  JOIN public.cedente_fundo_politicas cfp
    ON cfp.politica_operacional_id = po.id
   AND cfp.cedente_fundo_id = nf_cedente_fundo
   AND cfp.status = 'ativa'
   AND cfp.vigente_desde <= now()
   AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now())
  WHERE pov.id = p_politica_versao_id
    AND po.id = p_politica_operacional_id
    AND po.fundo_id = nf_fundo
    AND po.status = 'ativa'
    AND pov.fundo_id = nf_fundo
    AND pov.publicada_em IS NOT NULL
    AND pov.vigente_ate IS NULL
  ORDER BY cfp.vigente_desde DESC
  LIMIT 1;

  IF version_number IS NULL THEN
    RAISE EXCEPTION 'Politica operacional publicada nao vinculada ao contexto da NF';
  END IF;

  WITH candidatos AS (
    SELECT r.*, dt.id AS resolved_documento_tipo_id, coalesce(dt.cardinalidade, 'por_nf') AS cardinalidade
    FROM public.politica_requisitos_documentais r
    LEFT JOIN public.documento_tipos dt ON dt.codigo = r.tipo_documento_codigo
    WHERE r.politica_operacional_versao_id = p_politica_versao_id
      AND r.escopo = 'nf_pre_cessao'
      AND r.ativo
  ),
  por_nf AS (
    SELECT c.id, c.politica_operacional_id, c.politica_operacional_versao_id, c.resolved_documento_tipo_id AS documento_tipo_id,
      c.tipo_documento_codigo, c.escopo, c.obrigatorio, c.prazo_dias_corridos, c.formatos_aceitos,
      c.nivel_validacao, c.quantidade_minima, c.responsavel_upload, c.responsavel_aprovacao,
      NULL::uuid AS parcela_id
    FROM candidatos c
    WHERE c.cardinalidade = 'por_nf'
  ),
  por_parcela AS (
    SELECT c.id, c.politica_operacional_id, c.politica_operacional_versao_id, c.resolved_documento_tipo_id AS documento_tipo_id,
      c.tipo_documento_codigo, c.escopo, c.obrigatorio, c.prazo_dias_corridos, c.formatos_aceitos,
      c.nivel_validacao, c.quantidade_minima, c.responsavel_upload, c.responsavel_aprovacao,
      p.id AS parcela_id
    FROM candidatos c
    JOIN public.nota_fiscal_parcelas p ON p.nota_fiscal_id = p_nota_fiscal_id
    WHERE c.cardinalidade = 'por_parcela'
  ),
  todos AS (
    SELECT * FROM por_nf UNION ALL SELECT * FROM por_parcela
  )
  INSERT INTO public.documento_requisito_instancias (
    politica_requisito_id, politica_operacional_id, politica_operacional_versao_id, politica_versao,
    documento_tipo_id, tipo_documento_codigo_snapshot, escopo_snapshot, nota_fiscal_id, parcela_id, cedente_id,
    status, obrigatorio, prazo_limite, formatos_aceitos_snapshot, nivel_validacao_snapshot,
    quantidade_minima_snapshot, responsavel_upload_snapshot, responsavel_aprovacao_snapshot
  )
  SELECT t.id, t.politica_operacional_id, t.politica_operacional_versao_id, version_number,
    t.documento_tipo_id, t.tipo_documento_codigo, t.escopo, p_nota_fiscal_id, t.parcela_id, nf_cedente,
    'pendente', t.obrigatorio,
    CASE WHEN t.prazo_dias_corridos IS NULL THEN NULL ELSE (CURRENT_DATE + t.prazo_dias_corridos) END,
    t.formatos_aceitos, t.nivel_validacao, t.quantidade_minima, t.responsavel_upload, t.responsavel_aprovacao
  FROM todos t
  ON CONFLICT (politica_requisito_id, nota_fiscal_id, parcela_id) DO UPDATE
    SET documento_tipo_id = COALESCE(EXCLUDED.documento_tipo_id, documento_requisito_instancias.documento_tipo_id);

  GET DIAGNOSTICS affected_count = ROW_COUNT;

  UPDATE public.documento_requisito_instancias dri
  SET documento_tipo_id = dt.id
  FROM public.documento_tipos dt
  WHERE dri.nota_fiscal_id = p_nota_fiscal_id
    AND dt.codigo = dri.tipo_documento_codigo_snapshot
    AND dri.documento_tipo_id IS DISTINCT FROM dt.id;

  reconciliation := private.fiscal_reconciliar_documentos_base_nf(p_nota_fiscal_id,p_reservation_id,p_owner_token,p_generation);

  PERFORM private.reconciliar_requisito_nf_remessa(p_nota_fiscal_id);

  RETURN jsonb_build_object(
    'nota_fiscal_id', p_nota_fiscal_id,
    'inseridos_ou_atualizados', affected_count,
    'documentos_base_reconciliados', COALESCE((reconciliation->>'reconciliados')::integer, 0),
    'politica_versao', version_number,
    'cedente_fundo_id', nf_cedente_fundo,
    'fundo_id', nf_fundo
  );
END;
$$;
REVOKE ALL ON FUNCTION private.fiscal_instanciar_requisitos_nota(uuid,uuid,uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.instanciar_requisitos_nota(
  p_nota_fiscal_id uuid,
  p_politica_operacional_id uuid,
  p_politica_versao_id uuid
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $wrapper$
  SELECT private.fiscal_instanciar_requisitos_nota(p_nota_fiscal_id,p_politica_operacional_id,p_politica_versao_id,NULL,NULL,NULL);
$wrapper$;

CREATE OR REPLACE FUNCTION private.fiscal_registrar_documento_upload(
  p_nota_fiscal_id uuid,
  p_requisito_id uuid,
  p_documento_tipo_id uuid,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text,
  p_bucket text,
  p_path text,
  p_enviado_por uuid,
  p_substitui_versao_id uuid DEFAULT NULL
,
  p_reservation_id uuid DEFAULT NULL, p_owner_token uuid DEFAULT NULL, p_generation bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  actor_role text;
  nf_cedente uuid;
  nf_cedente_fundo uuid;
  nf_fundo uuid;
  requirement record;
  doc_id uuid;
  version_id uuid;
  version_number integer;
  same_hash boolean;
BEGIN
  IF p_reservation_id IS NOT NULL THEN
    PERFORM private.fiscal_assert_nf(p_nota_fiscal_id,p_reservation_id,p_owner_token,p_generation);
  END IF;
  actor_role := public.get_user_role();
  IF p_reservation_id IS NULL AND (auth.uid() IS NULL OR actor_role NOT IN ('gestor', 'cedente', 'consultor') OR p_enviado_por <> auth.uid()) THEN
    RAISE EXCEPTION 'Usuario sem permissao para enviar documento';
  END IF;

  SELECT cedente_id, cedente_fundo_id, fundo_id
    INTO nf_cedente, nf_cedente_fundo, nf_fundo
  FROM public.notas_fiscais
  WHERE id = p_nota_fiscal_id;

  IF nf_cedente IS NULL THEN RAISE EXCEPTION 'Nota fiscal nao encontrada'; END IF;
  IF nf_cedente_fundo IS NULL OR nf_fundo IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal sem contexto cedente-fundo/fundo';
  END IF;
  IF actor_role = 'cedente' AND nf_cedente <> public.get_user_cedente_id() THEN RAISE EXCEPTION 'NF fora do cedente autenticado'; END IF;
  IF actor_role = 'consultor' AND (
    NOT private.usuario_pode_operar_cedente(nf_cedente)
    OR NOT private.consultor_tem_acesso_fundo(nf_fundo)
  ) THEN RAISE EXCEPTION 'Consultor sem acesso operacional a NF'; END IF;

  IF p_reservation_id IS NOT NULL AND p_enviado_por IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'FISCAL_ACTOR_DENIED' USING ERRCODE='42501';
  END IF;
  SELECT * INTO requirement
  FROM public.documento_requisito_instancias
  WHERE id = p_requisito_id
    AND nota_fiscal_id = p_nota_fiscal_id
    AND status NOT IN ('cancelado', 'satisfeito')
  FOR UPDATE;

  IF requirement.id IS NULL THEN RAISE EXCEPTION 'Requisito documental invalido ou ja satisfeito'; END IF;
  IF requirement.cedente_id <> nf_cedente THEN RAISE EXCEPTION 'Requisito documental fora do cedente da NF'; END IF;
  IF NOT public.documento_tipo_compativel_com_requisito(requirement.tipo_documento_codigo_snapshot, p_documento_tipo_id) THEN
    RAISE EXCEPTION 'Tipo de documento nao corresponde ao requisito';
  END IF;
  IF p_bucket <> 'documentos-v2' OR length(p_path) = 0 OR p_tamanho_bytes <= 0 OR p_sha256 !~ '^[0-9a-fA-F]{64}$' THEN
    RAISE EXCEPTION 'Metadados de armazenamento invalidos';
  END IF;

  doc_id := requirement.documento_id;
  IF doc_id IS NULL THEN
    INSERT INTO public.documentos_repositorio (documento_tipo_id, status, criado_por, fiscal_reservation_id)
    VALUES (p_documento_tipo_id, 'pendente', p_enviado_por, p_reservation_id)
    RETURNING id INTO doc_id;

    INSERT INTO public.documento_vinculos (documento_id, nota_fiscal_id, cedente_id)
    VALUES (doc_id, p_nota_fiscal_id, nf_cedente);
  ELSE
    UPDATE public.documentos_repositorio
    SET documento_tipo_id = p_documento_tipo_id
    WHERE id = doc_id
      AND documento_tipo_id IS DISTINCT FROM p_documento_tipo_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(doc_id::text, 0));
  SELECT COALESCE(max(numero_versao), 0) + 1 INTO version_number
  FROM public.documento_versoes WHERE documento_id = doc_id;
  SELECT EXISTS (SELECT 1 FROM public.documento_versoes WHERE documento_id = doc_id AND sha256 = lower(p_sha256)) INTO same_hash;

  INSERT INTO public.documento_versoes (
    documento_id, numero_versao, bucket, path, nome_original, mime_type, tamanho_bytes, sha256,
    status, substitui_versao_id, enviado_por, fiscal_reservation_id
  ) VALUES (
    doc_id, version_number, p_bucket, p_path, p_nome_original, lower(p_mime_type), p_tamanho_bytes, lower(p_sha256),
    'em_analise', p_substitui_versao_id, p_enviado_por, p_reservation_id
  ) RETURNING id INTO version_id;

  UPDATE public.documentos_repositorio SET status = 'em_analise', deleted_at = NULL WHERE id = doc_id;
  UPDATE public.documento_requisito_instancias
  SET documento_id = doc_id,
      documento_tipo_id = p_documento_tipo_id,
      versao_aprovada_id = NULL,
      status = 'pendente',
      satisfeito_em = NULL
  WHERE id = p_requisito_id;

  RETURN jsonb_build_object(
    'documento_id', doc_id,
    'versao_id', version_id,
    'numero_versao', version_number,
    'sha256_igual', same_hash,
    'cedente_fundo_id', nf_cedente_fundo,
    'fundo_id', nf_fundo
  );
END;
$$;
REVOKE ALL ON FUNCTION private.fiscal_registrar_documento_upload(uuid,uuid,uuid,text,text,bigint,text,text,text,uuid,uuid,uuid,uuid,bigint) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.registrar_documento_upload(
  p_nota_fiscal_id uuid,
  p_requisito_id uuid,
  p_documento_tipo_id uuid,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text,
  p_bucket text,
  p_path text,
  p_enviado_por uuid,
  p_substitui_versao_id uuid DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $wrapper$
  SELECT private.fiscal_registrar_documento_upload(p_nota_fiscal_id,p_requisito_id,p_documento_tipo_id,p_nome_original,p_mime_type,p_tamanho_bytes,p_sha256,p_bucket,p_path,p_enviado_por,p_substitui_versao_id,NULL,NULL,NULL);
$wrapper$;

COMMIT;
