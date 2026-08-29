-- Fundo ativo por usuário gestor.
-- Cria associação explícita usuário x fundo para que o app deixe de depender
-- apenas do papel global "gestor" ao filtrar contextos operacionais.

-- Compatibilidade com bancos de homolog que ainda não receberam a migration
-- de auditoria ampliada. As actions desta fase registram ator/origem, então
-- a tabela de logs precisa ter esses campos antes de qualquer INSERT.
ALTER TABLE IF EXISTS public.logs_auditoria
  ALTER COLUMN usuario_id DROP NOT NULL;

ALTER TABLE IF EXISTS public.logs_auditoria
  ADD COLUMN IF NOT EXISTS ator_tipo text NOT NULL DEFAULT 'usuario',
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'server_action',
  ADD COLUMN IF NOT EXISTS ator_identificador text;

DO $$
BEGIN
  IF to_regclass('public.logs_auditoria') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'logs_auditoria_ator_tipo_check'
         AND conrelid = 'public.logs_auditoria'::regclass
     ) THEN
    ALTER TABLE public.logs_auditoria
      ADD CONSTRAINT logs_auditoria_ator_tipo_check
      CHECK (ator_tipo IN ('usuario', 'sistema', 'integracao', 'cron'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_logs_auditoria_ator_tipo
  ON public.logs_auditoria(ator_tipo);

CREATE INDEX IF NOT EXISTS idx_logs_auditoria_origem
  ON public.logs_auditoria(origem);

CREATE INDEX IF NOT EXISTS idx_logs_auditoria_ator_identificador
  ON public.logs_auditoria(ator_identificador)
  WHERE ator_identificador IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.usuario_fundos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE CASCADE,
  perfil_no_fundo text NOT NULL DEFAULT 'gestor'
    CHECK (perfil_no_fundo IN ('gestor', 'administrador', 'operador', 'auditor', 'plataforma')),
  status text NOT NULL DEFAULT 'ativo'
    CHECK (status IN ('ativo', 'suspenso', 'revogado')),
  principal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usuario_fundos_usuario_fundo_unique UNIQUE (usuario_id, fundo_id)
);

CREATE INDEX IF NOT EXISTS idx_usuario_fundos_usuario_status
  ON public.usuario_fundos(usuario_id, status);

CREATE INDEX IF NOT EXISTS idx_usuario_fundos_fundo_status
  ON public.usuario_fundos(fundo_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS uq_usuario_fundos_principal_ativo
  ON public.usuario_fundos(usuario_id)
  WHERE principal IS TRUE AND status = 'ativo';

DROP TRIGGER IF EXISTS usuario_fundos_updated_at ON public.usuario_fundos;
CREATE TRIGGER usuario_fundos_updated_at
  BEFORE UPDATE ON public.usuario_fundos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.usuario_fundos ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.usuario_fundos TO authenticated;
GRANT ALL ON public.usuario_fundos TO service_role;

DROP POLICY IF EXISTS usuario_fundos_select_own ON public.usuario_fundos;
CREATE POLICY usuario_fundos_select_own ON public.usuario_fundos
  FOR SELECT
  TO authenticated
  USING (
    usuario_id = (SELECT auth.uid())
    OR public.get_user_role() = 'gestor'
  );

DROP POLICY IF EXISTS usuario_fundos_gestor_manage ON public.usuario_fundos;
CREATE POLICY usuario_fundos_gestor_manage ON public.usuario_fundos
  FOR ALL
  TO authenticated
  USING (public.get_user_role() = 'gestor')
  WITH CHECK (public.get_user_role() = 'gestor');

-- Bootstrap compatível: gestores existentes passam a ter acesso explícito aos
-- fundos ativos já cadastrados. A partir daqui o acesso pode ser refinado por
-- usuário/fundo sem quebrar a homologação atual.
INSERT INTO public.usuario_fundos (usuario_id, fundo_id, perfil_no_fundo, status, principal)
SELECT
  p.id,
  f.id,
  'administrador',
  'ativo',
  row_number() OVER (PARTITION BY p.id ORDER BY f.created_at NULLS LAST, f.nome, f.id) = 1
FROM public.profiles p
CROSS JOIN public.fundos f
WHERE p.role = 'gestor'
  AND COALESCE(f.ativo, true) IS TRUE
ON CONFLICT (usuario_id, fundo_id) DO NOTHING;

-- Auditoria estrutural da implantação da associação.
INSERT INTO public.logs_auditoria (
  usuario_id,
  ator_tipo,
  origem,
  tipo_evento,
  entidade_tipo,
  entidade_id,
  dados_depois
)
SELECT
  p.id,
  'usuario',
  'migration',
  'usuario_fundos_bootstrap',
  'usuario_fundos',
  NULL,
  jsonb_build_object(
    'fundos_autorizados', COUNT(uf.id),
    'principal', MAX(uf.fundo_id::text) FILTER (WHERE uf.principal)
  )
FROM public.profiles p
JOIN public.usuario_fundos uf ON uf.usuario_id = p.id
WHERE p.role = 'gestor'
  AND NOT EXISTS (
    SELECT 1
    FROM public.logs_auditoria la
    WHERE la.usuario_id = p.id
      AND la.tipo_evento = 'usuario_fundos_bootstrap'
      AND la.entidade_tipo = 'usuario_fundos'
  )
GROUP BY p.id;
