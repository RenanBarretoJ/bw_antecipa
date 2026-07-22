-- Fase 8: Integracao Portal FIDC por fundo.
-- Mantem o valor tecnico de provedor "fromtis" para compatibilidade com a modelagem da Fase 7.
-- A nomenclatura de negocio nas interfaces passa a ser Portal FIDC / Portal FIDC - Sinqia.

DO $$
BEGIN
  IF to_regclass('public.fundos') IS NULL
    OR to_regclass('public.integracoes_fundo') IS NULL
    OR to_regclass('public.integracao_fundo_versoes') IS NULL
    OR to_regclass('public.remessas_cnab') IS NULL
    OR to_regclass('public.remessas_cnab_operacoes') IS NULL
    OR to_regclass('public.operacoes') IS NULL THEN
    RAISE EXCEPTION 'Fase 8 depende das tabelas da Fase 7 e de operacoes.';
  END IF;
END;
$$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('retornos-integracao', 'retornos-integracao', false, 10485760, NULL)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.integracao_fundo_versoes
  DROP CONSTRAINT IF EXISTS integracao_fundo_versoes_status_check;

ALTER TABLE public.integracao_fundo_versoes
  ADD CONSTRAINT integracao_fundo_versoes_status_check
  CHECK (status IN ('rascunho', 'publicada', 'substituida', 'cancelada', 'desativada'));

CREATE TABLE IF NOT EXISTS public.integracao_execucoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  integracao_fundo_versao_id uuid NOT NULL REFERENCES public.integracao_fundo_versoes(id) ON DELETE RESTRICT,
  remessa_cnab_id uuid REFERENCES public.remessas_cnab(id) ON DELETE RESTRICT,
  operacao_id uuid REFERENCES public.operacoes(id) ON DELETE RESTRICT,
  tipo_execucao text NOT NULL,
  ambiente text NOT NULL,
  status text NOT NULL DEFAULT 'iniciada',
  tentativa integer NOT NULL DEFAULT 1,
  idempotency_key text,
  request_hash text,
  protocolo_externo text,
  codigo_resposta text,
  mensagem_resumida text,
  erro_categoria text,
  duracao_ms integer,
  iniciada_em timestamptz NOT NULL DEFAULT now(),
  finalizada_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT integracao_execucoes_tipo_check CHECK (tipo_execucao IN ('teste_conexao', 'envio_remessa', 'consulta_status', 'download_retorno')),
  CONSTRAINT integracao_execucoes_ambiente_check CHECK (ambiente IN ('homologacao', 'producao')),
  CONSTRAINT integracao_execucoes_status_check CHECK (status IN ('iniciada', 'sucesso', 'erro', 'timeout', 'cancelada')),
  CONSTRAINT integracao_execucoes_tentativa_check CHECK (tentativa > 0),
  CONSTRAINT integracao_execucoes_hash_check CHECK (request_hash IS NULL OR request_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT integracao_execucoes_duracao_check CHECK (duracao_ms IS NULL OR duracao_ms >= 0)
);

CREATE INDEX IF NOT EXISTS idx_integracao_execucoes_fundo_tipo
  ON public.integracao_execucoes(fundo_id, tipo_execucao, iniciada_em DESC);

CREATE INDEX IF NOT EXISTS idx_integracao_execucoes_remessa
  ON public.integracao_execucoes(remessa_cnab_id, tipo_execucao, iniciada_em DESC)
  WHERE remessa_cnab_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_integracao_execucoes_operacao
  ON public.integracao_execucoes(operacao_id, tipo_execucao, iniciada_em DESC)
  WHERE operacao_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_integracao_execucoes_idempotency
  ON public.integracao_execucoes(idempotency_key, status, created_at DESC)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.retornos_integracao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  integracao_execucao_id uuid NOT NULL REFERENCES public.integracao_execucoes(id) ON DELETE RESTRICT,
  remessa_cnab_id uuid REFERENCES public.remessas_cnab(id) ON DELETE RESTRICT,
  tipo_retorno text NOT NULL,
  bucket text NOT NULL DEFAULT 'retornos-integracao',
  storage_path text NOT NULL,
  mime_type text,
  tamanho_bytes integer NOT NULL,
  sha256 text NOT NULL,
  resumo_estruturado jsonb NOT NULL DEFAULT '{}'::jsonb,
  recebido_em timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT retornos_integracao_tipo_check CHECK (tipo_retorno IN ('status', 'arquivo', 'payload')),
  CONSTRAINT retornos_integracao_tamanho_check CHECK (tamanho_bytes >= 0),
  CONSTRAINT retornos_integracao_hash_check CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT retornos_integracao_path_unique UNIQUE (bucket, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_retornos_integracao_fundo
  ON public.retornos_integracao(fundo_id, recebido_em DESC);

CREATE INDEX IF NOT EXISTS idx_retornos_integracao_remessa
  ON public.retornos_integracao(remessa_cnab_id, recebido_em DESC)
  WHERE remessa_cnab_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.usuario_pode_ler_integracao_execucao(p_execucao_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN get_user_role() = 'gestor' THEN true
    WHEN get_user_role() = 'consultor' THEN EXISTS (
      SELECT 1
      FROM public.integracao_execucoes e
      LEFT JOIN public.remessas_cnab_operacoes ro ON ro.remessa_cnab_id = e.remessa_cnab_id
      LEFT JOIN public.operacoes o ON o.id = COALESCE(e.operacao_id, ro.operacao_id)
      JOIN public.consultor_cedente cc ON cc.cedente_id = o.cedente_id
      WHERE e.id = p_execucao_id AND cc.consultor_id = auth.uid()
    )
    WHEN get_user_role() = 'cedente' THEN EXISTS (
      SELECT 1
      FROM public.integracao_execucoes e
      LEFT JOIN public.remessas_cnab_operacoes ro ON ro.remessa_cnab_id = e.remessa_cnab_id
      LEFT JOIN public.operacoes o ON o.id = COALESCE(e.operacao_id, ro.operacao_id)
      JOIN public.cedentes c ON c.id = o.cedente_id
      WHERE e.id = p_execucao_id AND c.user_id = auth.uid()
    )
    ELSE false
  END;
$$;

ALTER TABLE public.integracao_execucoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retornos_integracao ENABLE ROW LEVEL SECURITY;

CREATE POLICY integracao_execucoes_gestor_all ON public.integracao_execucoes
FOR ALL TO authenticated USING (get_user_role() = 'gestor') WITH CHECK (get_user_role() = 'gestor');

CREATE POLICY integracao_execucoes_contexto_select ON public.integracao_execucoes
FOR SELECT TO authenticated USING (public.usuario_pode_ler_integracao_execucao(id));

CREATE POLICY retornos_integracao_gestor_all ON public.retornos_integracao
FOR ALL TO authenticated USING (get_user_role() = 'gestor') WITH CHECK (get_user_role() = 'gestor');

CREATE POLICY retornos_integracao_contexto_select ON public.retornos_integracao
FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1
    FROM public.integracao_execucoes e
    WHERE e.id = retornos_integracao.integracao_execucao_id
      AND public.usuario_pode_ler_integracao_execucao(e.id)
  )
);

GRANT SELECT, INSERT, UPDATE ON public.integracao_execucoes, public.retornos_integracao TO authenticated;
GRANT ALL ON public.integracao_execucoes, public.retornos_integracao TO service_role;
GRANT EXECUTE ON FUNCTION public.usuario_pode_ler_integracao_execucao(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.usuario_pode_ler_integracao_execucao(uuid) FROM PUBLIC;
