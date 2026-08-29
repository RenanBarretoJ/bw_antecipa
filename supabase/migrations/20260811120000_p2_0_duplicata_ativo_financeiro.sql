-- P2.0: Duplicata Mercantil como ativo financeiro configuravel por versao de politica.
-- A NF permanece como lastro fiscal/comercial. Esta migration nao altera operacoes,
-- precificacao, aquisicao, liquidacao ou registro externo do ativo.

ALTER TABLE public.politica_operacional_versoes
  ADD COLUMN IF NOT EXISTS tipo_ativo_financeiro text NOT NULL DEFAULT 'NOTA_FISCAL';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'politica_versao_tipo_ativo_financeiro_check'
      AND conrelid = 'public.politica_operacional_versoes'::regclass
  ) THEN
    ALTER TABLE public.politica_operacional_versoes
      ADD CONSTRAINT politica_versao_tipo_ativo_financeiro_check
      CHECK (tipo_ativo_financeiro IN ('NOTA_FISCAL', 'DUPLICATA_MERCANTIL'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.politica_operacional_versoes.tipo_ativo_financeiro IS
  'Ativo financeiro esperado pela politica. NOTA_FISCAL preserva o comportamento legado; DUPLICATA_MERCANTIL habilita o P2.0.';

-- Inclui o novo parametro na protecao de imutabilidade das versoes publicadas.
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
    OR NEW.fundo_id IS DISTINCT FROM OLD.fundo_id
    OR NEW.versao IS DISTINCT FROM OLD.versao
    OR NEW.vigente_desde IS DISTINCT FROM OLD.vigente_desde
    OR NEW.aceite_sacado_obrigatorio IS DISTINCT FROM OLD.aceite_sacado_obrigatorio
    OR NEW.cessao_no_desembolso IS DISTINCT FROM OLD.cessao_no_desembolso
    OR NEW.cria_acompanhamento_entrega IS DISTINCT FROM OLD.cria_acompanhamento_entrega
    OR NEW.permite_postergacao_upload_canhoto IS DISTINCT FROM OLD.permite_postergacao_upload_canhoto
    OR NEW.limite_postergacao_upload_canhoto_dias IS DISTINCT FROM OLD.limite_postergacao_upload_canhoto_dias
    OR NEW.metodo_calculo_financeiro IS DISTINCT FROM OLD.metodo_calculo_financeiro
    OR NEW.tipo_ativo_financeiro IS DISTINCT FROM OLD.tipo_ativo_financeiro
    OR NEW.exigir_status_logistico_pre_cessao IS DISTINCT FROM OLD.exigir_status_logistico_pre_cessao
    OR NEW.configuracao IS DISTINCT FROM OLD.configuracao
    OR NEW.regras IS DISTINCT FROM OLD.regras
    OR NEW.parametros IS DISTINCT FROM OLD.parametros
    OR NEW.conteudo_hash IS DISTINCT FROM OLD.conteudo_hash
    OR NEW.publicada_por IS DISTINCT FROM OLD.publicada_por
    OR NEW.publicada_em IS DISTINCT FROM OLD.publicada_em
  ) THEN
    RAISE EXCEPTION 'Versao publicada de politica e imutavel';
  END IF;

  IF TG_OP <> 'DELETE'
     AND NEW.publicada_em IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.publicada_em IS NULL)
     AND NEW.metodo_calculo_financeiro IS NULL THEN
    RAISE EXCEPTION 'Selecione o metodo de calculo financeiro antes de publicar';
  END IF;

  IF TG_OP <> 'DELETE' AND NEW.publicada_em IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.politica_operacional_versoes other
    WHERE other.politica_operacional_id = NEW.politica_operacional_id
      AND other.id <> NEW.id
      AND other.publicada_em IS NOT NULL
      AND tstzrange(other.vigente_desde, coalesce(other.vigente_ate, 'infinity'::timestamptz), '[)')
        && tstzrange(NEW.vigente_desde, coalesce(NEW.vigente_ate, 'infinity'::timestamptz), '[)')
  ) THEN
    RAISE EXCEPTION 'Versoes publicadas de uma politica nao podem sobrepor vigencia';
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TABLE public.duplicatas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  cedente_fundo_id uuid NOT NULL REFERENCES public.cedente_fundos(id) ON DELETE RESTRICT,
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id) ON DELETE RESTRICT,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  sacado_id uuid REFERENCES public.sacados(id) ON DELETE SET NULL,
  numero text,
  numero_fatura text,
  parcela text NOT NULL DEFAULT '',
  data_emissao date,
  data_vencimento date,
  valor_nominal numeric(19,2),
  moeda char(3) NOT NULL DEFAULT 'BRL',
  nome_cedente_documento text,
  cnpj_cedente_documento text,
  nome_sacado_documento text,
  cnpj_sacado_documento text,
  local_pagamento text,
  aceite_textual text,
  aceite_detectado_textualmente text NOT NULL DEFAULT 'INDETERMINADO',
  status_validacao text NOT NULL DEFAULT 'RASCUNHO',
  metodo_extracao text NOT NULL DEFAULT 'MANUAL',
  resultado_confronto text NOT NULL DEFAULT 'INCOMPLETO',
  versao_atual_id uuid,
  criado_por uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  validado_por uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  validado_em timestamptz,
  motivo_rejeicao text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT duplicatas_status_check CHECK (status_validacao IN ('RASCUNHO', 'EXTRAIDA', 'REVISAR', 'VALIDADA', 'REJEITADA')),
  CONSTRAINT duplicatas_metodo_check CHECK (metodo_extracao IN ('AUTOMATICA', 'MANUAL')),
  CONSTRAINT duplicatas_confronto_check CHECK (resultado_confronto IN ('COERENTE', 'DIVERGENTE', 'INCOMPLETO')),
  CONSTRAINT duplicatas_numero_check CHECK (numero IS NULL OR length(btrim(numero)) > 0),
  CONSTRAINT duplicatas_parcela_check CHECK (length(parcela) <= 30),
  CONSTRAINT duplicatas_valor_check CHECK (valor_nominal IS NULL OR valor_nominal > 0),
  CONSTRAINT duplicatas_moeda_check CHECK (moeda ~ '^[A-Z]{3}$'),
  CONSTRAINT duplicatas_nome_cedente_check CHECK (nome_cedente_documento IS NULL OR length(nome_cedente_documento) <= 300),
  CONSTRAINT duplicatas_cnpj_cedente_check CHECK (cnpj_cedente_documento IS NULL OR cnpj_cedente_documento ~ '^[0-9]{14}$'),
  CONSTRAINT duplicatas_nome_sacado_check CHECK (nome_sacado_documento IS NULL OR length(nome_sacado_documento) <= 300),
  CONSTRAINT duplicatas_cnpj_sacado_check CHECK (cnpj_sacado_documento IS NULL OR cnpj_sacado_documento ~ '^[0-9]{14}$'),
  CONSTRAINT duplicatas_aceite_detectado_check CHECK (aceite_detectado_textualmente IN ('SIM', 'NAO', 'INDETERMINADO')),
  CONSTRAINT duplicatas_validacao_actor_check CHECK ((validado_em IS NULL) = (validado_por IS NULL)),
  CONSTRAINT duplicatas_rejeicao_check CHECK (status_validacao <> 'REJEITADA' OR length(btrim(coalesce(motivo_rejeicao, ''))) > 0),
  CONSTRAINT duplicatas_id_nf_unique UNIQUE (id, nota_fiscal_id)
);

CREATE UNIQUE INDEX uq_duplicatas_identidade_vinculo
  ON public.duplicatas(cedente_fundo_id, numero, parcela)
  WHERE numero IS NOT NULL;
CREATE INDEX idx_duplicatas_nf_status ON public.duplicatas(nota_fiscal_id, status_validacao, created_at DESC);
CREATE INDEX idx_duplicatas_fundo_status ON public.duplicatas(fundo_id, status_validacao, created_at DESC);
CREATE INDEX idx_duplicatas_fundo_vencimento_valor ON public.duplicatas(fundo_id, data_vencimento, valor_nominal);
CREATE INDEX idx_duplicatas_cedente_fundo ON public.duplicatas(cedente_fundo_id, created_at DESC);
CREATE INDEX idx_duplicatas_fatura ON public.duplicatas(cedente_fundo_id, numero_fatura) WHERE numero_fatura IS NOT NULL;
CREATE INDEX idx_duplicatas_sacado ON public.duplicatas(sacado_id) WHERE sacado_id IS NOT NULL;
CREATE TRIGGER duplicatas_updated_at
  BEFORE UPDATE ON public.duplicatas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TABLE public.duplicata_versoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  duplicata_id uuid NOT NULL REFERENCES public.duplicatas(id) ON DELETE RESTRICT,
  nota_fiscal_id uuid NOT NULL REFERENCES public.notas_fiscais(id) ON DELETE RESTRICT,
  numero_versao integer NOT NULL,
  bucket text NOT NULL DEFAULT 'documentos-v2',
  path text NOT NULL,
  nome_original text NOT NULL,
  mime_type text NOT NULL,
  tamanho_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  metodo_extracao text NOT NULL,
  texto_extraido text,
  campos_extraidos jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidencias jsonb NOT NULL DEFAULT '{}'::jsonb,
  resultado_validacao jsonb NOT NULL DEFAULT '{}'::jsonb,
  confianca_geral numeric(5,4) NOT NULL DEFAULT 0,
  enviado_por uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  enviado_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT duplicata_versoes_numero_check CHECK (numero_versao > 0),
  CONSTRAINT duplicata_versoes_bucket_check CHECK (bucket = 'documentos-v2'),
  CONSTRAINT duplicata_versoes_pdf_check CHECK (mime_type = 'application/pdf'),
  CONSTRAINT duplicata_versoes_tamanho_check CHECK (tamanho_bytes > 0 AND tamanho_bytes <= 20971520),
  CONSTRAINT duplicata_versoes_sha_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT duplicata_versoes_metodo_check CHECK (metodo_extracao IN ('AUTOMATICA', 'MANUAL')),
  CONSTRAINT duplicata_versoes_texto_check CHECK (texto_extraido IS NULL OR length(texto_extraido) <= 50000),
  CONSTRAINT duplicata_versoes_confianca_check CHECK (confianca_geral >= 0 AND confianca_geral <= 1),
  CONSTRAINT duplicata_versoes_numero_unique UNIQUE (duplicata_id, numero_versao),
  CONSTRAINT duplicata_versoes_path_unique UNIQUE (bucket, path),
  CONSTRAINT duplicata_versoes_nf_hash_unique UNIQUE (nota_fiscal_id, sha256),
  CONSTRAINT duplicata_versoes_id_duplicata_unique UNIQUE (id, duplicata_id),
  CONSTRAINT duplicata_versoes_duplicata_nf_fk
    FOREIGN KEY (duplicata_id, nota_fiscal_id)
    REFERENCES public.duplicatas(id, nota_fiscal_id)
    ON DELETE RESTRICT
);

ALTER TABLE public.duplicatas
  ADD CONSTRAINT duplicatas_versao_atual_fk
  FOREIGN KEY (versao_atual_id, id)
  REFERENCES public.duplicata_versoes(id, duplicata_id)
  ON DELETE RESTRICT;

CREATE INDEX idx_duplicata_versoes_duplicata ON public.duplicata_versoes(duplicata_id, numero_versao DESC);
CREATE INDEX idx_duplicata_versoes_nf ON public.duplicata_versoes(nota_fiscal_id, enviado_em DESC);

CREATE TABLE public.duplicata_correcoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  duplicata_id uuid NOT NULL REFERENCES public.duplicatas(id) ON DELETE RESTRICT,
  duplicata_versao_id uuid NOT NULL REFERENCES public.duplicata_versoes(id) ON DELETE RESTRICT,
  campo text NOT NULL,
  valor_original jsonb,
  valor_corrigido jsonb,
  motivo text NOT NULL,
  corrigido_por uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  corrigido_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT duplicata_correcoes_campo_check CHECK (campo IN (
    'numero', 'numero_fatura', 'parcela', 'data_emissao', 'data_vencimento',
    'valor_nominal', 'nome_cedente_documento', 'cnpj_cedente_documento',
    'nome_sacado_documento', 'cnpj_sacado_documento',
    'local_pagamento', 'aceite_textual'
  )),
  CONSTRAINT duplicata_correcoes_motivo_check CHECK (length(btrim(motivo)) > 0)
);

CREATE INDEX idx_duplicata_correcoes_duplicata ON public.duplicata_correcoes(duplicata_id, corrigido_em DESC);
CREATE INDEX idx_duplicata_correcoes_versao ON public.duplicata_correcoes(duplicata_versao_id, corrigido_em DESC);

CREATE TABLE public.duplicata_validacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  duplicata_id uuid NOT NULL REFERENCES public.duplicatas(id) ON DELETE RESTRICT,
  duplicata_versao_id uuid NOT NULL REFERENCES public.duplicata_versoes(id) ON DELETE RESTRICT,
  resultado text NOT NULL,
  observacoes text,
  resultado_confronto jsonb NOT NULL DEFAULT '{}'::jsonb,
  validado_por uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  validado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT duplicata_validacoes_resultado_check CHECK (resultado IN ('VALIDADA', 'REJEITADA')),
  CONSTRAINT duplicata_validacoes_motivo_check CHECK (resultado <> 'REJEITADA' OR length(btrim(coalesce(observacoes, ''))) > 0)
);

CREATE INDEX idx_duplicata_validacoes_duplicata ON public.duplicata_validacoes(duplicata_id, validado_em DESC);

CREATE OR REPLACE FUNCTION private.duplicata_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Historico de duplicata e append-only';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER duplicata_correcoes_append_only
  BEFORE UPDATE OR DELETE ON public.duplicata_correcoes
  FOR EACH ROW EXECUTE FUNCTION private.duplicata_append_only();
CREATE TRIGGER duplicata_validacoes_append_only
  BEFORE UPDATE OR DELETE ON public.duplicata_validacoes
  FOR EACH ROW EXECUTE FUNCTION private.duplicata_append_only();
CREATE TRIGGER duplicata_versoes_append_only
  BEFORE UPDATE OR DELETE ON public.duplicata_versoes
  FOR EACH ROW EXECUTE FUNCTION private.duplicata_append_only();

ALTER TABLE public.duplicatas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duplicata_versoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duplicata_correcoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.duplicata_validacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY duplicatas_select_contexto ON public.duplicatas
  FOR SELECT TO authenticated
  USING (
    (SELECT private.usuario_tem_acesso_fundo(duplicatas.fundo_id))
    OR duplicatas.cedente_id = (SELECT public.get_user_cedente_id())
    OR (SELECT private.consultor_tem_acesso_cedente(duplicatas.cedente_id))
  );

CREATE POLICY duplicata_versoes_select_contexto ON public.duplicata_versoes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.duplicatas d
    WHERE d.id = duplicata_versoes.duplicata_id
  ));

CREATE POLICY duplicata_correcoes_select_contexto ON public.duplicata_correcoes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.duplicatas d
    WHERE d.id = duplicata_correcoes.duplicata_id
  ));

CREATE POLICY duplicata_validacoes_select_contexto ON public.duplicata_validacoes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.duplicatas d
    WHERE d.id = duplicata_validacoes.duplicata_id
  ));

GRANT SELECT ON public.duplicatas, public.duplicata_versoes, public.duplicata_correcoes, public.duplicata_validacoes TO authenticated;
GRANT ALL ON public.duplicatas, public.duplicata_versoes, public.duplicata_correcoes, public.duplicata_validacoes TO service_role;

CREATE OR REPLACE FUNCTION public.registrar_duplicata_versao(
  p_nota_fiscal_id uuid,
  p_duplicata_id uuid,
  p_numero text,
  p_numero_fatura text,
  p_parcela text,
  p_data_emissao date,
  p_data_vencimento date,
  p_valor_nominal numeric,
  p_nome_cedente text,
  p_cnpj_cedente text,
  p_nome_sacado text,
  p_cnpj_sacado text,
  p_local_pagamento text,
  p_aceite_textual text,
  p_aceite_detectado text,
  p_status text,
  p_metodo_extracao text,
  p_resultado_confronto text,
  p_bucket text,
  p_path text,
  p_nome_original text,
  p_mime_type text,
  p_tamanho_bytes bigint,
  p_sha256 text,
  p_texto_extraido text,
  p_campos_extraidos jsonb,
  p_evidencias jsonb,
  p_resultado_validacao jsonb,
  p_confianca numeric
)
RETURNS TABLE (duplicata_id uuid, duplicata_versao_id uuid, numero_versao integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_role text := (SELECT public.get_user_role());
  v_nf public.notas_fiscais%ROWTYPE;
  v_duplicata public.duplicatas%ROWTYPE;
  v_versao_id uuid;
  v_numero_versao integer;
  v_actor_name text;
  v_nova_duplicata boolean := false;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Usuario nao autenticado'; END IF;
  IF p_bucket <> 'documentos-v2' OR p_mime_type <> 'application/pdf' THEN
    RAISE EXCEPTION 'Documento de duplicata invalido';
  END IF;
  IF p_status NOT IN ('RASCUNHO', 'EXTRAIDA', 'REVISAR')
     OR p_metodo_extracao NOT IN ('AUTOMATICA', 'MANUAL')
     OR p_resultado_confronto NOT IN ('COERENTE', 'DIVERGENTE', 'INCOMPLETO')
     OR p_aceite_detectado NOT IN ('SIM', 'NAO', 'INDETERMINADO') THEN
    RAISE EXCEPTION 'Estado inicial da duplicata invalido';
  END IF;

  SELECT * INTO v_nf FROM public.notas_fiscais nf WHERE nf.id = p_nota_fiscal_id FOR SHARE;
  IF NOT FOUND OR v_nf.fundo_id IS NULL OR v_nf.cedente_fundo_id IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal sem contexto operacional valido';
  END IF;
  IF p_path NOT LIKE v_nf.cedente_id::text || '/duplicatas/' || v_nf.id::text || '/%'
     OR position('..' in p_path) > 0 THEN
    RAISE EXCEPTION 'Caminho documental fora do contexto autorizado';
  END IF;
  IF NOT (
    (v_role = 'cedente' AND v_nf.cedente_id = (SELECT public.get_user_cedente_id()))
    OR (v_role = 'gestor' AND (SELECT private.usuario_tem_acesso_fundo(v_nf.fundo_id)))
  ) THEN
    RAISE EXCEPTION 'Usuario sem permissao para registrar duplicata';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.cedente_fundo_politicas cfp
    JOIN public.politicas_operacionais po ON po.id = cfp.politica_operacional_id
    JOIN public.politica_operacional_versoes pov ON pov.politica_operacional_id = po.id
    WHERE cfp.cedente_fundo_id = v_nf.cedente_fundo_id
      AND cfp.status = 'ativa'
      AND cfp.vigente_desde <= now()
      AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now())
      AND po.fundo_id = v_nf.fundo_id
      AND po.status = 'ativa'
      AND pov.fundo_id = v_nf.fundo_id
      AND pov.status = 'publicada'
      AND pov.publicada_em IS NOT NULL
      AND pov.vigente_desde <= now()
      AND (pov.vigente_ate IS NULL OR pov.vigente_ate > now())
      AND pov.tipo_ativo_financeiro = 'DUPLICATA_MERCANTIL'
  ) THEN
    RAISE EXCEPTION 'A politica vigente nao utiliza Duplicata Mercantil';
  END IF;

  IF p_duplicata_id IS NOT NULL THEN
    SELECT * INTO v_duplicata FROM public.duplicatas d
    WHERE d.id = p_duplicata_id AND d.nota_fiscal_id = p_nota_fiscal_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Duplicata nao encontrada no contexto da nota fiscal'; END IF;
  ELSIF nullif(btrim(p_numero), '') IS NOT NULL THEN
    SELECT * INTO v_duplicata FROM public.duplicatas d
    WHERE d.cedente_fundo_id = v_nf.cedente_fundo_id
      AND d.nota_fiscal_id = p_nota_fiscal_id
      AND d.numero = btrim(p_numero)
      AND d.parcela = coalesce(btrim(p_parcela), '')
    FOR UPDATE;
  END IF;

  IF v_duplicata.id IS NULL THEN
    v_nova_duplicata := true;
    INSERT INTO public.duplicatas (
      fundo_id, cedente_fundo_id, cedente_id, nota_fiscal_id, sacado_id,
      numero, numero_fatura, parcela, data_emissao, data_vencimento,
      valor_nominal, nome_cedente_documento, cnpj_cedente_documento,
      nome_sacado_documento, cnpj_sacado_documento, local_pagamento,
      aceite_textual, aceite_detectado_textualmente, status_validacao, metodo_extracao,
      resultado_confronto, criado_por
    ) VALUES (
      v_nf.fundo_id, v_nf.cedente_fundo_id, v_nf.cedente_id, v_nf.id,
      (SELECT s.id FROM public.sacados s WHERE regexp_replace(s.cnpj, '[^0-9]', '', 'g') = p_cnpj_sacado LIMIT 1),
      nullif(btrim(p_numero), ''), nullif(btrim(p_numero_fatura), ''), coalesce(btrim(p_parcela), ''),
      p_data_emissao, p_data_vencimento, p_valor_nominal,
      nullif(btrim(p_nome_cedente), ''), p_cnpj_cedente,
      nullif(btrim(p_nome_sacado), ''), p_cnpj_sacado,
      nullif(btrim(p_local_pagamento), ''), nullif(btrim(p_aceite_textual), ''),
      p_aceite_detectado, p_status, p_metodo_extracao, p_resultado_confronto, v_user_id
    ) RETURNING * INTO v_duplicata;
  ELSE
    UPDATE public.duplicatas SET
      numero = nullif(btrim(p_numero), ''),
      numero_fatura = nullif(btrim(p_numero_fatura), ''),
      parcela = coalesce(btrim(p_parcela), ''),
      data_emissao = p_data_emissao,
      data_vencimento = p_data_vencimento,
      valor_nominal = p_valor_nominal,
      nome_cedente_documento = nullif(btrim(p_nome_cedente), ''),
      cnpj_cedente_documento = p_cnpj_cedente,
      nome_sacado_documento = nullif(btrim(p_nome_sacado), ''),
      cnpj_sacado_documento = p_cnpj_sacado,
      local_pagamento = nullif(btrim(p_local_pagamento), ''),
      aceite_textual = nullif(btrim(p_aceite_textual), ''),
      aceite_detectado_textualmente = p_aceite_detectado,
      status_validacao = p_status,
      metodo_extracao = p_metodo_extracao,
      resultado_confronto = p_resultado_confronto,
      validado_por = NULL,
      validado_em = NULL,
      motivo_rejeicao = NULL
    WHERE id = v_duplicata.id RETURNING * INTO v_duplicata;
  END IF;

  SELECT coalesce(max(dv.numero_versao), 0) + 1 INTO v_numero_versao
  FROM public.duplicata_versoes dv WHERE dv.duplicata_id = v_duplicata.id;

  INSERT INTO public.duplicata_versoes (
    duplicata_id, nota_fiscal_id, numero_versao, bucket, path, nome_original,
    mime_type, tamanho_bytes, sha256, metodo_extracao, texto_extraido,
    campos_extraidos, evidencias, resultado_validacao, confianca_geral, enviado_por
  ) VALUES (
    v_duplicata.id, v_nf.id, v_numero_versao, p_bucket, p_path, p_nome_original,
    p_mime_type, p_tamanho_bytes, lower(p_sha256), p_metodo_extracao,
    left(p_texto_extraido, 50000), coalesce(p_campos_extraidos, '{}'::jsonb),
    coalesce(p_evidencias, '{}'::jsonb), coalesce(p_resultado_validacao, '{}'::jsonb),
    p_confianca, v_user_id
  ) RETURNING id INTO v_versao_id;

  UPDATE public.duplicatas SET versao_atual_id = v_versao_id WHERE id = v_duplicata.id;

  SELECT coalesce(p.nome_completo, p.email, 'Usuario') INTO v_actor_name
  FROM public.profiles p WHERE p.id = v_user_id;
  IF v_nova_duplicata THEN
    INSERT INTO public.eventos_dominio (
      tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
      tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
      ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
      origem_evento, origem_registro_id
    ) VALUES (
      v_nf.fundo_id, v_nf.fundo_id, v_nf.cedente_id, v_nf.cedente_fundo_id, v_nf.id,
      'duplicata_criada', 'documento', v_user_id, v_actor_name, v_role,
      'app', 'Duplicata Mercantil criada como ativo financeiro vinculado a NF.',
      jsonb_build_object('duplicata_id', v_duplicata.id, 'numero', v_duplicata.numero, 'parcela', v_duplicata.parcela),
      'ambos', 'duplicatas', v_duplicata.id::text
    ) ON CONFLICT (origem_evento, origem_registro_id, tipo_evento)
      WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL DO NOTHING;
  END IF;
  INSERT INTO public.eventos_dominio (
    tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
    tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
    ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
    origem_evento, origem_registro_id
  ) VALUES (
    v_nf.fundo_id, v_nf.fundo_id, v_nf.cedente_id, v_nf.cedente_fundo_id, v_nf.id,
    'duplicata_pdf_enviado', 'documento', v_user_id, v_actor_name, v_role,
    'app', 'Versao de duplicata enviada para extracao e conferencia.',
    jsonb_build_object('duplicata_id', v_duplicata.id, 'versao', v_numero_versao, 'status', p_status),
    'ambos', 'duplicata_versoes', v_versao_id::text
  ) ON CONFLICT (origem_evento, origem_registro_id, tipo_evento)
    WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL DO NOTHING;

  INSERT INTO public.eventos_dominio (
    tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
    tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
    ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
    origem_evento, origem_registro_id
  ) VALUES (
    v_nf.fundo_id, v_nf.fundo_id, v_nf.cedente_id, v_nf.cedente_fundo_id, v_nf.id,
    CASE WHEN p_status = 'EXTRAIDA' THEN 'duplicata_extraida' ELSE 'duplicata_requer_revisao' END,
    'analise', v_user_id, v_actor_name, v_role, 'app',
    CASE WHEN p_status = 'EXTRAIDA'
      THEN 'Campos da duplicata extraidos automaticamente e encaminhados para validacao.'
      ELSE 'Duplicata encaminhada para revisao humana.'
    END,
    jsonb_build_object('duplicata_id', v_duplicata.id, 'versao', v_numero_versao, 'metodo', p_metodo_extracao, 'confianca', p_confianca),
    'ambos', 'duplicata_extracao', v_versao_id::text
  ) ON CONFLICT (origem_evento, origem_registro_id, tipo_evento)
    WHERE origem_evento IS NOT NULL AND origem_registro_id IS NOT NULL DO NOTHING;

  RETURN QUERY SELECT v_duplicata.id, v_versao_id, v_numero_versao;
END;
$$;

CREATE OR REPLACE FUNCTION public.corrigir_duplicata(
  p_duplicata_id uuid,
  p_campos jsonb,
  p_motivo text,
  p_resultado_confronto text
)
RETURNS public.duplicatas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_role text := (SELECT public.get_user_role());
  v_old public.duplicatas%ROWTYPE;
  v_new public.duplicatas%ROWTYPE;
  v_version uuid;
  v_key text;
  v_old_value jsonb;
  v_new_value jsonb;
  v_actor_name text;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Usuario nao autenticado'; END IF;
  IF length(btrim(coalesce(p_motivo, ''))) = 0 THEN RAISE EXCEPTION 'Informe o motivo da correcao'; END IF;
  SELECT * INTO v_old FROM public.duplicatas d WHERE d.id = p_duplicata_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Duplicata nao encontrada'; END IF;
  IF NOT (
    (v_role = 'cedente' AND v_old.cedente_id = (SELECT public.get_user_cedente_id()))
    OR (v_role = 'gestor' AND (SELECT private.usuario_tem_acesso_fundo(v_old.fundo_id)))
  ) THEN RAISE EXCEPTION 'Usuario sem permissao para corrigir a duplicata'; END IF;
  IF v_old.status_validacao IN ('VALIDADA', 'REJEITADA') THEN
    RAISE EXCEPTION 'Duplicata finalizada nao pode ser alterada';
  END IF;
  IF v_role = 'cedente' AND NOT EXISTS (
    SELECT 1 FROM public.notas_fiscais nf
    WHERE nf.id = v_old.nota_fiscal_id
      AND nf.status IN ('rascunho', 'requer_ajuste')
  ) THEN
    RAISE EXCEPTION 'A correcao pelo cedente deve ocorrer antes da submissao da NF';
  END IF;
  v_version := v_old.versao_atual_id;
  IF v_version IS NULL THEN RAISE EXCEPTION 'Duplicata sem versao documental atual'; END IF;

  FOREACH v_key IN ARRAY ARRAY['numero','numero_fatura','parcela','data_emissao','data_vencimento','valor_nominal','nome_cedente_documento','cnpj_cedente_documento','nome_sacado_documento','cnpj_sacado_documento','local_pagamento','aceite_textual'] LOOP
    IF p_campos ? v_key THEN
      v_old_value := to_jsonb(v_old)->v_key;
      v_new_value := p_campos->v_key;
      IF v_old_value IS DISTINCT FROM v_new_value THEN
        INSERT INTO public.duplicata_correcoes (
          duplicata_id, duplicata_versao_id, campo, valor_original, valor_corrigido,
          motivo, corrigido_por
        ) VALUES (v_old.id, v_version, v_key, v_old_value, v_new_value, btrim(p_motivo), v_user_id);
      END IF;
    END IF;
  END LOOP;

  UPDATE public.duplicatas SET
    numero = CASE WHEN p_campos ? 'numero' THEN nullif(btrim(p_campos->>'numero'), '') ELSE numero END,
    numero_fatura = CASE WHEN p_campos ? 'numero_fatura' THEN nullif(btrim(p_campos->>'numero_fatura'), '') ELSE numero_fatura END,
    parcela = CASE WHEN p_campos ? 'parcela' THEN coalesce(btrim(p_campos->>'parcela'), '') ELSE parcela END,
    data_emissao = CASE WHEN p_campos ? 'data_emissao' THEN nullif(p_campos->>'data_emissao', '')::date ELSE data_emissao END,
    data_vencimento = CASE WHEN p_campos ? 'data_vencimento' THEN nullif(p_campos->>'data_vencimento', '')::date ELSE data_vencimento END,
    valor_nominal = CASE WHEN p_campos ? 'valor_nominal' THEN nullif(p_campos->>'valor_nominal', '')::numeric ELSE valor_nominal END,
    nome_cedente_documento = CASE WHEN p_campos ? 'nome_cedente_documento' THEN nullif(btrim(p_campos->>'nome_cedente_documento'), '') ELSE nome_cedente_documento END,
    cnpj_cedente_documento = CASE WHEN p_campos ? 'cnpj_cedente_documento' THEN nullif(regexp_replace(p_campos->>'cnpj_cedente_documento', '[^0-9]', '', 'g'), '') ELSE cnpj_cedente_documento END,
    nome_sacado_documento = CASE WHEN p_campos ? 'nome_sacado_documento' THEN nullif(btrim(p_campos->>'nome_sacado_documento'), '') ELSE nome_sacado_documento END,
    cnpj_sacado_documento = CASE WHEN p_campos ? 'cnpj_sacado_documento' THEN nullif(regexp_replace(p_campos->>'cnpj_sacado_documento', '[^0-9]', '', 'g'), '') ELSE cnpj_sacado_documento END,
    local_pagamento = CASE WHEN p_campos ? 'local_pagamento' THEN nullif(btrim(p_campos->>'local_pagamento'), '') ELSE local_pagamento END,
    aceite_textual = CASE WHEN p_campos ? 'aceite_textual' THEN nullif(btrim(p_campos->>'aceite_textual'), '') ELSE aceite_textual END,
    aceite_detectado_textualmente = CASE
      WHEN NOT (p_campos ? 'aceite_textual') THEN aceite_detectado_textualmente
      WHEN nullif(btrim(p_campos->>'aceite_textual'), '') IS NULL THEN 'INDETERMINADO'
      WHEN lower(p_campos->>'aceite_textual') LIKE '%nao%'
        OR lower(p_campos->>'aceite_textual') LIKE '%não%'
        OR lower(p_campos->>'aceite_textual') LIKE '%sem %' THEN 'NAO'
      ELSE 'SIM'
    END,
    status_validacao = 'REVISAR',
    metodo_extracao = 'MANUAL',
    resultado_confronto = p_resultado_confronto,
    validado_por = NULL,
    validado_em = NULL,
    motivo_rejeicao = NULL
  WHERE id = v_old.id RETURNING * INTO v_new;

  SELECT coalesce(p.nome_completo, p.email, 'Usuario') INTO v_actor_name FROM public.profiles p WHERE p.id = v_user_id;
  INSERT INTO public.eventos_dominio (
    tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
    tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
    ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
    origem_evento, origem_registro_id
  ) VALUES (
    v_new.fundo_id, v_new.fundo_id, v_new.cedente_id, v_new.cedente_fundo_id, v_new.nota_fiscal_id,
    'duplicata_corrigida', 'analise', v_user_id, v_actor_name, v_role,
    'app', 'Campos da duplicata foram corrigidos manualmente.',
    jsonb_build_object('duplicata_id', v_new.id, 'campos', (SELECT jsonb_agg(key) FROM jsonb_each(p_campos))),
    'ambos', 'duplicatas', v_new.id::text || ':' || extract(epoch FROM clock_timestamp())::text
  );
  RETURN v_new;
END;
$$;

CREATE OR REPLACE FUNCTION public.validar_duplicata(
  p_duplicata_id uuid,
  p_resultado text,
  p_observacoes text,
  p_resultado_confronto jsonb
)
RETURNS public.duplicatas
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_role text := (SELECT public.get_user_role());
  v_row public.duplicatas%ROWTYPE;
  v_actor_name text;
  v_validation_id uuid;
BEGIN
  IF v_user_id IS NULL OR v_role <> 'gestor' THEN RAISE EXCEPTION 'Apenas gestor pode concluir a validacao'; END IF;
  IF p_resultado NOT IN ('VALIDADA', 'REJEITADA') THEN RAISE EXCEPTION 'Resultado de validacao invalido'; END IF;
  IF p_resultado = 'REJEITADA' AND length(btrim(coalesce(p_observacoes, ''))) = 0 THEN
    RAISE EXCEPTION 'Informe o motivo da rejeicao';
  END IF;
  SELECT * INTO v_row FROM public.duplicatas d WHERE d.id = p_duplicata_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Duplicata nao encontrada'; END IF;
  IF NOT (SELECT private.usuario_tem_acesso_fundo(v_row.fundo_id)) THEN RAISE EXCEPTION 'Gestor sem acesso ao fundo'; END IF;
  IF v_row.versao_atual_id IS NULL THEN RAISE EXCEPTION 'Duplicata sem versao documental'; END IF;
  IF p_resultado = 'VALIDADA' AND (
    v_row.numero IS NULL
    OR v_row.data_vencimento IS NULL
    OR v_row.valor_nominal IS NULL
    OR v_row.cnpj_cedente_documento IS NULL
    OR v_row.cnpj_sacado_documento IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM public.notas_fiscais nf
      WHERE nf.id = v_row.nota_fiscal_id
        AND regexp_replace(nf.cnpj_emitente, '[^0-9]', '', 'g') = v_row.cnpj_cedente_documento
        AND regexp_replace(nf.cnpj_destinatario, '[^0-9]', '', 'g') = v_row.cnpj_sacado_documento
    )
  ) THEN
    RAISE EXCEPTION 'Duplicata possui campos criticos ausentes ou partes divergentes da NF';
  END IF;

  INSERT INTO public.duplicata_validacoes (
    duplicata_id, duplicata_versao_id, resultado, observacoes,
    resultado_confronto, validado_por
  ) VALUES (
    v_row.id, v_row.versao_atual_id, p_resultado, nullif(btrim(p_observacoes), ''),
    coalesce(p_resultado_confronto, '{}'::jsonb), v_user_id
  ) RETURNING id INTO v_validation_id;

  UPDATE public.duplicatas SET
    status_validacao = p_resultado,
    validado_por = v_user_id,
    validado_em = now(),
    motivo_rejeicao = CASE WHEN p_resultado = 'REJEITADA' THEN btrim(p_observacoes) ELSE NULL END
  WHERE id = v_row.id RETURNING * INTO v_row;

  SELECT coalesce(p.nome_completo, p.email, 'Usuario') INTO v_actor_name FROM public.profiles p WHERE p.id = v_user_id;
  INSERT INTO public.eventos_dominio (
    tenant_id, fundo_id, cedente_id, cedente_fundo_id, nota_fiscal_id,
    tipo_evento, categoria, ator_usuario_id, ator_nome_snapshot,
    ator_perfil_snapshot, origem, descricao, metadata, visibilidade,
    origem_evento, origem_registro_id
  ) VALUES (
    v_row.fundo_id, v_row.fundo_id, v_row.cedente_id, v_row.cedente_fundo_id, v_row.nota_fiscal_id,
    CASE WHEN p_resultado = 'VALIDADA' THEN 'duplicata_validada' ELSE 'duplicata_rejeitada' END,
    CASE WHEN p_resultado = 'VALIDADA' THEN 'aprovacao' ELSE 'reprovacao' END,
    v_user_id, v_actor_name, v_role, 'app',
    CASE WHEN p_resultado = 'VALIDADA' THEN 'Duplicata validada pelo gestor.' ELSE 'Duplicata rejeitada pelo gestor.' END,
    jsonb_build_object('duplicata_id', v_row.id, 'resultado', p_resultado),
    'ambos', 'duplicata_validacoes', v_validation_id::text
  );
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_duplicata_versao(uuid, uuid, text, text, text, date, date, numeric, text, text, text, text, text, text, text, text, text, text, text, text, text, text, bigint, text, text, jsonb, jsonb, jsonb, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_duplicata_versao(uuid, uuid, text, text, text, date, date, numeric, text, text, text, text, text, text, text, text, text, text, text, text, text, text, bigint, text, text, jsonb, jsonb, jsonb, numeric) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.corrigir_duplicata(uuid, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corrigir_duplicata(uuid, jsonb, text, text) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.validar_duplicata(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validar_duplicata(uuid, text, text, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION private.duplicata_append_only() FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE public.duplicatas IS 'Titulos de Duplicata Mercantil vinculados a uma NF. Valor nominal nao representa preco de aquisicao.';
COMMENT ON TABLE public.duplicata_versoes IS 'Versoes imutaveis do PDF e da extracao automatica; texto extraido limitado e protegido por RLS.';
COMMENT ON TABLE public.duplicata_correcoes IS 'Trilha append-only das correcoes humanas por campo e versao.';
COMMENT ON TABLE public.duplicata_validacoes IS 'Decisoes finais append-only do gestor para cada titulo.';
