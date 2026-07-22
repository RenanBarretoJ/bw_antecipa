-- Fase 10: fila auditavel para reset administrativo de MFA.
-- Nao edita migrations ja aplicadas. A execucao efetiva ocorre server-side
-- com Supabase Auth Admin MFA e exige dupla aprovacao.

CREATE TABLE IF NOT EXISTS public.mfa_reset_solicitacoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  solicitante_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  aprovador_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  motivo text NOT NULL,
  evidencia text,
  status text NOT NULL DEFAULT 'pendente',
  fatores_removidos integer NOT NULL DEFAULT 0,
  erro_execucao text,
  solicitado_em timestamptz NOT NULL DEFAULT now(),
  aprovado_em timestamptz,
  executado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mfa_reset_solicitacoes_status_check CHECK (status IN ('pendente', 'aprovado', 'executado', 'rejeitado', 'erro')),
  CONSTRAINT mfa_reset_solicitacoes_motivo_check CHECK (length(trim(motivo)) >= 10),
  CONSTRAINT mfa_reset_solicitacoes_dupla_aprovacao_check CHECK (aprovador_id IS NULL OR aprovador_id <> solicitante_id)
);

CREATE INDEX IF NOT EXISTS idx_mfa_reset_solicitacoes_usuario_created
  ON public.mfa_reset_solicitacoes(usuario_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mfa_reset_solicitacoes_status_created
  ON public.mfa_reset_solicitacoes(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mfa_reset_solicitacoes_solicitante
  ON public.mfa_reset_solicitacoes(solicitante_id, created_at DESC);

ALTER TABLE public.mfa_reset_solicitacoes ENABLE ROW LEVEL SECURITY;

CREATE POLICY mfa_reset_solicitacoes_gestor_select ON public.mfa_reset_solicitacoes
  FOR SELECT
  TO authenticated
  USING (public.get_user_role() = 'gestor');

CREATE POLICY mfa_reset_solicitacoes_usuario_select ON public.mfa_reset_solicitacoes
  FOR SELECT
  TO authenticated
  USING (usuario_id = (SELECT auth.uid()));

-- Escrita deve ser feita apenas pelo backend com service_role.
GRANT SELECT ON public.mfa_reset_solicitacoes TO authenticated;
GRANT ALL ON public.mfa_reset_solicitacoes TO service_role;

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_mfa_reset_solicitacoes_updated_at ON public.mfa_reset_solicitacoes;
CREATE TRIGGER update_mfa_reset_solicitacoes_updated_at
  BEFORE UPDATE ON public.mfa_reset_solicitacoes
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- Hardening Fase 10: recria funcoes antigas SECURITY DEFINER usadas por RLS
-- com search_path fixo e referencias qualificadas por schema.
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT p.role::text
    FROM public.profiles p
    WHERE p.id = auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_cedente_id()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN COALESCE(
    (
      SELECT c.id
      FROM public.cedentes c
      WHERE c.user_id = auth.uid()
      LIMIT 1
    ),
    (
      SELECT ca.cedente_id
      FROM public.cedente_acessos ca
      WHERE ca.user_id = auth.uid()
        AND ca.ativo = true
      LIMIT 1
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_sacado_cnpj()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN (
    SELECT s.cnpj
    FROM public.sacados s
    WHERE s.user_id = auth.uid()
    LIMIT 1
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_user_operacao_ids()
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT o.id
  FROM public.operacoes o
  WHERE o.cedente_id = public.get_user_cedente_id();
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_cedente_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_sacado_cnpj() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_operacao_ids() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_cedente_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_sacado_cnpj() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_operacao_ids() TO authenticated, service_role;
