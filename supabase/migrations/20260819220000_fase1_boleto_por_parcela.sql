-- Fase 1 (continuacao): boleto como documento pre-cessao POR_PARCELA,
-- reaproveitando o motor de versionamento/analise documental existente
-- (documentos_repositorio/documento_versoes/documento_vinculos/documento_analises)
-- em vez de criar um motor paralelo.
--
-- Cardinalidade POR_PARCELA: documento_tipos ganha uma coluna generica
-- (nao hardcoded para "boleto") para que qualquer tipo futuro possa ser
-- por-NF (padrao, como hoje) ou por-parcela.
--
-- Decisao de design: NAO foi adicionada uma coluna parcela_id em
-- documento_vinculos. documento_requisito_instancias.documento_id ja e a
-- ancora correta de deduplicacao/versionamento por requisito (usada por
-- registrar_documento_upload sem qualquer alteracao); ao dar a cada
-- parcela sua PROPRIA linha de documento_requisito_instancias (com
-- parcela_id proprio), o documento correspondente automaticamente fica
-- isolado por parcela -- adicionar a mesma dimensao em documento_vinculos
-- seria redundante.

BEGIN;

-- ============================================================
-- 1. Cardinalidade no catalogo + linha real do boleto
-- ============================================================

ALTER TABLE public.documento_tipos
  ADD COLUMN cardinalidade text NOT NULL DEFAULT 'por_nf';
ALTER TABLE public.documento_tipos
  ADD CONSTRAINT documento_tipos_cardinalidade_check CHECK (cardinalidade IN ('por_nf', 'por_parcela'));

INSERT INTO public.documento_tipos (codigo, nome, dominio, cardinalidade, mime_types_aceitos, extensoes_aceitas, tamanho_max_bytes)
VALUES (
  'boleto', 'Boleto da Parcela', 'nf', 'por_parcela',
  ARRAY['application/pdf'], ARRAY['pdf'], 10485760
)
ON CONFLICT (codigo) DO NOTHING;

-- Fecha o gap relatado no ticket: politica_requisitos_documentais.tipo_documento_codigo
-- ja aceitava 'boleto' na constraint, mas nunca havia documento_tipos
-- correspondente -- causa raiz de "Tipo ainda nao catalogado para upload
-- nesta fase" (src/components/documentos-v2/ChecklistCedente.tsx:323).
--
-- Nao ha backfill de politica_requisitos_documentais.documento_tipo_id
-- aqui: requisitos de versao de politica ja publicada sao imutaveis
-- (trigger politica_requisito_publicado_immutavel) e, na pratica, esse
-- diagnostico mostrou que documento_tipo_id nunca e preenchido pelo fluxo
-- normal de criacao de requisito (normalizarRequisitoDocumental so grava
-- tipo_documento_codigo) -- por isso instanciar_requisitos_nota, abaixo,
-- passa a resolver o documento_tipo_id por CODIGO (documento_tipos.codigo
-- = tipo_documento_codigo) em vez de depender dessa coluna, que e a causa
-- raiz real do bug, nao apenas a ausencia da linha "boleto" no catalogo.

-- ============================================================
-- 2. Requisito por parcela
-- ============================================================

ALTER TABLE public.documento_requisito_instancias
  ADD COLUMN parcela_id uuid REFERENCES public.nota_fiscal_parcelas(id) ON DELETE RESTRICT;

ALTER TABLE public.documento_requisito_instancias
  DROP CONSTRAINT documento_requisito_unique;
ALTER TABLE public.documento_requisito_instancias
  ADD CONSTRAINT documento_requisito_unique UNIQUE NULLS NOT DISTINCT (politica_requisito_id, nota_fiscal_id, parcela_id);

CREATE INDEX idx_documento_requisito_parcela ON public.documento_requisito_instancias(parcela_id) WHERE parcela_id IS NOT NULL;

-- instanciar_requisitos_nota: camada mais recente (corrigir_documento_tipo_requisitos_nf,
-- 20260727212953) preservada integralmente -- resolucao por cedente_fundo_politicas
-- ativa, documento_tipo_id por codigo, ON CONFLICT DO UPDATE, reconciliacao de
-- documentos-base. Unica mudanca: quando o tipo documental do requisito e
-- por_parcela, instancia 1 requisito POR parcela existente da NF (nao 1 unico
-- para a NF). NF sem parcelas (comportamento legado, sem <dup> no XML)
-- simplesmente nao recebe requisitos por_parcela -- nao ha parcela para
-- ancorar, e nenhuma regra nova foi inventada para esse caso.
CREATE OR REPLACE FUNCTION public.instanciar_requisitos_nota(
  p_nota_fiscal_id uuid,
  p_politica_operacional_id uuid,
  p_politica_versao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nf_cedente uuid;
  nf_cedente_fundo uuid;
  nf_fundo uuid;
  version_number integer;
  affected_count integer;
  reconciliation jsonb;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() NOT IN ('gestor', 'cedente') THEN
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

  IF get_user_role() = 'cedente' AND nf_cedente <> get_user_cedente_id() THEN
    RAISE EXCEPTION 'Nota fiscal fora do cedente autenticado';
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

  reconciliation := public.reconciliar_documentos_base_nf(p_nota_fiscal_id);

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

REVOKE ALL ON FUNCTION public.instanciar_requisitos_nota(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.instanciar_requisitos_nota(uuid, uuid, uuid) TO authenticated;

-- ============================================================
-- 3. Beneficiario do boleto (Matriz ou Estabelecimento aprovado do mesmo Cedente)
-- ============================================================

ALTER TABLE public.documento_versoes
  ADD COLUMN beneficiario_estabelecimento_id uuid REFERENCES public.cedente_estabelecimentos(id) ON DELETE RESTRICT;

-- A versao aprovada e imutavel (trigger existente) precisa considerar a
-- nova coluna, senao ela poderia ser alterada apos aprovacao sem violar o
-- guard.
CREATE OR REPLACE FUNCTION public.proteger_versao_documento_aprovada()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status = 'aprovado' THEN
    RAISE EXCEPTION 'Versao aprovada nao pode ser removida';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'aprovado' THEN
    IF NEW.documento_id IS DISTINCT FROM OLD.documento_id
       OR NEW.numero_versao IS DISTINCT FROM OLD.numero_versao
       OR NEW.bucket IS DISTINCT FROM OLD.bucket
       OR NEW.path IS DISTINCT FROM OLD.path
       OR NEW.nome_original IS DISTINCT FROM OLD.nome_original
       OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
       OR NEW.tamanho_bytes IS DISTINCT FROM OLD.tamanho_bytes
       OR NEW.sha256 IS DISTINCT FROM OLD.sha256
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.substitui_versao_id IS DISTINCT FROM OLD.substitui_versao_id
       OR NEW.enviado_por IS DISTINCT FROM OLD.enviado_por
       OR NEW.enviado_em IS DISTINCT FROM OLD.enviado_em
       OR NEW.beneficiario_estabelecimento_id IS DISTINCT FROM OLD.beneficiario_estabelecimento_id
    THEN
      RAISE EXCEPTION 'Versao aprovada e imutavel';
    END IF;
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

-- ============================================================
-- 4. Upload de boleto por parcela (wrapper fino sobre registrar_documento_upload)
-- ============================================================

CREATE OR REPLACE FUNCTION public.registrar_documento_boleto_parcela(
  p_nota_fiscal_id uuid,
  p_requisito_id uuid,
  p_documento_tipo_id uuid,
  p_estabelecimento_beneficiario_id uuid,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text,
  p_bucket text,
  p_path text,
  p_enviado_por uuid,
  p_substitui_versao_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_nf_cedente uuid;
  v_requisito public.documento_requisito_instancias%ROWTYPE;
  v_beneficiario public.cedente_estabelecimentos%ROWTYPE;
  v_resultado jsonb;
BEGIN
  SELECT cedente_id INTO v_nf_cedente FROM public.notas_fiscais WHERE id = p_nota_fiscal_id;
  IF v_nf_cedente IS NULL THEN RAISE EXCEPTION 'Nota fiscal nao encontrada'; END IF;

  SELECT * INTO v_requisito FROM public.documento_requisito_instancias
  WHERE id = p_requisito_id AND nota_fiscal_id = p_nota_fiscal_id;
  IF v_requisito.id IS NULL OR v_requisito.parcela_id IS NULL THEN
    RAISE EXCEPTION 'Requisito de boleto por parcela invalido';
  END IF;

  SELECT * INTO v_beneficiario FROM public.cedente_estabelecimentos WHERE id = p_estabelecimento_beneficiario_id;
  IF v_beneficiario.id IS NULL OR v_beneficiario.cedente_id <> v_nf_cedente OR v_beneficiario.status <> 'aprovado' THEN
    RAISE EXCEPTION 'Beneficiario deve ser a Matriz ou um Estabelecimento aprovado do mesmo Cedente';
  END IF;

  v_resultado := public.registrar_documento_upload(
    p_nota_fiscal_id, p_requisito_id, p_documento_tipo_id, p_nome_original, p_mime_type,
    p_tamanho_bytes, p_sha256, p_bucket, p_path, p_enviado_por, p_substitui_versao_id
  );

  UPDATE public.documento_versoes
  SET beneficiario_estabelecimento_id = p_estabelecimento_beneficiario_id
  WHERE id = (v_resultado->>'versao_id')::uuid;

  RETURN v_resultado || jsonb_build_object('beneficiario_estabelecimento_id', p_estabelecimento_beneficiario_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.registrar_documento_boleto_parcela(uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_documento_boleto_parcela(uuid, uuid, uuid, uuid, text, text, bigint, text, text, text, uuid, uuid) TO authenticated;

-- ============================================================
-- 5. Analise do boleto (wrapper com escopo multifundo real, delegando no
--    motor generico analisar_documento_versao) -- NAO reaproveita a RPC
--    diretamente sem escopo, conforme o gap explicitamente citado no ticket.
-- ============================================================

CREATE OR REPLACE FUNCTION public.analisar_documento_boleto_gestor(
  p_documento_versao_id uuid,
  p_resultado text,
  p_observacoes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_vinculo record;
BEGIN
  IF (SELECT public.get_user_role()) <> 'gestor' THEN RAISE EXCEPTION 'Apenas gestor pode analisar documentos'; END IF;

  SELECT vinc.nota_fiscal_id, vinc.cedente_id INTO v_vinculo
  FROM public.documento_versoes dv
  JOIN public.documento_vinculos vinc ON vinc.documento_id = dv.documento_id
  WHERE dv.id = p_documento_versao_id AND vinc.nota_fiscal_id IS NOT NULL;
  IF v_vinculo.nota_fiscal_id IS NULL THEN RAISE EXCEPTION 'Documento nao pertence a uma nota fiscal'; END IF;
  IF NOT private.gestor_tem_acesso_cedente(v_vinculo.cedente_id) THEN RAISE EXCEPTION 'Gestor sem vinculo ativo com o fundo desta nota fiscal'; END IF;

  RETURN public.analisar_documento_versao(p_documento_versao_id, p_resultado, p_observacoes, '{}'::jsonb);
END;
$function$;

REVOKE ALL ON FUNCTION public.analisar_documento_boleto_gestor(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analisar_documento_boleto_gestor(uuid, text, text) TO authenticated;

COMMIT;
