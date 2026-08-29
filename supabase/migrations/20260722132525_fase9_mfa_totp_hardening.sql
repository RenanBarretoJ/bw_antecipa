-- Fase 9: MFA TOTP e hardening de seguranca pre-producao.
-- Usa Supabase Auth MFA/TOTP como mecanismo de fator e AAL2 como nivel de sessao.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS mfa_obrigatorio_override boolean,
  ADD COLUMN IF NOT EXISTS mfa_ativado_em timestamptz,
  ADD COLUMN IF NOT EXISTS ultima_autenticacao_forte_em timestamptz,
  ADD COLUMN IF NOT EXISTS mfa_reset_em timestamptz,
  ADD COLUMN IF NOT EXISTS sessoes_revogadas_em timestamptz;

CREATE TABLE IF NOT EXISTS public.seguranca_eventos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_evento text NOT NULL,
  usuario_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ator_usuario_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ator_tipo text NOT NULL DEFAULT 'usuario',
  origem text NOT NULL DEFAULT 'app',
  severidade text NOT NULL DEFAULT 'info',
  entidade_tipo text,
  entidade_id uuid,
  ip_hash text,
  user_agent_hash text,
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seguranca_eventos_tipo_check CHECK (tipo_evento IN (
    'MFA_ENROLL_INICIADO',
    'MFA_ATIVADO',
    'MFA_DESATIVADO',
    'MFA_FALHA',
    'MFA_RECOVERY_USADO',
    'MFA_RECOVERY_REGENERADO',
    'MFA_RESET_ADMINISTRATIVO',
    'SESSAO_ELEVADA',
    'SESSOES_REVOGADAS',
    'CREDENCIAL_ROTACIONADA',
    'ACESSO_NEGADO',
    'RATE_LIMIT_BLOQUEADO'
  )),
  CONSTRAINT seguranca_eventos_ator_tipo_check CHECK (ator_tipo IN ('usuario', 'sistema', 'cron', 'integracao')),
  CONSTRAINT seguranca_eventos_severidade_check CHECK (severidade IN ('info', 'warning', 'critical')),
  CONSTRAINT seguranca_eventos_dados_objeto_check CHECK (jsonb_typeof(dados) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_seguranca_eventos_usuario_created
  ON public.seguranca_eventos(usuario_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_seguranca_eventos_tipo_created
  ON public.seguranca_eventos(tipo_evento, created_at DESC);

CREATE TABLE IF NOT EXISTS public.mfa_recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  geracao_id uuid NOT NULL DEFAULT gen_random_uuid(),
  usado_em timestamptz,
  usado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  invalidado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mfa_recovery_codes_hash_check CHECK (code_hash ~ '^[0-9a-f]{64}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mfa_recovery_codes_hash_active
  ON public.mfa_recovery_codes(user_id, code_hash)
  WHERE usado_em IS NULL AND invalidado_em IS NULL;

CREATE INDEX IF NOT EXISTS idx_mfa_recovery_codes_user_active
  ON public.mfa_recovery_codes(user_id, created_at DESC)
  WHERE usado_em IS NULL AND invalidado_em IS NULL;

CREATE TABLE IF NOT EXISTS public.sessoes_elevadas (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  aal text NOT NULL DEFAULT 'aal2',
  metodo text NOT NULL,
  factor_id text,
  elevada_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sessoes_elevadas_aal_check CHECK (aal IN ('aal2')),
  CONSTRAINT sessoes_elevadas_metodo_check CHECK (metodo IN ('totp', 'recovery_code', 'admin_reset'))
);

CREATE INDEX IF NOT EXISTS idx_sessoes_elevadas_expira_em
  ON public.sessoes_elevadas(expira_em);

CREATE TABLE IF NOT EXISTS public.seguranca_rate_limits (
  key_hash text PRIMARY KEY,
  escopo text NOT NULL,
  tentativas integer NOT NULL DEFAULT 0,
  bloqueado_ate timestamptz,
  primeira_tentativa_em timestamptz NOT NULL DEFAULT now(),
  ultima_tentativa_em timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT seguranca_rate_limits_tentativas_check CHECK (tentativas >= 0),
  CONSTRAINT seguranca_rate_limits_key_hash_check CHECK (key_hash ~ '^[0-9a-f]{64}$')
);

CREATE INDEX IF NOT EXISTS idx_seguranca_rate_limits_escopo
  ON public.seguranca_rate_limits(escopo, bloqueado_ate);

ALTER TABLE public.seguranca_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mfa_recovery_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessoes_elevadas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seguranca_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY seguranca_eventos_gestor_select ON public.seguranca_eventos
  FOR SELECT
  TO authenticated
  USING (public.get_user_role() = 'gestor');

CREATE POLICY seguranca_eventos_usuario_select ON public.seguranca_eventos
  FOR SELECT
  TO authenticated
  USING (usuario_id = (SELECT auth.uid()));

CREATE POLICY sessoes_elevadas_own_select ON public.sessoes_elevadas
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY mfa_recovery_codes_own_count_select ON public.mfa_recovery_codes
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Escrita destas tabelas deve ocorrer via server-side com service_role.
GRANT SELECT ON public.seguranca_eventos TO authenticated;
GRANT SELECT ON public.mfa_recovery_codes TO authenticated;
GRANT SELECT ON public.sessoes_elevadas TO authenticated;
GRANT ALL ON public.seguranca_eventos, public.mfa_recovery_codes, public.sessoes_elevadas, public.seguranca_rate_limits TO service_role;

CREATE OR REPLACE FUNCTION public.usuario_possui_mfa_elevado()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT coalesce((SELECT auth.jwt() ->> 'aal'), 'aal1') = 'aal2';
$$;
