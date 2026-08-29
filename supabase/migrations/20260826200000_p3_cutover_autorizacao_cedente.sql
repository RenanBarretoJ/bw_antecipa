BEGIN;

-- P3: cedente_acessos e a fonte canonica efetiva de autorizacao.
-- cedentes.user_id permanece apenas como fallback para pares ainda nao
-- migrados. Uma associacao existente, mesmo REVOGADA, desativa o fallback.

CREATE OR REPLACE FUNCTION public.get_user_cedente_perfil_canonico()
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
    RETURN v_perfil;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.cedentes c
     WHERE c.id = v_cedente_id
       AND c.user_id = v_user_id
       AND NOT EXISTS (
         SELECT 1
           FROM public.cedente_acessos ca
          WHERE ca.user_id = v_user_id
            AND ca.cedente_id = v_cedente_id
       )
  ) THEN
    RETURN 'ADMIN';
  END IF;

  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_cedente_perfil_canonico() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_cedente_perfil_canonico() TO authenticated, service_role;

COMMENT ON FUNCTION public.get_user_cedente_perfil_canonico() IS
  'Retorna ADMIN ou OPERACIONAL para a associacao ATIVA resolvida; owner legado e fallback somente sem qualquer associacao do par.';

-- ADMIN tambem satisfaz o escopo operacional. Este helper nao concede
-- acesso administrativo ao perfil OPERACIONAL.
CREATE OR REPLACE FUNCTION private.usuario_e_operacional_cedente(p_cedente_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.usuario_tem_acesso_cedente(p_cedente_id);
$function$;

REVOKE ALL ON FUNCTION private.usuario_e_operacional_cedente(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.usuario_e_operacional_cedente(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION private.usuario_e_operacional_cedente(uuid) IS
  'Autoriza o escopo operacional para ADMIN ou OPERACIONAL ATIVO, com fallback legado controlado.';

-- Policies owner-only/cadastrais.
DROP POLICY IF EXISTS cedentes_own_insert ON public.cedentes;
DROP POLICY IF EXISTS cedentes_own_select ON public.cedentes;
DROP POLICY IF EXISTS cedentes_own_update ON public.cedentes;

DROP POLICY IF EXISTS representantes_cedente_insert ON public.representantes;
CREATE POLICY representantes_cedente_insert ON public.representantes
  FOR INSERT TO authenticated
  WITH CHECK (private.usuario_e_admin_cedente(cedente_id));

DROP POLICY IF EXISTS representantes_cedente_update ON public.representantes;
CREATE POLICY representantes_cedente_update ON public.representantes
  FOR UPDATE TO authenticated
  USING (private.usuario_e_admin_cedente(cedente_id))
  WITH CHECK (private.usuario_e_admin_cedente(cedente_id));

DROP POLICY IF EXISTS representantes_cedente_delete ON public.representantes;
CREATE POLICY representantes_cedente_delete ON public.representantes
  FOR DELETE TO authenticated
  USING (private.usuario_e_admin_cedente(cedente_id));

DROP POLICY IF EXISTS documentos_cedente_insert ON public.documentos;
CREATE POLICY documentos_cedente_insert ON public.documentos
  FOR INSERT TO authenticated
  WITH CHECK (private.usuario_e_admin_cedente(cedente_id));

DROP POLICY IF EXISTS documentos_cedente_update ON public.documentos;
CREATE POLICY documentos_cedente_update ON public.documentos
  FOR UPDATE TO authenticated
  USING (private.usuario_e_admin_cedente(cedente_id))
  WITH CHECK (private.usuario_e_admin_cedente(cedente_id));

DROP POLICY IF EXISTS sac_cedente_insert ON public.solicitacoes_alteracao_cedente;
CREATE POLICY sac_cedente_insert ON public.solicitacoes_alteracao_cedente
  FOR INSERT TO authenticated
  WITH CHECK (private.usuario_e_admin_cedente(cedente_id));

DROP POLICY IF EXISTS ca_cedente_select ON public.cedente_acessos;
CREATE POLICY ca_cedente_select ON public.cedente_acessos
  FOR SELECT TO authenticated
  USING (private.usuario_e_admin_cedente(cedente_id));

-- Bucket cadastral: somente ADMIN. O bucket de NFs continua operacional.
DROP POLICY IF EXISTS storage_docs_cedente_insert ON storage.objects;
CREATE POLICY storage_docs_cedente_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documentos-cedentes'
    AND public.get_user_role() = 'cedente'
    AND private.usuario_e_admin_cedente(public.get_user_cedente_id())
    AND (storage.foldername(name))[1] = (
      SELECT c.cnpj FROM public.cedentes c WHERE c.id = public.get_user_cedente_id()
    )
  );

DROP POLICY IF EXISTS storage_docs_cedente_update ON storage.objects;
CREATE POLICY storage_docs_cedente_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'documentos-cedentes'
    AND public.get_user_role() = 'cedente'
    AND private.usuario_e_admin_cedente(public.get_user_cedente_id())
    AND (storage.foldername(name))[1] = (
      SELECT c.cnpj FROM public.cedentes c WHERE c.id = public.get_user_cedente_id()
    )
  )
  WITH CHECK (
    bucket_id = 'documentos-cedentes'
    AND public.get_user_role() = 'cedente'
    AND private.usuario_e_admin_cedente(public.get_user_cedente_id())
    AND (storage.foldername(name))[1] = (
      SELECT c.cnpj FROM public.cedentes c WHERE c.id = public.get_user_cedente_id()
    )
  );

DROP POLICY IF EXISTS storage_docs_cedente_delete_orphan ON storage.objects;
CREATE POLICY storage_docs_cedente_delete_orphan ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'documentos-cedentes'
    AND public.get_user_role() = 'cedente'
    AND private.usuario_e_admin_cedente(public.get_user_cedente_id())
    AND owner_id = auth.uid()::text
    AND (storage.foldername(name))[1] = (
      SELECT c.cnpj FROM public.cedentes c WHERE c.id = public.get_user_cedente_id()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.documentos d WHERE d.url_arquivo = storage.objects.name
    )
  );

DROP POLICY IF EXISTS storage_docs_cedente_select_orphan_own ON storage.objects;
CREATE POLICY storage_docs_cedente_select_orphan_own ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'documentos-cedentes'
    AND public.get_user_role() = 'cedente'
    AND private.usuario_e_admin_cedente(public.get_user_cedente_id())
    AND owner_id = auth.uid()::text
    AND (storage.foldername(name))[1] = (
      SELECT c.cnpj FROM public.cedentes c WHERE c.id = public.get_user_cedente_id()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.documentos d WHERE d.url_arquivo = storage.objects.name
    )
  );

-- Corrige RPCs vivas sem duplicar suas regras de dominio. A migration falha
-- fechada se a definicao esperada divergir, evitando patch silencioso.
CREATE OR REPLACE FUNCTION private.p3_substituir_trecho_funcao(
  p_assinatura text,
  p_trecho_antigo text,
  p_trecho_novo text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_oid regprocedure;
  v_definicao text;
  v_nova_definicao text;
BEGIN
  v_oid := pg_catalog.to_regprocedure(p_assinatura);
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'P3: funcao nao encontrada: %', p_assinatura;
  END IF;

  v_definicao := pg_catalog.pg_get_functiondef(v_oid);
  IF position(p_trecho_antigo IN v_definicao) = 0 THEN
    RAISE EXCEPTION 'P3: trecho esperado nao encontrado em %', p_assinatura;
  END IF;

  v_nova_definicao := pg_catalog.replace(v_definicao, p_trecho_antigo, p_trecho_novo);
  EXECUTE v_nova_definicao;
END;
$function$;

REVOKE ALL ON FUNCTION private.p3_substituir_trecho_funcao(text,text,text) FROM PUBLIC, anon, authenticated;

SELECT private.p3_substituir_trecho_funcao(
  'public.cadastrar_filial_cedente(text,text,text,text,text,text,text,text,text,text,text,text,text,text,text)',
  'private.usuario_tem_acesso_cedente(v_cedente_id)',
  'private.usuario_e_admin_cedente(v_cedente_id)'
);

SELECT private.p3_substituir_trecho_funcao(
  'public.salvar_conta_estabelecimento_cedente(uuid,text,text,text,text,boolean,text,text,text)',
  'private.usuario_tem_acesso_cedente(v_estabelecimento.cedente_id)',
  'private.usuario_e_admin_cedente(v_estabelecimento.cedente_id)'
);

SELECT private.p3_substituir_trecho_funcao(
  'public.registrar_documento_estabelecimento_upload(uuid,uuid,uuid,text,text,bigint,text,text,text,uuid)',
  'private.usuario_tem_acesso_cedente(v_estabelecimento.cedente_id)',
  'private.usuario_e_admin_cedente(v_estabelecimento.cedente_id)'
);

SELECT private.p3_substituir_trecho_funcao(
  'public.registrar_documento_logistico_antecipado(uuid[],uuid,text,text,text,bigint,text,text,text,jsonb)',
  'JOIN public.cedentes c ON c.id = nf.cedente_id AND c.user_id = actor_id',
  'JOIN public.cedentes c ON c.id = nf.cedente_id AND private.usuario_tem_acesso_cedente(c.id)'
);

SELECT private.p3_substituir_trecho_funcao(
  'public.usuario_pode_ler_integracao_execucao(uuid)',
  'WHERE e.id = p_execucao_id AND c.user_id = (SELECT auth.uid())',
  'WHERE e.id = p_execucao_id AND private.usuario_tem_acesso_cedente(c.id)'
);

SELECT private.p3_substituir_trecho_funcao(
  'public.solicitar_alteracao_cadastral_cedente(jsonb,jsonb,jsonb,jsonb)',
  $old$IF v_owner_user_id IS DISTINCT FROM (SELECT auth.uid())
     AND public.get_user_cedente_acesso_perfil() IS DISTINCT FROM 'administrador' THEN
    RAISE EXCEPTION 'Sem permissao para solicitar alteracoes cadastrais.' USING ERRCODE = '42501';
  END IF;$old$,
  $new$IF NOT private.usuario_e_admin_cedente(v_cedente_id) THEN
    RAISE EXCEPTION 'Sem permissao para solicitar alteracoes cadastrais.' USING ERRCODE = '42501';
  END IF;$new$
);

SELECT private.p3_substituir_trecho_funcao(
  'public.registrar_documento_cadastral_cedente(public.documento_tipo,text,text,uuid)',
  $old$IF v_cedente_user_id IS DISTINCT FROM v_user_id
     AND NOT EXISTS (
       SELECT 1
       FROM public.cedente_acessos acesso
       WHERE acesso.cedente_id = v_cedente_id
         AND acesso.user_id = v_user_id
         AND acesso.ativo = true
         AND acesso.perfil = 'administrador'
     ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente administrador do cedente pode registrar documento cadastral.';
  END IF;$old$,
  $new$IF NOT private.usuario_e_admin_cedente(v_cedente_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Somente ADMIN ativo do cedente pode registrar documento cadastral.';
  END IF;$new$
);

DROP FUNCTION private.p3_substituir_trecho_funcao(text,text,text);

NOTIFY pgrst, 'reload schema';

COMMIT;
