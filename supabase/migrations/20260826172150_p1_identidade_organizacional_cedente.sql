BEGIN;

-- P1: cedente_acessos passa a ser a associacao organizacional canonica.
-- cedentes.user_id permanece obrigatorio neste ticket como ponte legada.

ALTER TABLE public.cedente_acessos
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS aceito_em timestamptz,
  ADD COLUMN IF NOT EXISTS revogado_em timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.cedente_acessos
  DROP CONSTRAINT IF EXISTS cedente_acessos_perfil_check;

ALTER TABLE public.cedente_acessos
  ALTER COLUMN perfil DROP DEFAULT;

UPDATE public.cedente_acessos
SET perfil = CASE perfil
  WHEN 'administrador' THEN 'ADMIN'
  WHEN 'operador' THEN 'OPERACIONAL'
  ELSE perfil
END
WHERE perfil IN ('administrador', 'operador');

UPDATE public.cedente_acessos
SET status = CASE WHEN ativo THEN 'ATIVO' ELSE 'REVOGADO' END
WHERE status IS NULL;

-- O modelo anterior nao registrava o instante de aceite/revogacao. Para os
-- acessos ja ativos, created_at e a melhor evidencia historica disponivel. A
-- revogacao legada recebe o instante desta migracao, sem reescrever created_at.
UPDATE public.cedente_acessos
SET aceito_em = COALESCE(aceito_em, created_at)
WHERE status = 'ATIVO';

UPDATE public.cedente_acessos
SET revogado_em = COALESCE(revogado_em, now())
WHERE status = 'REVOGADO';

ALTER TABLE public.cedente_acessos
  ALTER COLUMN perfil SET DEFAULT 'OPERACIONAL',
  ALTER COLUMN status SET DEFAULT 'ATIVO',
  ALTER COLUMN status SET NOT NULL;

ALTER TABLE public.cedente_acessos
  ADD CONSTRAINT cedente_acessos_perfil_check
    CHECK (perfil IN ('ADMIN', 'OPERACIONAL')),
  ADD CONSTRAINT cedente_acessos_status_check
    CHECK (status IN ('CONVIDADO', 'ATIVO', 'REVOGADO')),
  ADD CONSTRAINT cedente_acessos_estado_check
    CHECK (
      (status = 'CONVIDADO' AND ativo = false AND aceito_em IS NULL AND revogado_em IS NULL)
      OR (status = 'ATIVO' AND ativo = true AND aceito_em IS NOT NULL AND revogado_em IS NULL)
      OR (status = 'REVOGADO' AND ativo = false AND revogado_em IS NOT NULL)
    );

-- A constraint antiga tinha as mesmas colunas em ordem inversa. A ordem nova
-- prioriza a resolucao por usuario sem criar uma segunda unicidade concorrente.
ALTER TABLE public.cedente_acessos
  DROP CONSTRAINT IF EXISTS cedente_acessos_cedente_id_user_id_key;

ALTER TABLE public.cedente_acessos
  ADD CONSTRAINT cedente_acessos_user_id_cedente_id_key UNIQUE (user_id, cedente_id);

CREATE OR REPLACE FUNCTION private.sincronizar_estado_cedente_acesso()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Compatibilidade com inserts legados que ainda informem somente ativo.
    IF NEW.status = 'ATIVO' AND NEW.ativo = false THEN
      NEW.status := 'REVOGADO';
    ELSE
      NEW.ativo := NEW.status = 'ATIVO';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.ativo := NEW.status = 'ATIVO';
  ELSIF NEW.ativo IS DISTINCT FROM OLD.ativo THEN
    NEW.status := CASE WHEN NEW.ativo THEN 'ATIVO' ELSE 'REVOGADO' END;
  END IF;

  IF NEW.status = 'CONVIDADO' THEN
    NEW.aceito_em := NULL;
    NEW.revogado_em := NULL;
  ELSIF NEW.status = 'ATIVO' THEN
    NEW.aceito_em := COALESCE(NEW.aceito_em, now());
    NEW.revogado_em := NULL;
  ELSE
    NEW.revogado_em := COALESCE(NEW.revogado_em, now());
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.sincronizar_estado_cedente_acesso() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS cedente_acessos_sincronizar_estado ON public.cedente_acessos;
CREATE TRIGGER cedente_acessos_sincronizar_estado
  BEFORE INSERT OR UPDATE OF perfil, status, ativo, aceito_em, revogado_em
  ON public.cedente_acessos
  FOR EACH ROW
  EXECUTE FUNCTION private.sincronizar_estado_cedente_acesso();

-- Backfill idempotente do owner legado. Se o owner ja possuir a associacao,
-- prevalece ADMIN/ATIVO porque cedentes.user_id ainda representa o owner de
-- compatibilidade durante este ticket.
INSERT INTO public.cedente_acessos (
  user_id,
  cedente_id,
  perfil,
  status,
  ativo,
  convidado_por,
  aceito_em,
  revogado_em,
  created_at,
  updated_at
)
SELECT
  c.user_id,
  c.id,
  'ADMIN',
  'ATIVO',
  true,
  NULL,
  c.created_at,
  NULL,
  c.created_at,
  now()
FROM public.cedentes c
ON CONFLICT (user_id, cedente_id) DO UPDATE
SET perfil = 'ADMIN',
    status = 'ATIVO',
    ativo = true,
    aceito_em = COALESCE(public.cedente_acessos.aceito_em, EXCLUDED.aceito_em),
    revogado_em = NULL,
    updated_at = now();

CREATE INDEX IF NOT EXISTS cedente_acessos_cedente_status_idx
  ON public.cedente_acessos (cedente_id, status, perfil);

CREATE INDEX IF NOT EXISTS cedente_acessos_user_status_idx
  ON public.cedente_acessos (user_id, status, cedente_id);

-- Fundacao persistente de convites. O fluxo de aceite sera implementado em
-- ticket posterior; token em texto puro nao possui coluna neste modelo.
CREATE TABLE public.cedente_usuario_convites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id) ON DELETE RESTRICT,
  email_normalizado text NOT NULL,
  perfil text NOT NULL,
  token_hash text NOT NULL,
  status text NOT NULL DEFAULT 'PENDENTE',
  convidado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  aceito_por_user_id uuid REFERENCES public.profiles(id) ON DELETE RESTRICT,
  aceito_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cedente_usuario_convites_email_check CHECK (
    email_normalizado = lower(btrim(email_normalizado))
    AND position('@' IN email_normalizado) > 1
  ),
  CONSTRAINT cedente_usuario_convites_perfil_check
    CHECK (perfil IN ('ADMIN', 'OPERACIONAL')),
  CONSTRAINT cedente_usuario_convites_token_hash_check
    CHECK (length(btrim(token_hash)) >= 32),
  CONSTRAINT cedente_usuario_convites_status_check
    CHECK (status IN ('PENDENTE', 'ACEITO', 'EXPIRADO', 'CANCELADO')),
  CONSTRAINT cedente_usuario_convites_expiracao_check
    CHECK (expires_at > created_at),
  CONSTRAINT cedente_usuario_convites_aceite_check CHECK (
    (status = 'ACEITO' AND aceito_por_user_id IS NOT NULL AND aceito_em IS NOT NULL)
    OR (status <> 'ACEITO' AND aceito_por_user_id IS NULL AND aceito_em IS NULL)
  )
);

CREATE UNIQUE INDEX cedente_usuario_convites_token_hash_unique
  ON public.cedente_usuario_convites (token_hash);

CREATE UNIQUE INDEX cedente_usuario_convites_pendente_unique
  ON public.cedente_usuario_convites (cedente_id, email_normalizado)
  WHERE status = 'PENDENTE';

CREATE INDEX cedente_usuario_convites_cedente_status_idx
  ON public.cedente_usuario_convites (cedente_id, status, created_at DESC);

CREATE INDEX cedente_usuario_convites_email_status_idx
  ON public.cedente_usuario_convites (email_normalizado, status);

CREATE TRIGGER cedente_usuario_convites_updated_at
  BEFORE UPDATE ON public.cedente_usuario_convites
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.cedente_usuario_convites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cedente_usuario_convites FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.cedente_usuario_convites TO service_role;

COMMENT ON TABLE public.cedente_usuario_convites IS
  'Convites persistentes para usuarios de um Cedente existente. Armazena somente hash/referencia segura; o aceite sera implementado em fase posterior.';

-- Helper canonico: associacao ATIVA primeiro; owner somente quando ainda nao
-- existe qualquer associacao do par legado. Ambiguidade sempre falha fechada.
CREATE OR REPLACE FUNCTION public.get_user_cedente_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_cedente_ids uuid[];
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT array_agg(associacoes.cedente_id ORDER BY associacoes.cedente_id)
    INTO v_cedente_ids
    FROM (
      SELECT DISTINCT ca.cedente_id
      FROM public.cedente_acessos ca
      WHERE ca.user_id = v_user_id
        AND ca.status = 'ATIVO'
    ) associacoes;

  IF COALESCE(cardinality(v_cedente_ids), 0) > 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '21000',
      MESSAGE = 'USUARIO_CEDENTE_AMBIGUO: mais de uma associacao ativa foi encontrada.';
  END IF;

  IF COALESCE(cardinality(v_cedente_ids), 0) = 1 THEN
    RETURN v_cedente_ids[1];
  END IF;

  SELECT array_agg(owners.id ORDER BY owners.id)
    INTO v_cedente_ids
    FROM (
      SELECT DISTINCT c.id
      FROM public.cedentes c
      WHERE c.user_id = v_user_id
        AND NOT EXISTS (
          SELECT 1
          FROM public.cedente_acessos ca
          WHERE ca.user_id = v_user_id
            AND ca.cedente_id = c.id
        )
    ) owners;

  IF COALESCE(cardinality(v_cedente_ids), 0) > 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '21000',
      MESSAGE = 'USUARIO_CEDENTE_AMBIGUO: mais de um owner legado foi encontrado.';
  END IF;

  RETURN v_cedente_ids[1];
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_cedente_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_cedente_id() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_user_cedente_acesso_perfil()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_cedente_id uuid;
  v_perfil text;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  v_cedente_id := public.get_user_cedente_id();
  IF v_cedente_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT ca.perfil
    INTO v_perfil
    FROM public.cedente_acessos ca
   WHERE ca.user_id = v_user_id
     AND ca.cedente_id = v_cedente_id
     AND ca.status = 'ATIVO';

  IF FOUND THEN
    -- Contrato publico legado: as Server Actions e RPCs atuais ainda comparam
    -- estes valores. O armazenamento e os helpers private ja sao canonicos.
    RETURN CASE v_perfil
      WHEN 'ADMIN' THEN 'administrador'
      WHEN 'OPERACIONAL' THEN 'operador'
      ELSE NULL
    END;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.cedentes c
    WHERE c.id = v_cedente_id
      AND c.user_id = v_user_id
      AND NOT EXISTS (
        SELECT 1 FROM public.cedente_acessos ca
        WHERE ca.user_id = v_user_id AND ca.cedente_id = v_cedente_id
      )
  ) THEN
    RETURN 'administrador';
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_cedente_acesso_perfil() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_cedente_acesso_perfil() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.usuario_tem_acesso_cedente(p_cedente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.cedente_acessos ca
        WHERE ca.user_id = (SELECT auth.uid())
          AND ca.cedente_id = p_cedente_id
          AND ca.status = 'ATIVO'
      )
      OR EXISTS (
        SELECT 1
        FROM public.cedentes c
        WHERE c.id = p_cedente_id
          AND c.user_id = (SELECT auth.uid())
          AND NOT EXISTS (
            SELECT 1 FROM public.cedente_acessos ca
            WHERE ca.user_id = (SELECT auth.uid())
              AND ca.cedente_id = p_cedente_id
          )
      )
    );
$function$;

CREATE OR REPLACE FUNCTION private.usuario_e_admin_cedente(p_cedente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.cedente_acessos ca
        WHERE ca.user_id = (SELECT auth.uid())
          AND ca.cedente_id = p_cedente_id
          AND ca.status = 'ATIVO'
          AND ca.perfil = 'ADMIN'
      )
      OR EXISTS (
        SELECT 1
        FROM public.cedentes c
        WHERE c.id = p_cedente_id
          AND c.user_id = (SELECT auth.uid())
          AND NOT EXISTS (
            SELECT 1 FROM public.cedente_acessos ca
            WHERE ca.user_id = (SELECT auth.uid())
              AND ca.cedente_id = p_cedente_id
          )
      )
    );
$function$;

CREATE OR REPLACE FUNCTION private.usuario_e_operacional_cedente(p_cedente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.cedente_acessos ca
      WHERE ca.user_id = (SELECT auth.uid())
        AND ca.cedente_id = p_cedente_id
        AND ca.status = 'ATIVO'
        AND ca.perfil = 'OPERACIONAL'
    );
$function$;

REVOKE ALL ON FUNCTION private.usuario_tem_acesso_cedente(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.usuario_e_admin_cedente(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.usuario_e_operacional_cedente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.usuario_tem_acesso_cedente(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.usuario_e_admin_cedente(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.usuario_e_operacional_cedente(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_user_cedente_id() IS
  'Resolve a associacao organizacional ATIVA do usuario; falha fechada em ambiguidade e usa cedentes.user_id apenas como fallback sem associacao canonica.';

COMMENT ON FUNCTION public.get_user_cedente_acesso_perfil() IS
  'Adaptador temporario de compatibilidade: resolve o perfil canonico e retorna administrador/operador para consumidores legados.';

COMMENT ON FUNCTION private.usuario_e_admin_cedente(uuid) IS
  'Autoriza somente ADMIN ATIVO; owner legado e aceito apenas quando o par ainda nao possui associacao canonica.';

COMMENT ON FUNCTION private.usuario_e_operacional_cedente(uuid) IS
  'Identifica exclusivamente OPERACIONAL ATIVO e nunca promove o perfil por fallback de owner.';

COMMIT;
