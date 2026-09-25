-- C1.1 - A empresa consultora passa a ser dona da carteira.
-- Usuarios continuam sendo atores individuais e profiles.role continua
-- distinguindo o papel global CONSULTOR.

BEGIN;

CREATE TABLE public.consultores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cnpj text NOT NULL,
  razao_social text NOT NULL,
  nome_fantasia text,
  status text NOT NULL DEFAULT 'ativo',
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consultores_cnpj_formato_check CHECK (cnpj ~ '^[0-9]{14}$'),
  CONSTRAINT consultores_cnpj_valido_check CHECK (private.cnpj_valido(cnpj)),
  CONSTRAINT consultores_razao_social_check CHECK (pg_catalog.length(pg_catalog.btrim(razao_social)) >= 3),
  CONSTRAINT consultores_status_check CHECK (status IN ('ativo', 'inativo')),
  CONSTRAINT consultores_cnpj_unique UNIQUE (cnpj)
);

CREATE TABLE public.consultor_usuarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultor_id uuid NOT NULL REFERENCES public.consultores(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  papel text NOT NULL,
  status text NOT NULL DEFAULT 'pendente',
  convidado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  convite_expires_at timestamptz,
  ativado_em timestamptz,
  desativado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consultor_usuarios_papel_check CHECK (papel IN ('OWNER', 'ADMIN', 'OPERADOR', 'LEITOR')),
  CONSTRAINT consultor_usuarios_status_check CHECK (status IN ('pendente', 'ativo', 'inativo')),
  CONSTRAINT consultor_usuarios_ativacao_check CHECK (
    (status = 'ativo' AND ativado_em IS NOT NULL AND desativado_em IS NULL)
    OR (status = 'pendente' AND ativado_em IS NULL AND desativado_em IS NULL AND convite_expires_at IS NOT NULL)
    OR (status = 'inativo' AND desativado_em IS NOT NULL)
  ),
  CONSTRAINT consultor_usuarios_consultor_user_unique UNIQUE (consultor_id, user_id),
  CONSTRAINT consultor_usuarios_user_unique UNIQUE (user_id)
);

CREATE UNIQUE INDEX consultor_usuarios_owner_ativo_unique
  ON public.consultor_usuarios (consultor_id)
  WHERE papel = 'OWNER' AND status IN ('pendente', 'ativo');

CREATE INDEX consultor_usuarios_acesso_idx
  ON public.consultor_usuarios (user_id, status, consultor_id, papel);

CREATE TABLE public.consultor_fundos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultor_id uuid NOT NULL REFERENCES public.consultores(id) ON DELETE CASCADE,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ativo',
  concedido_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revogado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  revogado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consultor_fundos_status_check CHECK (status IN ('ativo', 'inativo')),
  CONSTRAINT consultor_fundos_revogacao_check CHECK (
    (status = 'ativo' AND revogado_em IS NULL AND revogado_por IS NULL)
    OR status = 'inativo'
  ),
  CONSTRAINT consultor_fundos_consultor_fundo_unique UNIQUE (consultor_id, fundo_id)
);

CREATE INDEX consultor_fundos_acesso_idx
  ON public.consultor_fundos (consultor_id, fundo_id)
  WHERE status = 'ativo';

CREATE TABLE public.consultor_cedentes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultor_id uuid NOT NULL REFERENCES public.consultores(id) ON DELETE CASCADE,
  cedente_id uuid NOT NULL REFERENCES public.cedentes(id) ON DELETE RESTRICT,
  comissao_percentual numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pendente',
  vinculado_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consultor_cedentes_comissao_check CHECK (comissao_percentual >= 0),
  CONSTRAINT consultor_cedentes_status_check CHECK (status IN ('pendente', 'ativo', 'inativo')),
  CONSTRAINT consultor_cedentes_consultor_cedente_unique UNIQUE (consultor_id, cedente_id)
);

CREATE INDEX consultor_cedentes_gestao_idx
  ON public.consultor_cedentes (consultor_id, cedente_id)
  WHERE status IN ('pendente', 'ativo');

CREATE INDEX consultor_cedentes_operacao_idx
  ON public.consultor_cedentes (consultor_id, cedente_id)
  WHERE status = 'ativo';

CREATE TRIGGER consultores_updated_at
  BEFORE UPDATE ON public.consultores
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER consultor_usuarios_updated_at
  BEFORE UPDATE ON public.consultor_usuarios
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER consultor_fundos_updated_at
  BEFORE UPDATE ON public.consultor_fundos
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER consultor_cedentes_updated_at
  BEFORE UPDATE ON public.consultor_cedentes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.consultores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultor_usuarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultor_fundos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultor_cedentes ENABLE ROW LEVEL SECURITY;

-- Nenhuma tabela organizacional aceita escrita direta do cliente. As mutacoes
-- administrativas passam por RPCs SECURITY DEFINER com MFA e auditoria na app.
REVOKE ALL ON TABLE public.consultores FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.consultor_usuarios FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.consultor_fundos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.consultor_cedentes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.consultores TO authenticated;
GRANT SELECT ON TABLE public.consultor_usuarios TO authenticated;
GRANT SELECT ON TABLE public.consultor_fundos TO authenticated;
GRANT SELECT ON TABLE public.consultor_cedentes TO authenticated;
GRANT ALL ON TABLE public.consultores TO service_role;
GRANT ALL ON TABLE public.consultor_usuarios TO service_role;
GRANT ALL ON TABLE public.consultor_fundos TO service_role;
GRANT ALL ON TABLE public.consultor_cedentes TO service_role;

CREATE POLICY consultores_select_membro_ou_admin
  ON public.consultores FOR SELECT TO authenticated
  USING (
    (SELECT private.usuario_e_super_admin())
    OR EXISTS (
      SELECT 1
      FROM public.consultor_usuarios cu
      WHERE cu.consultor_id = consultores.id
        AND cu.user_id = (SELECT auth.uid())
        AND cu.status = 'ativo'
    )
  );

CREATE POLICY consultor_usuarios_select_proprio_ou_admin
  ON public.consultor_usuarios FOR SELECT TO authenticated
  USING (
    (SELECT private.usuario_e_super_admin())
    OR user_id = (SELECT auth.uid())
  );

CREATE POLICY consultor_fundos_select_membro_ou_admin
  ON public.consultor_fundos FOR SELECT TO authenticated
  USING (
    (SELECT private.usuario_e_super_admin())
    OR EXISTS (
      SELECT 1
      FROM public.consultor_usuarios cu
      JOIN public.consultores co ON co.id = cu.consultor_id
      WHERE cu.consultor_id = consultor_fundos.consultor_id
        AND cu.user_id = (SELECT auth.uid())
        AND cu.status = 'ativo'
        AND co.status = 'ativo'
    )
  );

CREATE POLICY consultor_cedentes_select_membro_ou_admin
  ON public.consultor_cedentes FOR SELECT TO authenticated
  USING (
    (SELECT private.usuario_e_super_admin())
    OR EXISTS (
      SELECT 1
      FROM public.consultor_usuarios cu
      JOIN public.consultores co ON co.id = cu.consultor_id
      WHERE cu.consultor_id = consultor_cedentes.consultor_id
        AND cu.user_id = (SELECT auth.uid())
        AND cu.status = 'ativo'
        AND co.status = 'ativo'
    )
  );

COMMENT ON TABLE public.consultores IS
  'Organizacao consultora dona da carteira. Usuarios sao membros/atores, nunca donos de NFs ou operacoes.';
COMMENT ON TABLE public.consultor_usuarios IS
  'Membership de usuario em uma unica organizacao consultora, com papel interno e revogacao independente da carteira.';
COMMENT ON TABLE public.consultor_fundos IS
  'Fundos explicitamente concedidos a organizacao consultora pela administracao da plataforma.';
COMMENT ON TABLE public.consultor_cedentes IS
  'Carteira organizacional de Cedentes, sem duplicacao por usuario consultor.';

NOTIFY pgrst, 'reload schema';

COMMIT;
