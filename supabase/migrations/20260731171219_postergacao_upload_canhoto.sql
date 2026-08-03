-- Postergação única da previsão de upload do canhoto no pós-cessão.
-- A configuração pertence à versão publicada da política e é congelada no
-- snapshot da operação. O prazo original da entrega nunca é sobrescrito.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.politica_operacional_versoes') IS NULL
     OR to_regclass('public.nota_fiscal_entregas') IS NULL
     OR to_regclass('public.documento_requisito_instancias') IS NULL
     OR to_regclass('public.documento_versoes') IS NULL
     OR to_regclass('public.canhotos') IS NULL
     OR to_regclass('public.eventos_entrega') IS NULL
     OR to_regclass('public.eventos_dominio') IS NULL
     OR to_regclass('public.logs_auditoria') IS NULL
     OR to_regclass('public.notificacoes') IS NULL
     OR to_regclass('public.usuario_fundos') IS NULL
     OR to_regprocedure('private.usuario_tem_acesso_fundo(uuid)') IS NULL
     OR to_regprocedure('private.consultor_tem_acesso_cedente(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pré-condições da postergação do canhoto não atendidas; aplique as migrations anteriores.';
  END IF;
END;
$$;

ALTER TABLE public.politica_operacional_versoes
  ADD COLUMN IF NOT EXISTS permite_postergacao_upload_canhoto boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS limite_postergacao_upload_canhoto_dias integer;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'politica_versao_limite_postergacao_canhoto_check'
      AND conrelid = 'public.politica_operacional_versoes'::regclass
  ) THEN
    ALTER TABLE public.politica_operacional_versoes
      ADD CONSTRAINT politica_versao_limite_postergacao_canhoto_check
      CHECK (
        limite_postergacao_upload_canhoto_dias IS NULL
        OR limite_postergacao_upload_canhoto_dias > 0
      );
  END IF;
END;
$$;

COMMENT ON COLUMN public.politica_operacional_versoes.permite_postergacao_upload_canhoto IS
  'Habilita uma única comunicação de nova previsão de upload do canhoto para operações criadas com esta versão.';
COMMENT ON COLUMN public.politica_operacional_versoes.limite_postergacao_upload_canhoto_dias IS
  'Limite em dias corridos após o prazo original. Quando habilitado e nulo, aplica-se o padrão de 5 dias.';

CREATE OR REPLACE FUNCTION public.validar_versao_publicada()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.publicada_em IS NOT NULL THEN
    RAISE EXCEPTION 'Versao publicada de politica nao pode ser excluida';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.publicada_em IS NOT NULL AND (
    NEW.politica_operacional_id IS DISTINCT FROM OLD.politica_operacional_id
    OR NEW.cedente_fundo_id IS DISTINCT FROM OLD.cedente_fundo_id
    OR NEW.versao IS DISTINCT FROM OLD.versao
    OR NEW.vigente_desde IS DISTINCT FROM OLD.vigente_desde
    OR NEW.aceite_sacado_obrigatorio IS DISTINCT FROM OLD.aceite_sacado_obrigatorio
    OR NEW.cessao_no_desembolso IS DISTINCT FROM OLD.cessao_no_desembolso
    OR NEW.cria_acompanhamento_entrega IS DISTINCT FROM OLD.cria_acompanhamento_entrega
    OR NEW.permite_postergacao_upload_canhoto IS DISTINCT FROM OLD.permite_postergacao_upload_canhoto
    OR NEW.limite_postergacao_upload_canhoto_dias IS DISTINCT FROM OLD.limite_postergacao_upload_canhoto_dias
    OR NEW.configuracao IS DISTINCT FROM OLD.configuracao
    OR NEW.conteudo_hash IS DISTINCT FROM OLD.conteudo_hash
    OR NEW.publicada_por IS DISTINCT FROM OLD.publicada_por
    OR NEW.publicada_em IS DISTINCT FROM OLD.publicada_em
  ) THEN
    RAISE EXCEPTION 'Versao publicada de politica e imutavel';
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.publicada_em IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.politica_operacional_versoes other
    WHERE other.politica_operacional_id = NEW.politica_operacional_id
      AND other.id <> NEW.id
      AND other.publicada_em IS NOT NULL
      AND tstzrange(other.vigente_desde, COALESCE(other.vigente_ate, 'infinity'::timestamptz), '[)')
        && tstzrange(NEW.vigente_desde, COALESCE(NEW.vigente_ate, 'infinity'::timestamptz), '[)')
  ) THEN
    RAISE EXCEPTION 'Versoes publicadas de uma politica nao podem sobrepor vigencia';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE public.nota_fiscal_entrega_postergacoes_canhoto (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nota_fiscal_entrega_id uuid NOT NULL REFERENCES public.nota_fiscal_entregas(id) ON DELETE RESTRICT,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  operacao_id uuid NOT NULL REFERENCES public.operacoes(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id) ON DELETE RESTRICT,
  cedente_fundo_id uuid NOT NULL REFERENCES public.cedente_fundos(id) ON DELETE RESTRICT,
  politica_operacional_versao_id uuid NOT NULL REFERENCES public.politica_operacional_versoes(id) ON DELETE RESTRICT,
  politica_snapshot_hash text NOT NULL,
  prazo_original_upload_canhoto date NOT NULL,
  nova_previsao_upload_canhoto date NOT NULL,
  motivo_postergacao text NOT NULL,
  limite_postergacao_dias_aplicado integer NOT NULL,
  postergacao_comunicada_em timestamptz NOT NULL DEFAULT now(),
  postergacao_comunicada_por uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  utilizada boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT postergacao_canhoto_entrega_unique UNIQUE (nota_fiscal_entrega_id),
  CONSTRAINT postergacao_canhoto_nf_unique UNIQUE (nota_fiscal_id),
  CONSTRAINT postergacao_canhoto_nova_data_check CHECK (nova_previsao_upload_canhoto > prazo_original_upload_canhoto),
  CONSTRAINT postergacao_canhoto_limite_check CHECK (limite_postergacao_dias_aplicado > 0),
  CONSTRAINT postergacao_canhoto_motivo_check CHECK (
    length(btrim(motivo_postergacao)) BETWEEN 1 AND 1000
  ),
  CONSTRAINT postergacao_canhoto_utilizada_check CHECK (utilizada IS TRUE)
);

COMMENT ON TABLE public.nota_fiscal_entrega_postergacoes_canhoto IS
  'Registro imutável e único por NF da nova previsão comunicada pelo cedente para upload do canhoto.';
COMMENT ON COLUMN public.nota_fiscal_entrega_postergacoes_canhoto.prazo_original_upload_canhoto IS
  'Prazo original congelado na entrega; nunca é substituído pela nova previsão.';
COMMENT ON COLUMN public.nota_fiscal_entrega_postergacoes_canhoto.nova_previsao_upload_canhoto IS
  'Nova previsão informativa de upload; não elimina eventual atraso frente ao prazo original.';

CREATE INDEX idx_postergacao_canhoto_fundo_comunicada
  ON public.nota_fiscal_entrega_postergacoes_canhoto(fundo_id, postergacao_comunicada_em DESC);

CREATE INDEX idx_postergacao_canhoto_cedente_comunicada
  ON public.nota_fiscal_entrega_postergacoes_canhoto(cedente_id, postergacao_comunicada_em DESC);

CREATE OR REPLACE FUNCTION public.proteger_postergacao_upload_canhoto()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'A comunicacao de postergacao do canhoto e imutavel';
END;
$$;

CREATE TRIGGER postergacao_upload_canhoto_append_only
  BEFORE UPDATE OR DELETE ON public.nota_fiscal_entrega_postergacoes_canhoto
  FOR EACH ROW EXECUTE FUNCTION public.proteger_postergacao_upload_canhoto();

ALTER TABLE public.nota_fiscal_entrega_postergacoes_canhoto ENABLE ROW LEVEL SECURITY;

CREATE POLICY postergacao_canhoto_cedente_select
  ON public.nota_fiscal_entrega_postergacoes_canhoto
  FOR SELECT TO authenticated
  USING (
    public.get_user_role() = 'cedente'
    AND cedente_id = (SELECT public.get_user_cedente_id())
  );

CREATE POLICY postergacao_canhoto_gestor_select
  ON public.nota_fiscal_entrega_postergacoes_canhoto
  FOR SELECT TO authenticated
  USING ((SELECT private.usuario_tem_acesso_fundo(fundo_id)));

CREATE POLICY postergacao_canhoto_consultor_select
  ON public.nota_fiscal_entrega_postergacoes_canhoto
  FOR SELECT TO authenticated
  USING ((SELECT private.consultor_tem_acesso_cedente(cedente_id)));

REVOKE ALL ON public.nota_fiscal_entrega_postergacoes_canhoto FROM anon, authenticated;
GRANT SELECT ON public.nota_fiscal_entrega_postergacoes_canhoto TO authenticated;
GRANT ALL ON public.nota_fiscal_entrega_postergacoes_canhoto TO service_role;

ALTER TABLE public.notificacoes
  ADD COLUMN IF NOT EXISTS entidade_tipo text,
  ADD COLUMN IF NOT EXISTS entidade_id uuid,
  ADD COLUMN IF NOT EXISTS href text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'notificacoes_href_interno_check'
      AND conrelid = 'public.notificacoes'::regclass
  ) THEN
    ALTER TABLE public.notificacoes
      ADD CONSTRAINT notificacoes_href_interno_check
      CHECK (href IS NULL OR (href LIKE '/%' AND href NOT LIKE '//%'));
  END IF;
END;
$$;

ALTER TABLE public.eventos_entrega
  DROP CONSTRAINT IF EXISTS eventos_entrega_tipo_check;

ALTER TABLE public.eventos_entrega
  ADD CONSTRAINT eventos_entrega_tipo_check CHECK (tipo_evento IN (
    'cessao_efetivada',
    'cte_pendente',
    'cte_enviado',
    'cte_aprovado',
    'cte_rejeitado',
    'cte_atrasado',
    'canhoto_pendente',
    'canhoto_enviado',
    'canhoto_aprovado',
    'canhoto_rejeitado',
    'canhoto_atrasado',
    'canhoto_postergacao_comunicada',
    'documento_entrega_enviado',
    'entrega_confirmada',
    'entrega_com_pendencia',
    'devolucao_registrada'
  ));

CREATE OR REPLACE FUNCTION public.comunicar_postergacao_upload_canhoto(
  p_nota_fiscal_id uuid,
  p_nova_previsao date,
  p_motivo text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_usuario_id uuid := auth.uid();
  v_role text;
  v_cedente_autenticado_id uuid;
  v_entrega public.nota_fiscal_entregas%ROWTYPE;
  v_nf public.notas_fiscais%ROWTYPE;
  v_operacao public.operacoes%ROWTYPE;
  v_vinculo public.cedente_fundos%ROWTYPE;
  v_perfil public.profiles%ROWTYPE;
  v_snapshot jsonb;
  v_requer_canhoto boolean := false;
  v_permite boolean := false;
  v_limite integer;
  v_prazo_original date;
  v_data_minima date;
  v_data_maxima date;
  v_motivo text := btrim(COALESCE(p_motivo, ''));
  v_primeiro_upload_em timestamptz;
  v_postergacao public.nota_fiscal_entrega_postergacoes_canhoto%ROWTYPE;
BEGIN
  IF v_usuario_id IS NULL THEN
    RAISE EXCEPTION 'Usuario nao autenticado.' USING ERRCODE = '42501';
  END IF;

  v_role := public.get_user_role()::text;
  IF v_role <> 'cedente' THEN
    RAISE EXCEPTION 'Somente o cedente pode informar nova previsao de upload do canhoto.' USING ERRCODE = '42501';
  END IF;

  v_cedente_autenticado_id := public.get_user_cedente_id();
  IF v_cedente_autenticado_id IS NULL THEN
    RAISE EXCEPTION 'Cedente autenticado nao encontrado.' USING ERRCODE = '42501';
  END IF;

  IF p_nota_fiscal_id IS NULL OR p_nova_previsao IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal e nova previsao sao obrigatorias.' USING ERRCODE = '22023';
  END IF;

  IF length(v_motivo) = 0 OR length(v_motivo) > 1000 THEN
    RAISE EXCEPTION 'Informe o motivo da nova previsao com ate 1000 caracteres.' USING ERRCODE = '22023';
  END IF;

  SELECT nf.* INTO v_nf
  FROM public.notas_fiscais nf
  WHERE nf.id = p_nota_fiscal_id;

  IF v_nf.id IS NULL OR v_nf.cedente_id <> v_cedente_autenticado_id THEN
    RAISE EXCEPTION 'Nota fiscal nao encontrada para o cedente autenticado.' USING ERRCODE = '42501';
  END IF;

  IF v_nf.fundo_id IS NULL OR v_nf.cedente_fundo_id IS NULL THEN
    RAISE EXCEPTION 'A nota fiscal nao possui contexto de fundo completo.' USING ERRCODE = '22023';
  END IF;

  SELECT cf.* INTO v_vinculo
  FROM public.cedente_fundos cf
  WHERE cf.id = v_nf.cedente_fundo_id
    AND cf.cedente_id = v_nf.cedente_id
    AND cf.fundo_id = v_nf.fundo_id
    AND cf.status = 'ativo';

  IF v_vinculo.id IS NULL THEN
    RAISE EXCEPTION 'O vinculo cedente-fundo da nota fiscal nao esta ativo.' USING ERRCODE = '42501';
  END IF;

  SELECT nfe.* INTO v_entrega
  FROM public.nota_fiscal_entregas nfe
  WHERE nfe.nota_fiscal_id = p_nota_fiscal_id
    AND nfe.status_entrega <> 'nao_aplicavel'
  ORDER BY nfe.created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_entrega.id IS NULL OR v_entrega.cessao_efetivada_em IS NULL THEN
    RAISE EXCEPTION 'A postergação so pode ser informada apos a cessao da nota fiscal.' USING ERRCODE = '22023';
  END IF;

  SELECT o.* INTO v_operacao
  FROM public.operacoes o
  WHERE o.id = v_entrega.operacao_id;

  IF v_operacao.id IS NULL
     OR v_operacao.cedente_id <> v_nf.cedente_id
     OR v_operacao.cedente_fundo_id IS DISTINCT FROM v_nf.cedente_fundo_id THEN
    RAISE EXCEPTION 'Contexto operacional da entrega e invalido.' USING ERRCODE = '22023';
  END IF;

  v_snapshot := v_operacao.politica_snapshot;
  IF v_snapshot IS NULL OR v_operacao.politica_operacional_versao_id IS NULL OR v_operacao.politica_snapshot_hash IS NULL THEN
    RAISE EXCEPTION 'A operacao nao possui snapshot de politica compativel com a postergacao.' USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(COALESCE(v_snapshot->'requisitos', '[]'::jsonb)) requisito
    WHERE COALESCE((requisito->>'ativo')::boolean, false)
      AND COALESCE((requisito->>'obrigatorio')::boolean, false)
      AND COALESCE(requisito->>'escopo', '') IN ('pos_cessao', 'entrega')
      AND lower(regexp_replace(
        COALESCE(requisito->>'tipo_documento_codigo', requisito->>'codigo', ''),
        '[^a-zA-Z0-9]+', '_', 'g'
      )) IN ('canhoto', 'comprovante_entrega')
  ) INTO v_requer_canhoto;

  IF NOT v_requer_canhoto THEN
    RAISE EXCEPTION 'O snapshot da operacao nao exige canhoto no pos-cessao.' USING ERRCODE = '22023';
  END IF;

  v_permite := lower(COALESCE(v_snapshot->>'permite_postergacao_upload_canhoto', 'false')) = 'true';
  IF NOT v_permite THEN
    RAISE EXCEPTION 'A politica registrada na operacao nao permite postergacao do upload do canhoto.' USING ERRCODE = '22023';
  END IF;

  BEGIN
    v_limite := NULLIF(v_snapshot->>'limite_postergacao_upload_canhoto_dias', '')::integer;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'O snapshot da operacao possui limite de postergacao invalido.' USING ERRCODE = '22023';
  END;
  v_limite := COALESCE(v_limite, 5);
  IF v_limite <= 0 THEN
    RAISE EXCEPTION 'O limite de postergacao registrado na operacao e invalido.' USING ERRCODE = '22023';
  END IF;

  v_prazo_original := v_entrega.data_limite_canhoto;
  IF v_prazo_original IS NULL THEN
    RAISE EXCEPTION 'A entrega nao possui prazo original de upload do canhoto.' USING ERRCODE = '22023';
  END IF;

  v_data_maxima := v_prazo_original + v_limite;
  v_data_minima := GREATEST(CURRENT_DATE, v_prazo_original + 1);

  IF CURRENT_DATE > v_data_maxima THEN
    RAISE EXCEPTION 'O prazo maximo para comunicar a nova previsao ja foi ultrapassado.' USING ERRCODE = '22023';
  END IF;

  IF p_nova_previsao <= v_prazo_original THEN
    RAISE EXCEPTION 'A nova previsao deve ser posterior ao prazo original.' USING ERRCODE = '22023';
  END IF;

  IF p_nova_previsao < CURRENT_DATE THEN
    RAISE EXCEPTION 'A nova previsao nao pode estar no passado.' USING ERRCODE = '22023';
  END IF;

  IF p_nova_previsao < v_data_minima OR p_nova_previsao > v_data_maxima THEN
    RAISE EXCEPTION 'A nova previsao deve estar entre % e %.', v_data_minima, v_data_maxima USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.nota_fiscal_entrega_postergacoes_canhoto p
    WHERE p.nota_fiscal_id = p_nota_fiscal_id
  ) THEN
    RAISE EXCEPTION 'A nova previsao de upload do canhoto ja foi informada para esta nota fiscal.' USING ERRCODE = '23505';
  END IF;

  SELECT MIN(dv.created_at) INTO v_primeiro_upload_em
  FROM public.documento_requisito_instancias dri
  JOIN public.documento_versoes dv ON dv.documento_id = dri.documento_id
  WHERE dri.nota_fiscal_entrega_id = v_entrega.id
    AND lower(regexp_replace(COALESCE(dri.tipo_documento_codigo_snapshot, ''), '[^a-zA-Z0-9]+', '_', 'g'))
      IN ('canhoto', 'comprovante_entrega');

  IF v_primeiro_upload_em IS NULL THEN
    SELECT MIN(c.created_at) INTO v_primeiro_upload_em
    FROM public.canhotos c
    WHERE c.nota_fiscal_entrega_id = v_entrega.id;
  END IF;

  IF v_primeiro_upload_em IS NOT NULL THEN
    RAISE EXCEPTION 'A nova previsao nao pode ser informada depois do primeiro upload do canhoto.' USING ERRCODE = '22023';
  END IF;

  SELECT p.* INTO v_perfil
  FROM public.profiles p
  WHERE p.id = v_usuario_id;

  INSERT INTO public.nota_fiscal_entrega_postergacoes_canhoto (
    nota_fiscal_entrega_id,
    nota_fiscal_id,
    operacao_id,
    fundo_id,
    cedente_id,
    cedente_fundo_id,
    politica_operacional_versao_id,
    politica_snapshot_hash,
    prazo_original_upload_canhoto,
    nova_previsao_upload_canhoto,
    motivo_postergacao,
    limite_postergacao_dias_aplicado,
    postergacao_comunicada_por
  ) VALUES (
    v_entrega.id,
    v_nf.id,
    v_operacao.id,
    v_nf.fundo_id,
    v_nf.cedente_id,
    v_nf.cedente_fundo_id,
    v_operacao.politica_operacional_versao_id,
    v_operacao.politica_snapshot_hash,
    v_prazo_original,
    p_nova_previsao,
    v_motivo,
    v_limite,
    v_usuario_id
  )
  RETURNING * INTO v_postergacao;

  INSERT INTO public.eventos_entrega (
    nota_fiscal_entrega_id,
    tipo_evento,
    status_anterior,
    status_novo,
    registrado_por,
    ator_tipo,
    dados
  ) VALUES (
    v_entrega.id,
    'canhoto_postergacao_comunicada',
    v_entrega.status_entrega,
    v_entrega.status_entrega,
    v_usuario_id,
    'usuario',
    jsonb_build_object(
      'nota_fiscal_id', v_nf.id,
      'operacao_id', v_operacao.id,
      'fundo_id', v_nf.fundo_id,
      'cedente_id', v_nf.cedente_id,
      'cedente_fundo_id', v_nf.cedente_fundo_id,
      'prazo_original_upload_canhoto', v_prazo_original,
      'nova_previsao_upload_canhoto', p_nova_previsao,
      'motivo_postergacao', v_motivo,
      'limite_postergacao_dias_aplicado', v_limite,
      'politica_operacional_versao_id', v_operacao.politica_operacional_versao_id,
      'politica_snapshot_hash', v_operacao.politica_snapshot_hash,
      'dispensa_aprovacao_gestor', true,
      'ator_usuario_id', v_usuario_id,
      'ator_perfil', v_role
    )
  );

  INSERT INTO public.eventos_dominio (
    tenant_id,
    fundo_id,
    cedente_id,
    cedente_fundo_id,
    nota_fiscal_id,
    operacao_id,
    tipo_evento,
    categoria,
    ator_usuario_id,
    ator_nome_snapshot,
    ator_perfil_snapshot,
    origem,
    descricao,
    metadata,
    visibilidade,
    origem_evento,
    origem_registro_id
  ) VALUES (
    v_nf.fundo_id,
    v_nf.fundo_id,
    v_nf.cedente_id,
    v_nf.cedente_fundo_id,
    v_nf.id,
    v_operacao.id,
    'canhoto_postergacao_comunicada',
    'logistica',
    v_usuario_id,
    COALESCE(NULLIF(v_perfil.nome_completo, ''), NULLIF(v_perfil.email, ''), 'Cedente'),
    v_role,
    'rpc',
    'Cedente informou nova previsao de upload do canhoto.',
    jsonb_build_object(
      'nota_fiscal_entrega_id', v_entrega.id,
      'prazo_original_upload_canhoto', v_prazo_original,
      'nova_previsao_upload_canhoto', p_nova_previsao,
      'motivo_postergacao', v_motivo,
      'limite_postergacao_dias_aplicado', v_limite,
      'politica_operacional_versao_id', v_operacao.politica_operacional_versao_id,
      'dispensa_aprovacao_gestor', true
    ),
    'ambos',
    'nota_fiscal_entrega_postergacoes_canhoto',
    v_postergacao.id::text
  );

  INSERT INTO public.logs_auditoria (
    usuario_id,
    ator_tipo,
    origem,
    tipo_evento,
    entidade_tipo,
    entidade_id,
    dados_antes,
    dados_depois
  ) VALUES (
    v_usuario_id,
    'usuario',
    'rpc',
    'CANHOTO_POSTERGACAO_COMUNICADA',
    'nota_fiscal_entrega_postergacoes_canhoto',
    v_postergacao.id,
    jsonb_build_object(
      'prazo_original_upload_canhoto', v_prazo_original,
      'postergacao_utilizada', false
    ),
    jsonb_build_object(
      'nota_fiscal_id', v_nf.id,
      'nota_fiscal_entrega_id', v_entrega.id,
      'operacao_id', v_operacao.id,
      'fundo_id', v_nf.fundo_id,
      'cedente_id', v_nf.cedente_id,
      'cedente_fundo_id', v_nf.cedente_fundo_id,
      'prazo_original_upload_canhoto', v_prazo_original,
      'nova_previsao_upload_canhoto', p_nova_previsao,
      'motivo_postergacao', v_motivo,
      'limite_postergacao_dias_aplicado', v_limite,
      'politica_operacional_versao_id', v_operacao.politica_operacional_versao_id,
      'politica_snapshot_hash', v_operacao.politica_snapshot_hash,
      'postergacao_utilizada', true,
      'dispensa_aprovacao_gestor', true
    )
  );

  INSERT INTO public.notificacoes (
    usuario_id,
    titulo,
    mensagem,
    tipo,
    dedupe_key,
    entidade_tipo,
    entidade_id,
    href
  )
  SELECT DISTINCT
    uf.usuario_id,
    'Nova previsao de upload do canhoto',
    'O cedente ' || COALESCE(NULLIF(v_perfil.nome_completo, ''), NULLIF(v_perfil.email, ''), 'não identificado') ||
      ' comunicou nova previsão para upload do canhoto da NF ' || v_nf.numero_nf ||
      '. Prazo original: ' || to_char(v_prazo_original, 'DD/MM/YYYY') ||
      '. Nova previsão: ' || to_char(p_nova_previsao, 'DD/MM/YYYY') ||
      '. Motivo: ' || v_motivo ||
      '. Comunicada em: ' || to_char(CURRENT_TIMESTAMP, 'DD/MM/YYYY HH24:MI') || '.',
    'info',
    'nf:' || v_nf.id::text || ':canhoto_postergacao:' || uf.usuario_id::text,
    'notas_fiscais',
    v_nf.id,
    '/gestor/notas-fiscais/' || v_nf.id::text
  FROM public.usuario_fundos uf
  JOIN public.profiles p ON p.id = uf.usuario_id
  WHERE uf.fundo_id = v_nf.fundo_id
    AND uf.status = 'ativo'
    AND p.role = 'gestor'
    AND p.status = 'ativo'
  ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;

  RETURN jsonb_build_object(
    'id', v_postergacao.id,
    'nota_fiscal_id', v_nf.id,
    'nota_fiscal_entrega_id', v_entrega.id,
    'prazo_original_upload_canhoto', v_prazo_original,
    'nova_previsao_upload_canhoto', p_nova_previsao,
    'motivo_postergacao', v_motivo,
    'limite_postergacao_dias_aplicado', v_limite,
    'postergacao_comunicada_em', v_postergacao.postergacao_comunicada_em,
    'postergacao_comunicada_por', v_usuario_id,
    'data_minima', v_data_minima,
    'data_maxima', v_data_maxima
  );
END;
$$;

REVOKE ALL ON FUNCTION public.comunicar_postergacao_upload_canhoto(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comunicar_postergacao_upload_canhoto(uuid, date, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
