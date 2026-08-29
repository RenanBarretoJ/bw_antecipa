-- SA0: fundacao do Super Admin e bootstrap administrativo.
-- O papel de plataforma e complementar. O papel primario em profiles continua
-- sendo a fonte das policies operacionais existentes e nao concede bypass de fundo.

CREATE TABLE IF NOT EXISTS public.usuario_papeis (
  usuario_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  papel public.user_role NOT NULL,
  ativo boolean NOT NULL DEFAULT true,
  origem text NOT NULL DEFAULT 'perfil_primario',
  atribuido_por uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  atribuido_em timestamptz NOT NULL DEFAULT now(),
  revogado_em timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT usuario_papeis_pkey PRIMARY KEY (usuario_id, papel),
  CONSTRAINT usuario_papeis_origem_check CHECK (origem IN ('perfil_primario', 'bootstrap_homolog', 'administracao')),
  CONSTRAINT usuario_papeis_revogacao_check CHECK (
    (ativo = true AND revogado_em IS NULL)
    OR (ativo = false AND revogado_em IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS usuario_papeis_papel_ativo_idx
  ON public.usuario_papeis (papel, usuario_id)
  WHERE ativo = true;

DROP TRIGGER IF EXISTS usuario_papeis_updated_at ON public.usuario_papeis;
CREATE TRIGGER usuario_papeis_updated_at
  BEFORE UPDATE ON public.usuario_papeis
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

ALTER TABLE public.usuario_papeis ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS usuario_papeis_select_own ON public.usuario_papeis;
CREATE POLICY usuario_papeis_select_own
  ON public.usuario_papeis
  FOR SELECT
  TO authenticated
  USING (usuario_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.usuario_papeis FROM anon, authenticated;
GRANT SELECT ON TABLE public.usuario_papeis TO authenticated;
GRANT ALL ON TABLE public.usuario_papeis TO service_role;

CREATE TABLE IF NOT EXISTS public.plataforma_auditoria (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo_evento text NOT NULL,
  ator_usuario_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  usuario_alvo_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  origem text NOT NULL,
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  dados jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT plataforma_auditoria_dados_check CHECK (jsonb_typeof(dados) = 'object')
);

CREATE INDEX IF NOT EXISTS plataforma_auditoria_created_at_idx
  ON public.plataforma_auditoria (created_at DESC);

CREATE INDEX IF NOT EXISTS plataforma_auditoria_usuario_alvo_idx
  ON public.plataforma_auditoria (usuario_alvo_id, created_at DESC);

ALTER TABLE public.plataforma_auditoria ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.plataforma_auditoria FROM anon, authenticated;
GRANT ALL ON TABLE public.plataforma_auditoria TO service_role;

CREATE OR REPLACE FUNCTION public.sincronizar_papel_primario_usuario()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- super_admin somente pode ser materializado pela RPC administrativa. Isso
  -- impede que metadata do Auth se torne fonte de autorizacao administrativa.
  IF NEW.role::text <> 'super_admin' THEN
    INSERT INTO public.usuario_papeis (
      usuario_id,
      papel,
      ativo,
      origem,
      atribuido_em,
      revogado_em
    )
    VALUES (
      NEW.id,
      NEW.role,
      true,
      'perfil_primario',
      now(),
      NULL
    )
    ON CONFLICT (usuario_id, papel) DO UPDATE
      SET ativo = true,
          revogado_em = NULL,
          updated_at = now();
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role THEN
    UPDATE public.usuario_papeis
       SET ativo = false,
           revogado_em = now(),
           updated_at = now()
     WHERE usuario_id = NEW.id
       AND papel = OLD.role
       AND origem = 'perfil_primario';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.sincronizar_papel_primario_usuario() FROM PUBLIC;

DROP TRIGGER IF EXISTS profiles_sincronizar_papel_primario ON public.profiles;
CREATE TRIGGER profiles_sincronizar_papel_primario
  AFTER INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sincronizar_papel_primario_usuario();

INSERT INTO public.usuario_papeis (usuario_id, papel, ativo, origem)
SELECT p.id, p.role, true, 'perfil_primario'
FROM public.profiles p
WHERE p.role::text <> 'super_admin'
ON CONFLICT (usuario_id, papel) DO UPDATE
  SET ativo = true,
      revogado_em = NULL,
      updated_at = now();

CREATE OR REPLACE FUNCTION public.proteger_papel_primario_profile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND auth.uid() IS NOT NULL
     AND COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'O papel primario nao pode ser alterado pelo proprio usuario'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.proteger_papel_primario_profile() FROM PUBLIC;

DROP TRIGGER IF EXISTS profiles_proteger_papel_primario ON public.profiles;
CREATE TRIGGER profiles_proteger_papel_primario
  BEFORE UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.proteger_papel_primario_profile();

-- O trigger legado de signup aceitava role vindo de raw_user_meta_data. Os
-- papeis operacionais preexistentes permanecem compativeis, mas super_admin
-- nunca pode nascer de metadata editavel pelo cliente.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.user_role;
  v_role_metadata text := COALESCE(NEW.raw_user_meta_data->>'role', 'cedente');
BEGIN
  v_role := CASE
    WHEN v_role_metadata IN ('gestor', 'cedente', 'sacado', 'consultor')
      THEN v_role_metadata::public.user_role
    ELSE 'cedente'::public.user_role
  END;

  INSERT INTO public.profiles (id, email, nome_completo, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'nome_completo', NEW.email),
    v_role
  );
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC;

-- As policies e os grants cadastrais existentes permanecem inalterados. A
-- protecao contra escalacao ocorre no banco pelo trigger acima, inclusive para
-- UPDATE direto feito por um usuario autenticado.

CREATE OR REPLACE FUNCTION public.provisionar_super_admin_homolog(
  p_usuario_id uuid,
  p_project_ref text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role public.user_role;
  v_ja_ativo boolean;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Operacao permitida somente para rotina administrativa server-side'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(trim(p_project_ref), '') = ''
     OR p_project_ref !~ '^[a-z0-9]{10,32}$' THEN
    RAISE EXCEPTION 'Project ref de homologacao invalido'
      USING ERRCODE = '22023';
  END IF;

  SELECT p.role
    INTO v_role
    FROM public.profiles p
   WHERE p.id = p_usuario_id
     AND p.status = 'ativo';

  IF v_role IS NULL THEN
    RAISE EXCEPTION 'Perfil ativo nao encontrado para o bootstrap'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_role::text NOT IN ('gestor', 'super_admin') THEN
    RAISE EXCEPTION 'Perfil primario incompativel com o bootstrap administrativo'
      USING ERRCODE = '22023';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM public.usuario_papeis up
     WHERE up.usuario_id = p_usuario_id
       AND up.papel::text = 'super_admin'
       AND up.ativo = true
  ) INTO v_ja_ativo;

  INSERT INTO public.usuario_papeis (
    usuario_id,
    papel,
    ativo,
    origem,
    atribuido_por,
    atribuido_em,
    revogado_em
  )
  VALUES (
    p_usuario_id,
    'super_admin'::public.user_role,
    true,
    'bootstrap_homolog',
    NULL,
    now(),
    NULL
  )
  ON CONFLICT (usuario_id, papel) DO UPDATE
    SET ativo = true,
        origem = 'bootstrap_homolog',
        atribuido_por = EXCLUDED.atribuido_por,
        atribuido_em = now(),
        revogado_em = NULL,
        updated_at = now();

  INSERT INTO public.plataforma_auditoria (
    tipo_evento,
    ator_usuario_id,
    usuario_alvo_id,
    origem,
    dados
  )
  VALUES (
    CASE WHEN v_ja_ativo THEN 'SUPER_ADMIN_BOOTSTRAP_REVALIDADO' ELSE 'SUPER_ADMIN_BOOTSTRAP_PROVISIONADO' END,
    NULL,
    p_usuario_id,
    'bootstrap',
    jsonb_build_object(
      'ator_tecnico', 'bootstrap_service_role',
      'ambiente', 'homologacao',
      'project_ref', trim(p_project_ref),
      'perfil_primario', v_role::text,
      'papel_ja_estava_ativo', v_ja_ativo
    )
  );

  RETURN jsonb_build_object(
    'usuario_id', p_usuario_id,
    'perfil_primario', v_role::text,
    'papel', 'super_admin',
    'ja_estava_ativo', v_ja_ativo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.provisionar_super_admin_homolog(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provisionar_super_admin_homolog(uuid, text) TO service_role;

COMMENT ON TABLE public.usuario_papeis IS
  'Papeis complementares do usuario. Nao substitui o papel primario usado pelas RLS operacionais.';
COMMENT ON TABLE public.plataforma_auditoria IS
  'Trilha minima de eventos administrativos de plataforma, gravada por rotinas server-side autorizadas.';
