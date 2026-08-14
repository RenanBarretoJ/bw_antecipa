-- P2.2 - camada de ingestao financeira versionada e auditavel da RLX.
-- A migration cria uma fronteira tecnica entre arquivos externos, staging e
-- bases canonicas publicadas. Nenhum dado de conciliacao ou decisao de credito
-- e produzido nesta fase.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.fundos') IS NULL
     OR to_regclass('public.usuario_fundos') IS NULL
     OR to_regclass('public.plataforma_auditoria') IS NULL
     OR to_regprocedure('private.usuario_e_super_admin()') IS NULL THEN
    RAISE EXCEPTION 'P2.2 depende das migrations multifundo e SA0-SA3.';
  END IF;
END;
$$;

CREATE TABLE public.rlx_importacoes_financeiras (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  provedor text NOT NULL,
  tipo_base text NOT NULL CHECK (tipo_base IN ('CARTEIRA', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES')),
  data_referencia date NOT NULL,
  versao_layout text NOT NULL,
  status text NOT NULL DEFAULT 'RECEBIDA'
    CHECK (status IN ('RECEBIDA', 'VALIDANDO', 'VALIDA', 'PUBLICADA', 'FALHA', 'RETIFICADA', 'CANCELADA')),
  completude text NOT NULL DEFAULT 'INCOMPLETO'
    CHECK (completude IN ('COMPLETO_COM_DADOS', 'COMPLETO_VAZIO', 'INCOMPLETO')),
  origem text NOT NULL DEFAULT 'MANUAL'
    CHECK (origem IN ('MANUAL', 'CRON', 'GOLDEN_DATASET')),
  hash_conteudo text NOT NULL CHECK (hash_conteudo ~ '^[0-9a-f]{64}$'),
  nome_arquivo text NOT NULL,
  mime_type text NOT NULL,
  tamanho_bytes bigint NOT NULL CHECK (tamanho_bytes >= 0 AND tamanho_bytes <= 20971520),
  storage_bucket text NOT NULL DEFAULT 'financeiro-importacoes',
  storage_path text NOT NULL,
  linhas_total integer NOT NULL DEFAULT 0 CHECK (linhas_total >= 0),
  linhas_validas integer NOT NULL DEFAULT 0 CHECK (linhas_validas >= 0),
  linhas_invalidas integer NOT NULL DEFAULT 0 CHECK (linhas_invalidas >= 0),
  linhas_warning integer NOT NULL DEFAULT 0 CHECK (linhas_warning >= 0),
  valor_total numeric(20,4),
  erros jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(erros) = 'array'),
  metadados jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadados) = 'object'),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  criado_por uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  recebida_em timestamptz NOT NULL DEFAULT now(),
  validacao_iniciada_em timestamptz,
  validacao_concluida_em timestamptz,
  publicada_em timestamptz,
  substituida_em timestamptz,
  cancelada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rlx_importacoes_contagem_check CHECK (
    linhas_validas + linhas_invalidas <= linhas_total
  ),
  CONSTRAINT rlx_importacoes_vazio_check CHECK (
    completude <> 'COMPLETO_VAZIO' OR linhas_total = 0
  ),
  CONSTRAINT rlx_importacoes_publicacao_check CHECK (
    status NOT IN ('PUBLICADA', 'RETIFICADA') OR publicada_em IS NOT NULL
  ),
  CONSTRAINT rlx_importacoes_hash_unique UNIQUE (fundo_id, tipo_base, data_referencia, hash_conteudo)
);

CREATE TABLE public.rlx_importacao_arquivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id uuid NOT NULL REFERENCES public.rlx_importacoes_financeiras(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  ordem integer NOT NULL DEFAULT 1 CHECK (ordem > 0),
  nome_arquivo text NOT NULL,
  mime_type text NOT NULL,
  tamanho_bytes bigint NOT NULL CHECK (tamanho_bytes >= 0 AND tamanho_bytes <= 20971520),
  hash_conteudo text NOT NULL CHECK (hash_conteudo ~ '^[0-9a-f]{64}$'),
  storage_bucket text NOT NULL DEFAULT 'financeiro-importacoes',
  storage_path text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rlx_importacao_arquivos_ordem_unique UNIQUE (importacao_id, ordem),
  CONSTRAINT rlx_importacao_arquivos_path_unique UNIQUE (storage_bucket, storage_path)
);

CREATE TABLE public.rlx_importacao_linhas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id uuid NOT NULL REFERENCES public.rlx_importacoes_financeiras(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  numero_linha integer NOT NULL CHECK (numero_linha > 1),
  status text NOT NULL CHECK (status IN ('VALIDA', 'INVALIDA', 'WARNING')),
  dados_brutos jsonb NOT NULL CHECK (jsonb_typeof(dados_brutos) = 'object'),
  dados_normalizados jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(dados_normalizados) = 'object'),
  erros jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(erros) = 'array'),
  avisos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(avisos) = 'array'),
  criada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rlx_importacao_linhas_numero_unique UNIQUE (importacao_id, numero_linha)
);

CREATE TABLE public.rlx_estoque_posicoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id uuid NOT NULL REFERENCES public.rlx_importacoes_financeiras(id) ON DELETE RESTRICT,
  linha_id uuid NOT NULL REFERENCES public.rlx_importacao_linhas(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  provedor text NOT NULL,
  data_referencia date NOT NULL,
  id_recebivel text NOT NULL,
  seu_numero text,
  numero_documento text,
  tipo_recebivel text,
  chave_nfe text,
  cedente_nome text,
  cedente_documento text,
  sacado_nome text,
  sacado_documento text,
  valor_nominal numeric(20,4) NOT NULL,
  valor_presente numeric(20,4),
  valor_aquisicao numeric(20,4),
  valor_pdd numeric(20,4),
  data_emissao date,
  data_vencimento_original date,
  data_aquisicao date,
  situacao_recebivel text,
  vigente boolean NOT NULL DEFAULT true,
  publicada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rlx_estoque_linha_unique UNIQUE (importacao_id, linha_id)
);

CREATE TABLE public.rlx_aquisicao_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id uuid NOT NULL REFERENCES public.rlx_importacoes_financeiras(id) ON DELETE RESTRICT,
  linha_id uuid NOT NULL REFERENCES public.rlx_importacao_linhas(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  provedor text NOT NULL,
  data_referencia date NOT NULL,
  id_recebivel text NOT NULL,
  seu_numero text,
  numero_documento text,
  cedente_documento text,
  sacado_documento text,
  tipo_recebivel text,
  chave_nfe text,
  valor_compra numeric(20,4) NOT NULL,
  valor_vencimento numeric(20,4),
  data_movimento date NOT NULL,
  data_vencimento date,
  codigo_movimento text,
  vigente boolean NOT NULL DEFAULT true,
  publicada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rlx_aquisicoes_linha_unique UNIQUE (importacao_id, linha_id)
);

CREATE TABLE public.rlx_liquidacao_movimentos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id uuid NOT NULL REFERENCES public.rlx_importacoes_financeiras(id) ON DELETE RESTRICT,
  linha_id uuid NOT NULL REFERENCES public.rlx_importacao_linhas(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  provedor text NOT NULL,
  data_referencia date NOT NULL,
  id_recebivel text NOT NULL,
  seu_numero text,
  numero_documento text,
  cedente_documento text,
  sacado_documento text,
  tipo_recebivel text,
  id_tipo_movimento text,
  tipo_movimento text,
  status_recebivel text,
  data_movimento date NOT NULL,
  data_aquisicao date,
  data_vencimento date,
  valor_aquisicao numeric(20,4),
  valor_pago numeric(20,4) NOT NULL,
  valor_nominal numeric(20,4),
  juros numeric(20,4),
  vigente boolean NOT NULL DEFAULT true,
  publicada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rlx_liquidacoes_linha_unique UNIQUE (importacao_id, linha_id)
);

CREATE TABLE public.rlx_carteira_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  importacao_id uuid NOT NULL REFERENCES public.rlx_importacoes_financeiras(id) ON DELETE RESTRICT,
  linha_id uuid NOT NULL REFERENCES public.rlx_importacao_linhas(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  provedor text NOT NULL,
  data_referencia date NOT NULL,
  fundo_externo text,
  documento_fundo text,
  versao_externa text,
  patrimonio_liquido numeric(20,4) NOT NULL,
  publicada_externamente_em timestamptz,
  vigente boolean NOT NULL DEFAULT true,
  publicada_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rlx_carteira_linha_unique UNIQUE (importacao_id, linha_id)
);

CREATE TABLE public.rlx_importacao_ciclos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  data_operacional date NOT NULL,
  origem text NOT NULL CHECK (origem IN ('CRON', 'MANUAL', 'GOLDEN_DATASET')),
  status text NOT NULL CHECK (status IN ('INICIADO', 'CONCLUIDO', 'PARCIAL', 'FALHA')),
  tentativas integer NOT NULL DEFAULT 1 CHECK (tentativas > 0),
  processadas integer NOT NULL DEFAULT 0 CHECK (processadas >= 0),
  falhas integer NOT NULL DEFAULT 0 CHECK (falhas >= 0),
  detalhes jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  iniciada_em timestamptz NOT NULL DEFAULT now(),
  concluida_em timestamptz,
  CONSTRAINT rlx_importacao_ciclos_lock_unique UNIQUE (fundo_id, data_operacional, origem)
);

CREATE INDEX rlx_importacoes_fundo_tipo_data_idx
  ON public.rlx_importacoes_financeiras (fundo_id, tipo_base, data_referencia DESC, recebida_em DESC);
CREATE INDEX rlx_importacoes_status_idx
  ON public.rlx_importacoes_financeiras (status, data_referencia DESC);
CREATE INDEX rlx_importacao_linhas_status_idx
  ON public.rlx_importacao_linhas (importacao_id, status, numero_linha);
CREATE INDEX rlx_estoque_atual_idx
  ON public.rlx_estoque_posicoes (fundo_id, data_referencia DESC, id_recebivel) WHERE vigente;
CREATE INDEX rlx_aquisicoes_atual_idx
  ON public.rlx_aquisicao_movimentos (fundo_id, data_referencia DESC, id_recebivel) WHERE vigente;
CREATE INDEX rlx_liquidacoes_atual_idx
  ON public.rlx_liquidacao_movimentos (fundo_id, data_referencia DESC, id_recebivel) WHERE vigente;
CREATE INDEX rlx_carteira_atual_idx
  ON public.rlx_carteira_snapshots (fundo_id, data_referencia DESC) WHERE vigente;

CREATE TRIGGER rlx_importacoes_updated_at
  BEFORE UPDATE ON public.rlx_importacoes_financeiras
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION private.rlx_chamada_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT auth.jwt() ->> 'role'), '') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION private.rlx_autorizar_tecnico()
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT private.rlx_chamada_service_role() AND NOT private.usuario_e_super_admin() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Acesso tecnico nao autorizado';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION private.rlx_auditar(
  p_tipo_evento text,
  p_importacao_id uuid,
  p_fundo_id uuid,
  p_correlation_id uuid,
  p_dados jsonb
)
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
  INSERT INTO public.plataforma_auditoria (
    tipo_evento, ator_usuario_id, origem, correlation_id, dados
  ) VALUES (
    p_tipo_evento,
    (SELECT auth.uid()),
    'rlx_ingestao_financeira',
    COALESCE(p_correlation_id, gen_random_uuid()),
    jsonb_build_object(
      'importacao_id', p_importacao_id,
      'fundo_id', p_fundo_id
    ) || COALESCE(p_dados, '{}'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.publicar_importacao_financeira(
  p_importacao_id uuid,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_importacao public.rlx_importacoes_financeiras%ROWTYPE;
  v_anterior_ids uuid[];
  v_inseridas integer := 0;
  v_agora timestamptz := clock_timestamp();
BEGIN
  PERFORM private.rlx_autorizar_tecnico();

  SELECT * INTO v_importacao
    FROM public.rlx_importacoes_financeiras
   WHERE id = p_importacao_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Importacao financeira nao encontrada';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    v_importacao.fundo_id::text || ':' || v_importacao.tipo_base || ':' || v_importacao.data_referencia::text,
    0
  ));

  IF v_importacao.status = 'PUBLICADA' THEN
    RETURN jsonb_build_object('id', v_importacao.id, 'status', 'PUBLICADA', 'idempotente', true);
  END IF;

  IF v_importacao.status <> 'VALIDA' OR v_importacao.completude = 'INCOMPLETO' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Somente importacao valida e completa pode ser publicada';
  END IF;

  IF v_importacao.linhas_invalidas > 0 OR EXISTS (
    SELECT 1 FROM public.rlx_importacao_linhas l
     WHERE l.importacao_id = v_importacao.id AND l.status = 'INVALIDA'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Importacao possui linhas invalidas';
  END IF;

  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_anterior_ids
    FROM public.rlx_importacoes_financeiras
   WHERE fundo_id = v_importacao.fundo_id
     AND tipo_base = v_importacao.tipo_base
     AND data_referencia = v_importacao.data_referencia
     AND status = 'PUBLICADA'
     AND id <> v_importacao.id;

  IF cardinality(v_anterior_ids) > 0 THEN
    UPDATE public.rlx_importacoes_financeiras
       SET status = 'RETIFICADA', substituida_em = v_agora
     WHERE id = ANY(v_anterior_ids);
    UPDATE public.rlx_estoque_posicoes SET vigente = false WHERE importacao_id = ANY(v_anterior_ids);
    UPDATE public.rlx_aquisicao_movimentos SET vigente = false WHERE importacao_id = ANY(v_anterior_ids);
    UPDATE public.rlx_liquidacao_movimentos SET vigente = false WHERE importacao_id = ANY(v_anterior_ids);
    UPDATE public.rlx_carteira_snapshots SET vigente = false WHERE importacao_id = ANY(v_anterior_ids);
  END IF;

  IF v_importacao.completude = 'COMPLETO_COM_DADOS' THEN
    IF v_importacao.tipo_base = 'ESTOQUE' THEN
      INSERT INTO public.rlx_estoque_posicoes (
        importacao_id, linha_id, fundo_id, provedor, data_referencia, id_recebivel,
        seu_numero, numero_documento, tipo_recebivel, chave_nfe, cedente_nome,
        cedente_documento, sacado_nome, sacado_documento, valor_nominal,
        valor_presente, valor_aquisicao, valor_pdd, data_emissao,
        data_vencimento_original, data_aquisicao, situacao_recebivel, publicada_em
      )
      SELECT v_importacao.id, l.id, v_importacao.fundo_id, v_importacao.provedor,
        v_importacao.data_referencia, l.dados_normalizados->>'id_recebivel',
        l.dados_normalizados->>'seu_numero', l.dados_normalizados->>'numero_documento',
        l.dados_normalizados->>'tipo_recebivel', l.dados_normalizados->>'chave_nfe',
        l.dados_normalizados->>'cedente_nome', l.dados_normalizados->>'cedente_documento',
        l.dados_normalizados->>'sacado_nome', l.dados_normalizados->>'sacado_documento',
        (l.dados_normalizados->>'valor_nominal')::numeric,
        nullif(l.dados_normalizados->>'valor_presente', '')::numeric,
        nullif(l.dados_normalizados->>'valor_aquisicao', '')::numeric,
        nullif(l.dados_normalizados->>'valor_pdd', '')::numeric,
        nullif(l.dados_normalizados->>'data_emissao', '')::date,
        nullif(l.dados_normalizados->>'data_vencimento_original', '')::date,
        nullif(l.dados_normalizados->>'data_aquisicao', '')::date,
        l.dados_normalizados->>'situacao_recebivel', v_agora
      FROM public.rlx_importacao_linhas l
      WHERE l.importacao_id = v_importacao.id AND l.status IN ('VALIDA', 'WARNING');
    ELSIF v_importacao.tipo_base = 'AQUISICOES' THEN
      INSERT INTO public.rlx_aquisicao_movimentos (
        importacao_id, linha_id, fundo_id, provedor, data_referencia, id_recebivel,
        seu_numero, numero_documento, cedente_documento, sacado_documento,
        tipo_recebivel, chave_nfe, valor_compra, valor_vencimento,
        data_movimento, data_vencimento, codigo_movimento, publicada_em
      )
      SELECT v_importacao.id, l.id, v_importacao.fundo_id, v_importacao.provedor,
        v_importacao.data_referencia, l.dados_normalizados->>'id_recebivel',
        l.dados_normalizados->>'seu_numero', l.dados_normalizados->>'numero_documento',
        l.dados_normalizados->>'cedente_documento', l.dados_normalizados->>'sacado_documento',
        l.dados_normalizados->>'tipo_recebivel', l.dados_normalizados->>'chave_nfe',
        (l.dados_normalizados->>'valor_compra')::numeric,
        nullif(l.dados_normalizados->>'valor_vencimento', '')::numeric,
        (l.dados_normalizados->>'data_movimento')::date,
        nullif(l.dados_normalizados->>'data_vencimento', '')::date,
        l.dados_normalizados->>'codigo_movimento', v_agora
      FROM public.rlx_importacao_linhas l
      WHERE l.importacao_id = v_importacao.id AND l.status IN ('VALIDA', 'WARNING');
    ELSIF v_importacao.tipo_base = 'LIQUIDACOES' THEN
      INSERT INTO public.rlx_liquidacao_movimentos (
        importacao_id, linha_id, fundo_id, provedor, data_referencia, id_recebivel,
        seu_numero, numero_documento, cedente_documento, sacado_documento,
        tipo_recebivel, id_tipo_movimento, tipo_movimento, status_recebivel,
        data_movimento, data_aquisicao, data_vencimento, valor_aquisicao,
        valor_pago, valor_nominal, juros, publicada_em
      )
      SELECT v_importacao.id, l.id, v_importacao.fundo_id, v_importacao.provedor,
        v_importacao.data_referencia, l.dados_normalizados->>'id_recebivel',
        l.dados_normalizados->>'seu_numero', l.dados_normalizados->>'numero_documento',
        l.dados_normalizados->>'cedente_documento', l.dados_normalizados->>'sacado_documento',
        l.dados_normalizados->>'tipo_recebivel', l.dados_normalizados->>'id_tipo_movimento',
        l.dados_normalizados->>'tipo_movimento', l.dados_normalizados->>'status_recebivel',
        (l.dados_normalizados->>'data_movimento')::date,
        nullif(l.dados_normalizados->>'data_aquisicao', '')::date,
        nullif(l.dados_normalizados->>'data_vencimento', '')::date,
        nullif(l.dados_normalizados->>'valor_aquisicao', '')::numeric,
        (l.dados_normalizados->>'valor_pago')::numeric,
        nullif(l.dados_normalizados->>'valor_nominal', '')::numeric,
        nullif(l.dados_normalizados->>'juros', '')::numeric, v_agora
      FROM public.rlx_importacao_linhas l
      WHERE l.importacao_id = v_importacao.id AND l.status IN ('VALIDA', 'WARNING');
    ELSE
      INSERT INTO public.rlx_carteira_snapshots (
        importacao_id, linha_id, fundo_id, provedor, data_referencia, fundo_externo,
        documento_fundo, versao_externa, patrimonio_liquido,
        publicada_externamente_em, publicada_em
      )
      SELECT v_importacao.id, l.id, v_importacao.fundo_id, v_importacao.provedor,
        v_importacao.data_referencia, l.dados_normalizados->>'fundo_externo',
        l.dados_normalizados->>'documento_fundo', l.dados_normalizados->>'versao_externa',
        (l.dados_normalizados->>'patrimonio_liquido')::numeric,
        nullif(l.dados_normalizados->>'publicada_externamente_em', '')::timestamptz,
        v_agora
      FROM public.rlx_importacao_linhas l
      WHERE l.importacao_id = v_importacao.id AND l.status IN ('VALIDA', 'WARNING');
    END IF;
    GET DIAGNOSTICS v_inseridas = ROW_COUNT;
  END IF;

  UPDATE public.rlx_importacoes_financeiras
     SET status = 'PUBLICADA', publicada_em = v_agora, substituida_em = NULL
   WHERE id = v_importacao.id;

  PERFORM private.rlx_auditar(
    'RLX_IMPORTACAO_FINANCEIRA_PUBLICADA', v_importacao.id, v_importacao.fundo_id,
    COALESCE(p_correlation_id, v_importacao.correlation_id),
    jsonb_build_object(
      'tipo_base', v_importacao.tipo_base,
      'data_referencia', v_importacao.data_referencia,
      'completude', v_importacao.completude,
      'linhas_publicadas', v_inseridas,
      'substituiu_importacoes', to_jsonb(v_anterior_ids)
    )
  );

  RETURN jsonb_build_object(
    'id', v_importacao.id,
    'status', 'PUBLICADA',
    'linhas_publicadas', v_inseridas,
    'retificou', cardinality(v_anterior_ids) > 0
  );
END;
$$;

CREATE VIEW public.rlx_estoque_atual
WITH (security_invoker = true)
AS SELECT * FROM public.rlx_estoque_posicoes WHERE vigente;

CREATE VIEW public.rlx_aquisicoes_atuais
WITH (security_invoker = true)
AS SELECT * FROM public.rlx_aquisicao_movimentos WHERE vigente;

CREATE VIEW public.rlx_liquidacoes_atuais
WITH (security_invoker = true)
AS SELECT * FROM public.rlx_liquidacao_movimentos WHERE vigente;

CREATE VIEW public.rlx_carteira_atual
WITH (security_invoker = true)
AS SELECT * FROM public.rlx_carteira_snapshots WHERE vigente;

ALTER TABLE public.rlx_importacoes_financeiras ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rlx_importacao_arquivos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rlx_importacao_linhas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rlx_estoque_posicoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rlx_aquisicao_movimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rlx_liquidacao_movimentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rlx_carteira_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rlx_importacao_ciclos ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION private.rlx_gestor_tem_acesso_fundo(p_fundo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.usuario_fundos uf
    JOIN public.fundos f ON f.id = uf.fundo_id
    WHERE uf.usuario_id = auth.uid()
      AND uf.fundo_id = p_fundo_id
      AND uf.status = 'ativo'
      AND uf.perfil_no_fundo = 'gestor'
      AND f.ativo
  );
$$;

REVOKE ALL ON FUNCTION private.rlx_gestor_tem_acesso_fundo(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.rlx_gestor_tem_acesso_fundo(uuid) TO authenticated, service_role;

CREATE POLICY rlx_importacoes_super_admin_select ON public.rlx_importacoes_financeiras
  FOR SELECT TO authenticated USING (private.usuario_e_super_admin());
CREATE POLICY rlx_arquivos_super_admin_select ON public.rlx_importacao_arquivos
  FOR SELECT TO authenticated USING (private.usuario_e_super_admin());
CREATE POLICY rlx_linhas_super_admin_select ON public.rlx_importacao_linhas
  FOR SELECT TO authenticated USING (private.usuario_e_super_admin());
CREATE POLICY rlx_ciclos_super_admin_select ON public.rlx_importacao_ciclos
  FOR SELECT TO authenticated USING (private.usuario_e_super_admin());

CREATE POLICY rlx_estoque_gestor_fundo_select ON public.rlx_estoque_posicoes
  FOR SELECT TO authenticated USING (private.rlx_gestor_tem_acesso_fundo(fundo_id));
CREATE POLICY rlx_aquisicoes_gestor_fundo_select ON public.rlx_aquisicao_movimentos
  FOR SELECT TO authenticated USING (private.rlx_gestor_tem_acesso_fundo(fundo_id));
CREATE POLICY rlx_liquidacoes_gestor_fundo_select ON public.rlx_liquidacao_movimentos
  FOR SELECT TO authenticated USING (private.rlx_gestor_tem_acesso_fundo(fundo_id));
CREATE POLICY rlx_carteira_gestor_fundo_select ON public.rlx_carteira_snapshots
  FOR SELECT TO authenticated USING (private.rlx_gestor_tem_acesso_fundo(fundo_id));

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('financeiro-importacoes', 'financeiro-importacoes', false, 20971520, ARRAY['text/csv', 'text/plain'])
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

CREATE POLICY financeiro_importacoes_super_admin_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'financeiro-importacoes' AND private.usuario_e_super_admin());

REVOKE ALL ON TABLE
  public.rlx_importacoes_financeiras,
  public.rlx_importacao_arquivos,
  public.rlx_importacao_linhas,
  public.rlx_estoque_posicoes,
  public.rlx_aquisicao_movimentos,
  public.rlx_liquidacao_movimentos,
  public.rlx_carteira_snapshots,
  public.rlx_importacao_ciclos
FROM anon, authenticated;

GRANT SELECT ON TABLE
  public.rlx_importacoes_financeiras,
  public.rlx_importacao_arquivos,
  public.rlx_importacao_linhas,
  public.rlx_importacao_ciclos,
  public.rlx_estoque_posicoes,
  public.rlx_aquisicao_movimentos,
  public.rlx_liquidacao_movimentos,
  public.rlx_carteira_snapshots,
  public.rlx_estoque_atual,
  public.rlx_aquisicoes_atuais,
  public.rlx_liquidacoes_atuais,
  public.rlx_carteira_atual
TO authenticated;

REVOKE ALL ON FUNCTION private.rlx_chamada_service_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.rlx_autorizar_tecnico() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.rlx_auditar(text, uuid, uuid, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publicar_importacao_financeira(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.publicar_importacao_financeira(uuid, uuid) TO authenticated, service_role;

ALTER TABLE public.autorizacoes_acoes_sensiveis
  DROP CONSTRAINT IF EXISTS autorizacoes_acoes_sensiveis_action_check;
ALTER TABLE public.autorizacoes_acoes_sensiveis
  ADD CONSTRAINT autorizacoes_acoes_sensiveis_action_check CHECK (
    action_type = ANY (ARRAY[
      'alterar_senha', 'alterar_email', 'regenerar_recovery_codes',
      'encerrar_outras_sessoes', 'reset_mfa_administrativo',
      'cadastrar_credencial_integracao', 'rotacionar_credencial_integracao',
      'ativar_credencial_integracao', 'revogar_credencial_integracao',
      'criar_fundo', 'atualizar_fundo_estrutural', 'ativar_fundo', 'desativar_fundo',
      'convidar_usuario_admin', 'vincular_gestor_fundo', 'revogar_gestor_fundo',
      'reativar_gestor_fundo', 'desativar_usuario', 'reativar_usuario',
      'conceder_super_admin', 'revogar_super_admin', 'criar_integracao_versao',
      'publicar_integracao', 'desativar_integracao', 'testar_integracao',
      'atualizar_cnab', 'atualizar_codigo_originador', 'publicar_base_financeira'
    ])
  );

CREATE OR REPLACE FUNCTION public.criar_autorizacao_acao_sensivel(
  p_action_type text,
  p_nonce_hash text
)
RETURNS TABLE (expira_em timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_agora timestamptz := clock_timestamp();
BEGIN
  BEGIN
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessao Supabase invalida';
  END;

  IF p_action_type IS NULL OR p_action_type NOT IN (
    'alterar_senha', 'alterar_email', 'regenerar_recovery_codes',
    'encerrar_outras_sessoes', 'reset_mfa_administrativo',
    'cadastrar_credencial_integracao', 'rotacionar_credencial_integracao',
    'ativar_credencial_integracao', 'revogar_credencial_integracao',
    'criar_fundo', 'atualizar_fundo_estrutural', 'ativar_fundo', 'desativar_fundo',
    'convidar_usuario_admin', 'vincular_gestor_fundo', 'revogar_gestor_fundo',
    'reativar_gestor_fundo', 'desativar_usuario', 'reativar_usuario',
    'conceder_super_admin', 'revogar_super_admin', 'criar_integracao_versao',
    'publicar_integracao', 'desativar_integracao', 'testar_integracao',
    'atualizar_cnab', 'atualizar_codigo_originador', 'publicar_base_financeira'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Tipo de acao sensivel invalido';
  END IF;

  IF p_nonce_hash IS NULL OR p_nonce_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Nonce invalido';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.obter_sessao_mfa_atual() estado
     WHERE estado.status = 'valid' AND estado.session_id = v_session_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessao MFA de 24 horas invalida';
  END IF;

  INSERT INTO public.autorizacoes_acoes_sensiveis (
    user_id, session_id, action_type, nonce_hash, criada_em, expira_em
  ) VALUES (
    v_user_id, v_session_id, p_action_type, p_nonce_hash, v_agora, v_agora + interval '5 minutes'
  );

  RETURN QUERY SELECT v_agora + interval '5 minutes';
END;
$$;

REVOKE ALL ON FUNCTION public.criar_autorizacao_acao_sensivel(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.criar_autorizacao_acao_sensivel(text, text) TO authenticated;

COMMIT;
