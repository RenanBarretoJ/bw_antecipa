BEGIN;

-- P2.2.1: generaliza a fonte de verdade SA3 sem criar uma plataforma paralela.
ALTER TABLE public.integracoes_fundo
  DROP CONSTRAINT IF EXISTS integracoes_fundo_provedor_check,
  DROP CONSTRAINT IF EXISTS integracoes_fundo_unique;

DROP INDEX IF EXISTS public.uq_integracoes_fundo_ativa_provedor;

ALTER TABLE public.integracoes_fundo
  ADD COLUMN IF NOT EXISTS provider_key text,
  ADD COLUMN IF NOT EXISTS system_name text;

ALTER TABLE public.integracao_fundo_versoes
  ADD COLUMN IF NOT EXISTS adapter_key text;

UPDATE public.integracoes_fundo
SET provider_key = CASE
      WHEN lower(provedor) IN ('fromtis', 'sinqia') THEN 'SINQIA'
      ELSE upper(regexp_replace(provedor, '[^a-zA-Z0-9_]+', '_', 'g'))
    END,
    system_name = CASE
      WHEN lower(provedor) IN ('fromtis', 'sinqia') THEN 'Portal FIDC'
      ELSE nome
    END
WHERE provider_key IS NULL OR system_name IS NULL;

UPDATE public.integracao_fundo_versoes v
SET adapter_key = 'sinqia_portal_fidc'
FROM public.integracoes_fundo i
WHERE i.id = v.integracao_fundo_id
  AND i.provider_key = 'SINQIA'
  AND i.system_name = 'Portal FIDC'
  AND v.adapter_key IS NULL;

ALTER TABLE public.integracoes_fundo
  ALTER COLUMN provider_key SET NOT NULL,
  ALTER COLUMN system_name SET NOT NULL,
  ADD CONSTRAINT integracoes_fundo_provider_key_check
    CHECK (provider_key ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  ADD CONSTRAINT integracoes_fundo_system_name_check
    CHECK (length(trim(system_name)) BETWEEN 2 AND 160);

ALTER TABLE public.integracao_fundo_versoes
  ADD CONSTRAINT integracao_fundo_versoes_adapter_key_check
    CHECK (adapter_key IS NULL OR adapter_key ~ '^[a-z][a-z0-9_]{1,79}$');

-- Espelho defensivo do registry server-side. A funcao nao modela provider ou
-- produto: apenas impede que uma chamada direta da RPC publique um adapter
-- que o runtime ainda nao sabe executar.
CREATE OR REPLACE FUNCTION private.integracao_adapter_capability_suportada(
  p_adapter_key text,
  p_capability text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT CASE p_adapter_key
    WHEN 'sinqia_portal_fidc' THEN p_capability = 'CESSAO_ENVIO'
    ELSE false
  END
$$;

REVOKE ALL ON FUNCTION private.integracao_adapter_capability_suportada(text, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validar_integracao_fundo_versao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.remessas_cnab r WHERE r.integracao_fundo_versao_id = OLD.id) THEN
      RAISE EXCEPTION 'Versao de integracao utilizada por remessa nao pode ser excluida';
    END IF;
    IF OLD.status = 'publicada' THEN
      RAISE EXCEPTION 'Versao publicada de integracao nao pode ser excluida; cancele ou substitua';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'publicada' AND (
    NEW.integracao_fundo_id IS DISTINCT FROM OLD.integracao_fundo_id
    OR NEW.versao IS DISTINCT FROM OLD.versao
    OR NEW.ambiente IS DISTINCT FROM OLD.ambiente
    OR NEW.identificador_cliente IS DISTINCT FROM OLD.identificador_cliente
    OR NEW.codigo_originador IS DISTINCT FROM OLD.codigo_originador
    OR NEW.endpoint_base IS DISTINCT FROM OLD.endpoint_base
    OR NEW.configuracao_nao_sensivel IS DISTINCT FROM OLD.configuracao_nao_sensivel
    OR NEW.credential_ref IS DISTINCT FROM OLD.credential_ref
    OR NEW.secret_name IS DISTINCT FROM OLD.secret_name
    OR NEW.vault_key IS DISTINCT FROM OLD.vault_key
    OR NEW.adapter_key IS DISTINCT FROM OLD.adapter_key
    OR NEW.publicada_por IS DISTINCT FROM OLD.publicada_por
    OR NEW.publicada_em IS DISTINCT FROM OLD.publicada_em
  ) THEN
    RAISE EXCEPTION 'Campos de versao publicada de integracao sao imutaveis';
  END IF;

  IF NEW.status = 'publicada' THEN
    IF NEW.publicada_por IS NULL OR NEW.publicada_em IS NULL THEN
      RAISE EXCEPTION 'Versao publicada de integracao exige publicada_por e publicada_em';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.integracao_fundo_versoes other
      WHERE other.integracao_fundo_id = NEW.integracao_fundo_id
        AND other.id <> NEW.id
        AND other.status = 'publicada'
        AND tstzrange(other.vigente_desde, COALESCE(other.vigente_ate, 'infinity'::timestamptz), '[)')
          && tstzrange(NEW.vigente_desde, COALESCE(NEW.vigente_ate, 'infinity'::timestamptz), '[)')
    ) THEN
      RAISE EXCEPTION 'Versoes publicadas de uma integracao nao podem sobrepor vigencia';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_integracoes_fundo_identidade
  ON public.integracoes_fundo (fundo_id, provider_key, system_name, created_at DESC);

CREATE TABLE public.integracao_fundo_versao_capacidades (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  integracao_fundo_versao_id uuid NOT NULL
    REFERENCES public.integracao_fundo_versoes(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  ambiente text NOT NULL,
  capability text NOT NULL,
  disponivel_desde timestamptz,
  disponivel_ate timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT integracao_versao_capacidades_unique
    UNIQUE (integracao_fundo_versao_id, capability),
  CONSTRAINT integracao_versao_capacidades_capability_check
    CHECK (capability IN ('CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES', 'CARTEIRA')),
  CONSTRAINT integracao_versao_capacidades_ambiente_check
    CHECK (ambiente IN ('homologacao', 'producao')),
  CONSTRAINT integracao_versao_capacidades_vigencia_check
    CHECK (
      (disponivel_desde IS NULL AND disponivel_ate IS NULL)
      OR (disponivel_desde IS NOT NULL AND (disponivel_ate IS NULL OR disponivel_ate >= disponivel_desde))
    )
);

CREATE UNIQUE INDEX uq_integracao_capability_fonte_ativa
  ON public.integracao_fundo_versao_capacidades (fundo_id, ambiente, capability)
  WHERE disponivel_desde IS NOT NULL AND disponivel_ate IS NULL;

CREATE INDEX idx_integracao_capacidades_versao
  ON public.integracao_fundo_versao_capacidades (integracao_fundo_versao_id, capability);

CREATE INDEX idx_integracao_capacidades_historico
  ON public.integracao_fundo_versao_capacidades
  (fundo_id, ambiente, capability, disponivel_desde DESC);

CREATE OR REPLACE FUNCTION public.validar_integracao_fundo_versao_capacidade()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_versao public.integracao_fundo_versoes%ROWTYPE;
  v_fundo_id uuid;
BEGIN
  SELECT v.*
    INTO v_versao
    FROM public.integracao_fundo_versoes v
   WHERE v.id = COALESCE(NEW.integracao_fundo_versao_id, OLD.integracao_fundo_versao_id);

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Versao da integracao nao encontrada para capability' USING ERRCODE = '23503';
  END IF;

  SELECT i.fundo_id INTO v_fundo_id
  FROM public.integracoes_fundo i
  WHERE i.id = v_versao.integracao_fundo_id;

  IF TG_OP = 'INSERT' THEN
    IF v_versao.status <> 'rascunho' AND NEW.disponivel_desde IS NULL THEN
      RAISE EXCEPTION 'Capabilities somente podem ser adicionadas em versao rascunho' USING ERRCODE = '23514';
    END IF;
    IF NEW.fundo_id <> v_fundo_id OR NEW.ambiente <> v_versao.ambiente THEN
      RAISE EXCEPTION 'Capability incompatível com fundo ou ambiente da versao' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_versao.status <> 'rascunho' THEN
      RAISE EXCEPTION 'Capabilities de versao publicada sao imutaveis' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.integracao_fundo_versao_id IS DISTINCT FROM OLD.integracao_fundo_versao_id
     OR NEW.fundo_id IS DISTINCT FROM OLD.fundo_id
     OR NEW.ambiente IS DISTINCT FROM OLD.ambiente
     OR NEW.capability IS DISTINCT FROM OLD.capability
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Identidade da capability versionada e imutavel' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER integracao_fundo_versao_capacidades_validacao
  BEFORE INSERT OR UPDATE OR DELETE ON public.integracao_fundo_versao_capacidades
  FOR EACH ROW EXECUTE FUNCTION public.validar_integracao_fundo_versao_capacidade();

-- Backfill apenas da capacidade comprovadamente executada pelo runtime legado.
INSERT INTO public.integracao_fundo_versao_capacidades (
  integracao_fundo_versao_id, fundo_id, ambiente, capability,
  disponivel_desde, disponivel_ate
)
SELECT
  v.id,
  i.fundo_id,
  v.ambiente,
  'CESSAO_ENVIO',
  CASE WHEN v.status IN ('publicada', 'substituida', 'desativada') THEN v.vigente_desde ELSE NULL END,
  CASE WHEN v.status = 'publicada' AND v.vigente_ate IS NULL THEN NULL ELSE v.vigente_ate END
FROM public.integracao_fundo_versoes v
JOIN public.integracoes_fundo i ON i.id = v.integracao_fundo_id
WHERE i.provider_key = 'SINQIA'
  AND i.system_name = 'Portal FIDC'
  AND v.status IN ('publicada', 'substituida', 'desativada')
ON CONFLICT (integracao_fundo_versao_id, capability) DO NOTHING;

ALTER TABLE public.rlx_importacoes_financeiras
  ADD COLUMN IF NOT EXISTS integracao_fundo_versao_id uuid
    REFERENCES public.integracao_fundo_versoes(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS idx_rlx_importacoes_integracao_versao
  ON public.rlx_importacoes_financeiras (integracao_fundo_versao_id)
  WHERE integracao_fundo_versao_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validar_linhagem_integracao_rlx()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.integracao_fundo_versao_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.origem <> 'CRON' THEN
    RAISE EXCEPTION 'Somente importacao automatica pode registrar versao de integracao' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.integracao_fundo_versoes v
      JOIN public.integracoes_fundo i ON i.id = v.integracao_fundo_id
      JOIN public.integracao_fundo_versao_capacidades c
        ON c.integracao_fundo_versao_id = v.id
     WHERE v.id = NEW.integracao_fundo_versao_id
       AND i.fundo_id = NEW.fundo_id
       AND c.capability = NEW.tipo_base
  ) THEN
    RAISE EXCEPTION 'Versao de integracao nao fornece a capability financeira informada' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rlx_importacoes_linhagem_integracao_validacao
  BEFORE INSERT OR UPDATE OF integracao_fundo_versao_id, fundo_id, tipo_base, origem
  ON public.rlx_importacoes_financeiras
  FOR EACH ROW EXECUTE FUNCTION public.validar_linhagem_integracao_rlx();

CREATE OR REPLACE FUNCTION public.resolver_integracao_por_capability(
  p_fundo_id uuid,
  p_ambiente text,
  p_capability text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_resultado jsonb;
  v_fundo_ativo boolean;
BEGIN
  IF p_ambiente NOT IN ('homologacao', 'producao')
     OR p_capability NOT IN ('CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES', 'CARTEIRA') THEN
    RAISE EXCEPTION 'Ambiente ou capability invalida' USING ERRCODE = '22023';
  END IF;
  SELECT f.ativo INTO v_fundo_ativo FROM public.fundos f WHERE f.id = p_fundo_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'NAO_CONFIGURADA', 'motivo', 'FUNDO_NAO_ENCONTRADO');
  END IF;
  IF NOT v_fundo_ativo THEN
    RETURN jsonb_build_object('status', 'INDISPONIVEL', 'motivo', 'FUNDO_INATIVO');
  END IF;

  SELECT jsonb_build_object(
    'status', CASE
      WHEN v.credencial_integracao_id IS NOT NULL AND (cr.id IS NULL OR cr.status <> 'ativa')
        THEN 'INDISPONIVEL'
      ELSE 'CONFIGURADA'
    END,
    'motivo', CASE
      WHEN v.credencial_integracao_id IS NOT NULL AND (cr.id IS NULL OR cr.status <> 'ativa')
        THEN 'CREDENCIAL_INDISPONIVEL'
      ELSE NULL
    END,
    'fundo_id', i.fundo_id,
    'integracao_fundo_id', i.id,
    'integracao_fundo_versao_id', v.id,
    'provider_key', i.provider_key,
    'system_name', i.system_name,
    'adapter_key', v.adapter_key,
    'ambiente', v.ambiente,
    'capability', c.capability,
    'versao', v.versao,
    'endpoint_base', v.endpoint_base,
    'identificador_cliente', v.identificador_cliente,
    'codigo_originador', v.codigo_originador,
    'configuracao_nao_sensivel', v.configuracao_nao_sensivel,
    'credential_ref', v.credential_ref,
    'credencial_integracao_id', v.credencial_integracao_id
  ) INTO v_resultado
  FROM public.integracao_fundo_versao_capacidades c
  JOIN public.integracao_fundo_versoes v ON v.id = c.integracao_fundo_versao_id
  JOIN public.integracoes_fundo i ON i.id = v.integracao_fundo_id
  LEFT JOIN public.credenciais_integracao cr ON cr.id = v.credencial_integracao_id
  WHERE c.fundo_id = p_fundo_id
    AND c.ambiente = p_ambiente
    AND c.capability = p_capability
    AND c.disponivel_desde IS NOT NULL
    AND c.disponivel_desde <= clock_timestamp()
    AND c.disponivel_ate IS NULL
    AND v.status = 'publicada'
    AND v.vigente_ate IS NULL
    AND i.status = 'ativa';

  RETURN COALESCE(v_resultado, jsonb_build_object('status', 'NAO_CONFIGURADA', 'motivo', 'CAPABILITY_SEM_FONTE'));
END;
$$;

REVOKE ALL ON FUNCTION public.resolver_integracao_por_capability(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolver_integracao_por_capability(uuid, text, text)
  TO service_role;

-- Leitura administrativa sanitizada com identidade e capabilities por versao.
CREATE OR REPLACE FUNCTION public.admin_obter_configuracoes_tecnicas_fundo(
  p_fundo_id uuid,
  p_execucoes_limite integer DEFAULT 20,
  p_execucoes_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_resultado jsonb;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN
    RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = p_fundo_id) THEN
    RAISE EXCEPTION 'Fundo nao encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF p_execucoes_limite < 1 OR p_execucoes_limite > 100 OR p_execucoes_offset < 0 THEN
    RAISE EXCEPTION 'Limite de execucoes invalido' USING ERRCODE = '22023';
  END IF;

  SELECT jsonb_build_object(
    'fundo', jsonb_build_object('id', f.id, 'nome', f.nome, 'cnpj', f.cnpj, 'ativo', f.ativo),
    'integracoes', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'provedor', i.provedor, 'provider_key', i.provider_key,
        'system_name', i.system_name, 'nome', i.nome, 'status', i.status,
        'created_at', i.created_at, 'updated_at', i.updated_at,
        'versoes', COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'id', v.id, 'versao', v.versao, 'ambiente', v.ambiente,
            'status', v.status, 'adapter_key', v.adapter_key,
            'identificador_cliente', v.identificador_cliente,
            'codigo_originador', v.codigo_originador, 'endpoint_base', v.endpoint_base,
            'configuracao_nao_sensivel', v.configuracao_nao_sensivel,
            'credencial_integracao_id', v.credencial_integracao_id,
            'vigente_desde', v.vigente_desde, 'vigente_ate', v.vigente_ate,
            'publicada_em', v.publicada_em, 'created_at', v.created_at,
            'updated_at', v.updated_at,
            'capabilities', COALESCE((
              SELECT jsonb_agg(c.capability ORDER BY c.capability)
              FROM public.integracao_fundo_versao_capacidades c
              WHERE c.integracao_fundo_versao_id = v.id
            ), '[]'::jsonb),
            'active_capabilities', COALESCE((
              SELECT jsonb_agg(c.capability ORDER BY c.capability)
              FROM public.integracao_fundo_versao_capacidades c
              WHERE c.integracao_fundo_versao_id = v.id
                AND c.disponivel_desde IS NOT NULL
                AND c.disponivel_ate IS NULL
            ), '[]'::jsonb)
          ) ORDER BY v.versao DESC)
          FROM public.integracao_fundo_versoes v
          WHERE v.integracao_fundo_id = i.id
        ), '[]'::jsonb)
      ) ORDER BY i.created_at DESC)
      FROM public.integracoes_fundo i WHERE i.fundo_id = f.id
    ), '[]'::jsonb),
    'credenciais', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'integracao_fundo_id', c.integracao_fundo_id,
        'ambiente', c.ambiente, 'nome', c.nome, 'status', c.status,
        'chave_versao', c.chave_versao, 'criada_em', c.criada_em,
        'ativada_em', c.ativada_em, 'revogada_em', c.revogada_em,
        'substituida_por', c.substituida_por, 'ultimo_uso_em', c.ultimo_uso_em,
        'usuario_mascarado', c.metadados ->> 'usuario_mascarado',
        'created_at', c.created_at, 'updated_at', c.updated_at
      ) ORDER BY c.created_at DESC)
      FROM public.credenciais_integracao c WHERE c.fundo_id = f.id
    ), '[]'::jsonb),
    'cnab', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'descricao', c.descricao,
        'finalidade', c.finalidade, 'status', c.status,
        'created_at', c.created_at, 'updated_at', c.updated_at,
        'versoes', COALESCE((
          SELECT jsonb_agg(to_jsonb(v) ORDER BY v.versao DESC)
          FROM public.configuracao_cnab_versoes v
          WHERE v.configuracao_cnab_id = c.id
        ), '[]'::jsonb)
      ) ORDER BY c.created_at DESC)
      FROM public.configuracoes_cnab c WHERE c.fundo_id = f.id
    ), '[]'::jsonb),
    'execucoes_total', (SELECT count(*) FROM public.integracao_execucoes x WHERE x.fundo_id = f.id),
    'execucoes', COALESCE((
      SELECT jsonb_agg(to_jsonb(e) ORDER BY e.iniciada_em DESC, e.id DESC)
      FROM (
        SELECT x.id, x.integracao_fundo_versao_id, x.tipo_execucao, x.ambiente,
               x.status, x.tentativa, x.codigo_resposta, x.mensagem_resumida,
               x.erro_categoria, x.duracao_ms, x.iniciada_em, x.finalizada_em
          FROM public.integracao_execucoes x
         WHERE x.fundo_id = f.id
         ORDER BY x.iniciada_em DESC, x.id DESC
         LIMIT p_execucoes_limite OFFSET p_execucoes_offset
      ) e
    ), '[]'::jsonb)
  ) INTO v_resultado
  FROM public.fundos f WHERE f.id = p_fundo_id;
  RETURN v_resultado;
END;
$$;

DROP FUNCTION IF EXISTS public.admin_cadastrar_credencial_integracao(
  uuid, text, text, text, text, text, text, uuid, uuid
);

CREATE FUNCTION public.admin_cadastrar_credencial_integracao(
  p_fundo_id uuid,
  p_integracao_fundo_id uuid,
  p_ambiente text,
  p_nome text,
  p_usuario_criptografado text,
  p_senha_criptografada text,
  p_chave_versao text,
  p_usuario_mascarado text,
  p_credencial_anterior_id uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
  v_evento text := CASE WHEN p_credencial_anterior_id IS NULL THEN 'CREDENCIAL_CRIADA' ELSE 'CREDENCIAL_ROTACIONADA' END;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  IF p_ambiente NOT IN ('homologacao', 'producao') OR length(trim(COALESCE(p_nome, ''))) < 2 THEN
    RAISE EXCEPTION 'Dados da credencial invalidos' USING ERRCODE = '22023';
  END IF;
  IF p_usuario_criptografado !~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
     OR p_senha_criptografada !~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'Formato criptografico invalido' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.integracoes_fundo i
    WHERE i.id = p_integracao_fundo_id AND i.fundo_id = p_fundo_id
  ) THEN
    RAISE EXCEPTION 'Integracao nao encontrada neste fundo' USING ERRCODE = 'P0002';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(p_integracao_fundo_id::text), hashtext('credencial:' || p_ambiente));
  IF p_credencial_anterior_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.credenciais_integracao c
    WHERE c.id = p_credencial_anterior_id
      AND c.fundo_id = p_fundo_id
      AND c.integracao_fundo_id = p_integracao_fundo_id
      AND c.ambiente = p_ambiente
  ) THEN
    RAISE EXCEPTION 'Credencial anterior nao encontrada no fundo, integracao e ambiente informados' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.credenciais_integracao (
    fundo_id, integracao_fundo_id, ambiente, nome,
    usuario_criptografado, senha_criptografada, chave_versao,
    status, criada_por, metadados
  ) VALUES (
    p_fundo_id, p_integracao_fundo_id, p_ambiente, trim(p_nome),
    p_usuario_criptografado, p_senha_criptografada, trim(p_chave_versao),
    'rascunho', (SELECT auth.uid()), jsonb_build_object('usuario_mascarado', p_usuario_mascarado)
  ) RETURNING id INTO v_id;

  PERFORM private.sa3_auditar(v_evento, p_fundo_id, 'credenciais_integracao', v_id, NULL,
    jsonb_build_object('integracao_fundo_id', p_integracao_fundo_id, 'ambiente', p_ambiente,
      'status', 'rascunho', 'credencial_anterior_id', p_credencial_anterior_id,
      'chave_versao', p_chave_versao), p_correlation_id);
  RETURN jsonb_build_object('id', v_id, 'integracao_id', p_integracao_fundo_id);
END;
$$;

DROP FUNCTION IF EXISTS public.admin_salvar_integracao_rascunho(
  uuid, uuid, text, text, text, uuid, jsonb, timestamptz, uuid
);

CREATE FUNCTION public.admin_salvar_integracao_rascunho(
  p_fundo_id uuid,
  p_integracao_fundo_id uuid,
  p_versao_id uuid,
  p_provider_key text,
  p_system_name text,
  p_adapter_key text,
  p_capabilities text[],
  p_ambiente text,
  p_endpoint_base text,
  p_identificador_cliente text,
  p_credencial_integracao_id uuid,
  p_configuracao_nao_sensivel jsonb DEFAULT '{}'::jsonb,
  p_updated_at_esperado timestamptz DEFAULT NULL,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_integracao_id uuid := p_integracao_fundo_id;
  v_codigo_originador text;
  v_numero integer;
  v_id uuid;
  v_updated_at timestamptz;
  v_endpoint text := trim(COALESCE(p_endpoint_base, ''));
  v_identificador text := trim(COALESCE(p_identificador_cliente, ''));
  v_provider text := upper(trim(COALESCE(p_provider_key, '')));
  v_system text := trim(COALESCE(p_system_name, ''));
  v_adapter text := NULLIF(lower(trim(COALESCE(p_adapter_key, ''))), '');
  v_capability text;
  v_capabilities text[];
  v_credential_ref text := COALESCE('credencial:' || p_credencial_integracao_id::text, 'nao_configurada');
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  IF p_ambiente NOT IN ('homologacao', 'producao')
     OR v_provider !~ '^[A-Z][A-Z0-9_]{1,63}$'
     OR length(v_system) NOT BETWEEN 2 AND 160
     OR (v_adapter IS NOT NULL AND v_adapter !~ '^[a-z][a-z0-9_]{1,79}$') THEN
    RAISE EXCEPTION 'Identidade ou ambiente da integracao invalido' USING ERRCODE = '22023';
  END IF;
  IF v_endpoint <> '' AND v_endpoint !~ '^https?://[^[:space:]]+$' THEN RAISE EXCEPTION 'Endpoint informado no rascunho e invalido' USING ERRCODE = '22023'; END IF;
  IF jsonb_typeof(COALESCE(p_configuracao_nao_sensivel, '{}'::jsonb)) <> 'object' THEN RAISE EXCEPTION 'Configuracao nao sensivel deve ser objeto JSON' USING ERRCODE = '22023'; END IF;

  SELECT COALESCE(array_agg(DISTINCT upper(trim(x)) ORDER BY upper(trim(x))), ARRAY[]::text[])
    INTO v_capabilities
    FROM unnest(COALESCE(p_capabilities, ARRAY[]::text[])) x;
  FOREACH v_capability IN ARRAY v_capabilities LOOP
    IF v_capability NOT IN ('CESSAO_ENVIO', 'ESTOQUE', 'AQUISICOES', 'LIQUIDACOES', 'CARTEIRA') THEN
      RAISE EXCEPTION 'Capability invalida: %', v_capability USING ERRCODE = '22023';
    END IF;
  END LOOP;

  PERFORM pg_catalog.pg_advisory_xact_lock(hashtext(p_fundo_id::text), hashtext('integracoes_tecnicas'));
  IF v_integracao_id IS NULL THEN
    INSERT INTO public.integracoes_fundo (
      fundo_id, provedor, provider_key, system_name, nome, status, created_by
    ) VALUES (
      p_fundo_id, lower(v_provider), v_provider, v_system, v_system, 'rascunho', (SELECT auth.uid())
    ) RETURNING id INTO v_integracao_id;
    PERFORM private.sa3_auditar('INTEGRACAO_CRIADA', p_fundo_id, 'integracoes_fundo', v_integracao_id,
      NULL, jsonb_build_object('provider_key', v_provider, 'system_name', v_system), p_correlation_id);
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.integracoes_fundo i
      WHERE i.id = v_integracao_id AND i.fundo_id = p_fundo_id
    ) THEN RAISE EXCEPTION 'Integracao nao encontrada neste fundo' USING ERRCODE = 'P0002'; END IF;
    IF EXISTS (
      SELECT 1 FROM public.integracao_fundo_versoes v
      WHERE v.integracao_fundo_id = v_integracao_id AND v.status IN ('publicada', 'substituida', 'desativada')
    ) AND EXISTS (
      SELECT 1 FROM public.integracoes_fundo i
      WHERE i.id = v_integracao_id
        AND (i.provider_key <> v_provider OR i.system_name <> v_system)
    ) THEN
      RAISE EXCEPTION 'Provider e sistema de uma integracao publicada sao imutaveis' USING ERRCODE = '23514';
    END IF;
    UPDATE public.integracoes_fundo
       SET provider_key = v_provider, system_name = v_system,
           provedor = lower(v_provider), nome = v_system
     WHERE id = v_integracao_id;
  END IF;

  IF p_credencial_integracao_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.credenciais_integracao c
    WHERE c.id = p_credencial_integracao_id
      AND c.fundo_id = p_fundo_id
      AND c.integracao_fundo_id = v_integracao_id
      AND c.ambiente = p_ambiente
      AND c.status = 'ativa'
  ) THEN RAISE EXCEPTION 'Credencial ativa compativel nao encontrada' USING ERRCODE = '23514'; END IF;

  SELECT v.codigo_originador INTO v_codigo_originador
  FROM public.configuracao_cnab_versoes v
  JOIN public.configuracoes_cnab c ON c.id = v.configuracao_cnab_id
  WHERE c.fundo_id = p_fundo_id AND c.status = 'ativa'
    AND v.status = 'publicada' AND v.vigente_ate IS NULL
  ORDER BY v.versao DESC LIMIT 1;

  IF p_versao_id IS NULL THEN
    SELECT COALESCE(max(v.versao), 0) + 1 INTO v_numero
    FROM public.integracao_fundo_versoes v WHERE v.integracao_fundo_id = v_integracao_id;
    INSERT INTO public.integracao_fundo_versoes (
      integracao_fundo_id, versao, ambiente, status, identificador_cliente,
      codigo_originador, endpoint_base, configuracao_nao_sensivel,
      credential_ref, credencial_integracao_id, adapter_key, vigente_desde
    ) VALUES (
      v_integracao_id, v_numero, p_ambiente, 'rascunho', v_identificador,
      v_codigo_originador, v_endpoint, COALESCE(p_configuracao_nao_sensivel, '{}'::jsonb),
      v_credential_ref, p_credencial_integracao_id, v_adapter, clock_timestamp()
    ) RETURNING id, updated_at INTO v_id, v_updated_at;
  ELSE
    UPDATE public.integracao_fundo_versoes v
       SET ambiente = p_ambiente, identificador_cliente = v_identificador,
           codigo_originador = v_codigo_originador, endpoint_base = v_endpoint,
           configuracao_nao_sensivel = COALESCE(p_configuracao_nao_sensivel, '{}'::jsonb),
           credential_ref = v_credential_ref, credencial_integracao_id = p_credencial_integracao_id,
           adapter_key = v_adapter, secret_name = NULL, vault_key = NULL
     WHERE v.id = p_versao_id AND v.integracao_fundo_id = v_integracao_id
       AND v.status = 'rascunho'
       AND (p_updated_at_esperado IS NULL OR v.updated_at = p_updated_at_esperado)
     RETURNING v.id, v.versao, v.updated_at INTO v_id, v_numero, v_updated_at;
    IF v_id IS NULL THEN RAISE EXCEPTION 'Rascunho alterado por outro usuario ou indisponivel' USING ERRCODE = '40001'; END IF;
    DELETE FROM public.integracao_fundo_versao_capacidades c
    WHERE c.integracao_fundo_versao_id = v_id;
  END IF;

  INSERT INTO public.integracao_fundo_versao_capacidades (
    integracao_fundo_versao_id, fundo_id, ambiente, capability
  ) SELECT v_id, p_fundo_id, p_ambiente, x FROM unnest(v_capabilities) x;

  PERFORM private.sa3_auditar(
    CASE WHEN p_versao_id IS NULL THEN 'INTEGRACAO_VERSAO_CRIADA' ELSE 'INTEGRACAO_RASCUNHO_ATUALIZADO' END,
    p_fundo_id, 'integracao_fundo_versoes', v_id, NULL,
    jsonb_build_object('versao', v_numero, 'ambiente', p_ambiente, 'adapter_key', v_adapter,
      'credencial_integracao_id', p_credencial_integracao_id, 'endpoint_base', v_endpoint,
      'capabilities', to_jsonb(v_capabilities)), p_correlation_id);
  PERFORM private.sa3_auditar('INTEGRACAO_CAPABILITIES_ATUALIZADAS', p_fundo_id,
    'integracao_fundo_versoes', v_id, NULL,
    jsonb_build_object('capabilities', to_jsonb(v_capabilities)), p_correlation_id);

  RETURN jsonb_build_object('id', v_id, 'integracao_id', v_integracao_id,
    'versao', v_numero, 'updated_at', v_updated_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_publicar_integracao_versao(
  p_fundo_id uuid,
  p_versao_id uuid,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_versao public.integracao_fundo_versoes%ROWTYPE;
  v_integracao public.integracoes_fundo%ROWTYPE;
  v_agora timestamptz := clock_timestamp();
  v_capability text;
  v_substituida record;
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  SELECT i.* INTO v_integracao
  FROM public.integracoes_fundo i
  JOIN public.integracao_fundo_versoes v ON v.integracao_fundo_id = i.id
  WHERE v.id = p_versao_id AND i.fundo_id = p_fundo_id FOR UPDATE OF i;
  IF NOT FOUND THEN RAISE EXCEPTION 'Versao de integracao nao encontrada' USING ERRCODE = 'P0002'; END IF;
  SELECT * INTO v_versao FROM public.integracao_fundo_versoes v WHERE v.id = p_versao_id FOR UPDATE;
  IF v_versao.status = 'publicada' THEN RETURN jsonb_build_object('id', v_versao.id, 'status', 'publicada', 'idempotente', true); END IF;
  IF v_versao.status <> 'rascunho' THEN RAISE EXCEPTION 'Somente rascunho pode ser publicado' USING ERRCODE = '23514'; END IF;
  IF v_versao.adapter_key IS NULL THEN RAISE EXCEPTION 'Adapter nao implementado para esta integracao' USING ERRCODE = '23514'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.integracao_fundo_versao_capacidades c WHERE c.integracao_fundo_versao_id = p_versao_id) THEN
    RAISE EXCEPTION 'Selecione ao menos uma capability antes de publicar' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.integracao_fundo_versao_capacidades c
    WHERE c.integracao_fundo_versao_id = p_versao_id
      AND NOT private.integracao_adapter_capability_suportada(v_versao.adapter_key, c.capability)
  ) THEN
    RAISE EXCEPTION 'Adapter nao implementado para todas as capabilities selecionadas' USING ERRCODE = '23514';
  END IF;
  IF v_versao.adapter_key = 'sinqia_portal_fidc' THEN
    IF NULLIF(trim(v_versao.endpoint_base), '') IS NULL OR v_versao.endpoint_base !~ '^https://[^[:space:]]+$' THEN
      RAISE EXCEPTION 'Informe o endpoint HTTPS antes de publicar' USING ERRCODE = '23514';
    END IF;
    IF v_versao.credencial_integracao_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.credenciais_integracao c
      WHERE c.id = v_versao.credencial_integracao_id AND c.fundo_id = p_fundo_id
        AND c.integracao_fundo_id = v_integracao.id AND c.ambiente = v_versao.ambiente
        AND c.status = 'ativa'
    ) THEN RAISE EXCEPTION 'Selecione uma credencial ativa antes de publicar' USING ERRCODE = '23514'; END IF;
  END IF;

  FOR v_capability IN
    SELECT c.capability FROM public.integracao_fundo_versao_capacidades c
    WHERE c.integracao_fundo_versao_id = p_versao_id ORDER BY c.capability
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      hashtextextended(p_fundo_id::text || ':' || v_versao.ambiente || ':' || v_capability, 0)
    );
  END LOOP;

  -- A nova versao substitui integralmente a anterior da mesma integracao.
  UPDATE public.integracao_fundo_versao_capacidades c SET disponivel_ate = v_agora
  FROM public.integracao_fundo_versoes old_v
  WHERE old_v.id = c.integracao_fundo_versao_id
    AND old_v.integracao_fundo_id = v_integracao.id
    AND old_v.status = 'publicada' AND old_v.id <> p_versao_id
    AND c.disponivel_desde IS NOT NULL AND c.disponivel_ate IS NULL;

  UPDATE public.integracao_fundo_versoes
  SET status = 'substituida', vigente_ate = v_agora
  WHERE integracao_fundo_id = v_integracao.id
    AND status = 'publicada' AND vigente_ate IS NULL AND id <> p_versao_id;

  -- Transfere somente as capabilities selecionadas de outras integracoes.
  FOR v_substituida IN
    SELECT c.id, c.capability, c.integracao_fundo_versao_id
    FROM public.integracao_fundo_versao_capacidades c
    WHERE c.fundo_id = p_fundo_id AND c.ambiente = v_versao.ambiente
      AND c.capability IN (
        SELECT n.capability FROM public.integracao_fundo_versao_capacidades n
        WHERE n.integracao_fundo_versao_id = p_versao_id
      )
      AND c.integracao_fundo_versao_id <> p_versao_id
      AND c.disponivel_desde IS NOT NULL AND c.disponivel_ate IS NULL
    FOR UPDATE
  LOOP
    UPDATE public.integracao_fundo_versao_capacidades
    SET disponivel_ate = v_agora WHERE id = v_substituida.id;
    PERFORM private.sa3_auditar('CAPABILITY_FONTE_SUBSTITUIDA', p_fundo_id,
      'integracao_fundo_versoes', p_versao_id,
      jsonb_build_object('capability', v_substituida.capability,
        'integracao_fundo_versao_id', v_substituida.integracao_fundo_versao_id),
      jsonb_build_object('capability', v_substituida.capability,
        'integracao_fundo_versao_id', p_versao_id), p_correlation_id);
  END LOOP;

  UPDATE public.integracao_fundo_versao_capacidades
  SET disponivel_desde = v_agora, disponivel_ate = NULL
  WHERE integracao_fundo_versao_id = p_versao_id;

  UPDATE public.integracao_fundo_versoes
  SET status = 'publicada', vigente_desde = v_agora, vigente_ate = NULL,
      publicada_por = (SELECT auth.uid()), publicada_em = v_agora
  WHERE id = p_versao_id;
  UPDATE public.integracoes_fundo SET status = 'ativa' WHERE id = v_integracao.id;

  -- Uma versao de outra integracao sem capabilities restantes deixa de ser vigente.
  UPDATE public.integracao_fundo_versoes ov
  SET status = 'substituida', vigente_ate = v_agora
  WHERE ov.id <> p_versao_id AND ov.status = 'publicada' AND ov.vigente_ate IS NULL
    AND ov.integracao_fundo_id IN (SELECT i.id FROM public.integracoes_fundo i WHERE i.fundo_id = p_fundo_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.integracao_fundo_versao_capacidades c
      WHERE c.integracao_fundo_versao_id = ov.id
        AND c.disponivel_desde IS NOT NULL AND c.disponivel_ate IS NULL
    );

  UPDATE public.integracoes_fundo i SET status = 'desativada'
  WHERE i.fundo_id = p_fundo_id AND i.id <> v_integracao.id
    AND NOT EXISTS (
      SELECT 1 FROM public.integracao_fundo_versoes v
      JOIN public.integracao_fundo_versao_capacidades c ON c.integracao_fundo_versao_id = v.id
      WHERE v.integracao_fundo_id = i.id AND v.status = 'publicada'
        AND c.disponivel_desde IS NOT NULL AND c.disponivel_ate IS NULL
    );

  PERFORM private.sa3_auditar('INTEGRACAO_PUBLICADA', p_fundo_id,
    'integracao_fundo_versoes', p_versao_id,
    jsonb_build_object('status', v_versao.status),
    jsonb_build_object('status', 'publicada', 'versao', v_versao.versao,
      'adapter_key', v_versao.adapter_key,
      'capabilities', (SELECT jsonb_agg(c.capability ORDER BY c.capability)
        FROM public.integracao_fundo_versao_capacidades c
        WHERE c.integracao_fundo_versao_id = p_versao_id)), p_correlation_id);
  RETURN jsonb_build_object('id', p_versao_id, 'status', 'publicada', 'versao', v_versao.versao);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_desativar_integracao_versao(
  p_fundo_id uuid,
  p_versao_id uuid,
  p_correlation_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_versao public.integracao_fundo_versoes%ROWTYPE;
  v_integracao_id uuid;
  v_agora timestamptz := clock_timestamp();
BEGIN
  IF NOT (SELECT private.usuario_e_super_admin()) THEN RAISE EXCEPTION 'Acesso administrativo negado' USING ERRCODE = '42501'; END IF;
  SELECT v.* INTO v_versao
  FROM public.integracao_fundo_versoes v
  JOIN public.integracoes_fundo i ON i.id = v.integracao_fundo_id
  WHERE v.id = p_versao_id AND i.fundo_id = p_fundo_id FOR UPDATE OF v;
  IF NOT FOUND THEN RAISE EXCEPTION 'Versao de integracao nao encontrada' USING ERRCODE = 'P0002'; END IF;
  v_integracao_id := v_versao.integracao_fundo_id;
  IF v_versao.status = 'desativada' THEN RETURN jsonb_build_object('id', p_versao_id, 'status', 'desativada', 'idempotente', true); END IF;
  IF v_versao.status <> 'publicada' THEN RAISE EXCEPTION 'Somente versao publicada pode ser desativada' USING ERRCODE = '23514'; END IF;

  UPDATE public.integracao_fundo_versao_capacidades
  SET disponivel_ate = v_agora
  WHERE integracao_fundo_versao_id = p_versao_id
    AND disponivel_desde IS NOT NULL AND disponivel_ate IS NULL;
  UPDATE public.integracao_fundo_versoes
  SET status = 'desativada', vigente_ate = v_agora WHERE id = p_versao_id;
  UPDATE public.integracoes_fundo SET status = 'desativada' WHERE id = v_integracao_id;
  PERFORM private.sa3_auditar('INTEGRACAO_DESATIVADA', p_fundo_id,
    'integracao_fundo_versoes', p_versao_id,
    jsonb_build_object('status', v_versao.status),
    jsonb_build_object('status', 'desativada'), p_correlation_id);
  RETURN jsonb_build_object('id', p_versao_id, 'status', 'desativada');
END;
$$;

ALTER TABLE public.integracao_fundo_versao_capacidades ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.integracao_fundo_versao_capacidades FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.integracao_fundo_versao_capacidades TO service_role;

REVOKE ALL ON FUNCTION public.admin_cadastrar_credencial_integracao(
  uuid, uuid, text, text, text, text, text, text, uuid, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_cadastrar_credencial_integracao(
  uuid, uuid, text, text, text, text, text, text, uuid, uuid
) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_salvar_integracao_rascunho(
  uuid, uuid, uuid, text, text, text, text[], text, text, text, uuid, jsonb, timestamptz, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_salvar_integracao_rascunho(
  uuid, uuid, uuid, text, text, text, text[], text, text, text, uuid, jsonb, timestamptz, uuid
) TO authenticated, service_role;

COMMENT ON TABLE public.integracao_fundo_versao_capacidades IS
  'Capabilities versionadas e historicas das integracoes tecnicas. Uma fonte ativa por fundo, ambiente e capability.';
COMMENT ON COLUMN public.rlx_importacoes_financeiras.integracao_fundo_versao_id IS
  'Versao tecnica que produziu a importacao automatica; nula para MANUAL e GOLDEN_DATASET.';

COMMIT;
