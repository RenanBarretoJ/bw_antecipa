-- P2.6.6: hardening multifundo das superficies documentais, logisticas e
-- configuracoes operacionais que ainda autorizavam o papel global gestor.
-- Nenhum dado de negocio e alterado.
BEGIN;

CREATE OR REPLACE FUNCTION private.gestor_tem_acesso_fundo_operacional(p_fundo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    p_fundo_id IS NOT NULL
    AND (SELECT auth.uid()) IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.usuario_fundos uf
        ON uf.usuario_id = p.id
       AND uf.fundo_id = p_fundo_id
       AND uf.status = 'ativo'
      JOIN public.fundos f
        ON f.id = uf.fundo_id
       AND f.ativo
      WHERE p.id = (SELECT auth.uid())
        AND p.status::text = 'ativo'
        AND (
          p.role::text = 'gestor'
          OR EXISTS (
            SELECT 1
            FROM public.usuario_papeis up
            WHERE up.usuario_id = p.id
              AND up.papel::text = 'gestor'
              AND up.ativo
          )
        )
    );
$function$;

CREATE OR REPLACE FUNCTION private.usuario_tem_acesso_fundo(p_fundo_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT private.gestor_tem_acesso_fundo_operacional(p_fundo_id);
$function$;

CREATE OR REPLACE FUNCTION private.gestor_tem_acesso_contexto_documental(
  p_nota_fiscal_id uuid,
  p_entrega_id uuid,
  p_operacao_id uuid,
  p_cte_id uuid,
  p_cedente_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.notas_fiscais nf
      WHERE nf.id = p_nota_fiscal_id
        AND private.gestor_tem_acesso_fundo_operacional(nf.fundo_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.nota_fiscal_entregas entrega
      JOIN public.notas_fiscais nf ON nf.id = entrega.nota_fiscal_id
      WHERE entrega.id = p_entrega_id
        AND private.gestor_tem_acesso_fundo_operacional(nf.fundo_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.operacoes operacao
      JOIN public.cedente_fundos cf ON cf.id = operacao.cedente_fundo_id
      WHERE operacao.id = p_operacao_id
        AND private.gestor_tem_acesso_fundo_operacional(cf.fundo_id)
    )
    OR EXISTS (
      SELECT 1
      FROM public.ctes cte
      WHERE cte.id = p_cte_id
        AND (
          private.gestor_tem_acesso_fundo_operacional(cte.fundo_id)
          OR EXISTS (
            SELECT 1
            FROM public.cte_notas_fiscais cte_nf
            JOIN public.notas_fiscais nf ON nf.id = cte_nf.nota_fiscal_id
            WHERE cte_nf.cte_id = cte.id
              AND private.gestor_tem_acesso_fundo_operacional(nf.fundo_id)
          )
        )
    )
    OR (
      p_nota_fiscal_id IS NULL
      AND p_entrega_id IS NULL
      AND p_operacao_id IS NULL
      AND p_cte_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.cedente_fundos cf
        WHERE cf.cedente_id = p_cedente_id
          AND cf.status = 'ativo'
          AND private.gestor_tem_acesso_fundo_operacional(cf.fundo_id)
      )
    );
$function$;

CREATE OR REPLACE FUNCTION private.gestor_tem_acesso_documento(p_documento_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.documento_vinculos vinculo
    WHERE vinculo.documento_id = p_documento_id
      AND private.gestor_tem_acesso_contexto_documental(
        vinculo.nota_fiscal_id,
        vinculo.nota_fiscal_entrega_id,
        vinculo.operacao_id,
        vinculo.cte_id,
        vinculo.cedente_id
      )
  );
$function$;

CREATE OR REPLACE FUNCTION private.gestor_tem_acesso_requisito_documental(
  p_nota_fiscal_id uuid,
  p_entrega_id uuid,
  p_operacao_id uuid,
  p_politica_versao_id uuid,
  p_cedente_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    private.gestor_tem_acesso_contexto_documental(
      p_nota_fiscal_id,
      p_entrega_id,
      p_operacao_id,
      NULL,
      p_cedente_id
    )
    OR EXISTS (
      SELECT 1
      FROM public.politica_operacional_versoes pov
      WHERE pov.id = p_politica_versao_id
        AND private.gestor_tem_acesso_fundo_operacional(pov.fundo_id)
    );
$function$;

CREATE OR REPLACE FUNCTION private.gestor_tem_acesso_entrega(p_entrega_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.nota_fiscal_entregas entrega
    JOIN public.notas_fiscais nf ON nf.id = entrega.nota_fiscal_id
    WHERE entrega.id = p_entrega_id
      AND private.gestor_tem_acesso_fundo_operacional(nf.fundo_id)
  );
$function$;

CREATE OR REPLACE FUNCTION private.gestor_tem_acesso_cte_contexto(
  p_fundo_id uuid,
  p_cedente_fundo_id uuid,
  p_cedente_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    private.gestor_tem_acesso_fundo_operacional(p_fundo_id)
    OR EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.id = p_cedente_fundo_id
        AND cf.status = 'ativo'
        AND private.gestor_tem_acesso_fundo_operacional(cf.fundo_id)
    )
    OR (
      p_fundo_id IS NULL
      AND p_cedente_fundo_id IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.cedente_fundos cf
        WHERE cf.cedente_id = p_cedente_id
          AND cf.status = 'ativo'
          AND private.gestor_tem_acesso_fundo_operacional(cf.fundo_id)
      )
    );
$function$;

CREATE OR REPLACE FUNCTION private.gestor_tem_acesso_cte_nota(
  p_cte_id uuid,
  p_nota_fiscal_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.ctes cte
    JOIN public.notas_fiscais nf ON nf.id = p_nota_fiscal_id
    WHERE cte.id = p_cte_id
      AND (cte.fundo_id IS NULL OR cte.fundo_id = nf.fundo_id)
      AND private.gestor_tem_acesso_fundo_operacional(nf.fundo_id)
      AND private.gestor_tem_acesso_cte_contexto(
        cte.fundo_id,
        cte.cedente_fundo_id,
        cte.cedente_id
      )
  );
$function$;

REVOKE ALL ON FUNCTION private.gestor_tem_acesso_fundo_operacional(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.gestor_tem_acesso_contexto_documental(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.gestor_tem_acesso_documento(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.gestor_tem_acesso_requisito_documental(uuid,uuid,uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.gestor_tem_acesso_entrega(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.gestor_tem_acesso_cte_contexto(uuid,uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.gestor_tem_acesso_cte_nota(uuid,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.gestor_tem_acesso_fundo_operacional(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.gestor_tem_acesso_contexto_documental(uuid,uuid,uuid,uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.gestor_tem_acesso_documento(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.gestor_tem_acesso_requisito_documental(uuid,uuid,uuid,uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.gestor_tem_acesso_entrega(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.gestor_tem_acesso_cte_contexto(uuid,uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.gestor_tem_acesso_cte_nota(uuid,uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.logistica_usuario_pode_ler_entrega(p_entrega_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN public.get_user_role() = 'gestor'
      THEN private.gestor_tem_acesso_entrega(p_entrega_id)
    WHEN public.get_user_role() = 'cedente' THEN EXISTS (
      SELECT 1
      FROM public.nota_fiscal_entregas entrega
      JOIN public.operacoes operacao ON operacao.id = entrega.operacao_id
      WHERE entrega.id = p_entrega_id
        AND operacao.cedente_id = public.get_user_cedente_id()
    )
    WHEN public.get_user_role() = 'consultor' THEN EXISTS (
      SELECT 1
      FROM public.nota_fiscal_entregas entrega
      JOIN public.operacoes operacao ON operacao.id = entrega.operacao_id
      JOIN public.consultor_cedente cc ON cc.cedente_id = operacao.cedente_id
      WHERE entrega.id = p_entrega_id
        AND cc.consultor_id = (SELECT auth.uid())
    )
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.usuario_pode_ler_documento_gerado(p_documento_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN public.get_user_role() = 'gestor' THEN EXISTS (
      SELECT 1
      FROM public.documentos_gerados dg
      WHERE dg.id = p_documento_id
        AND private.gestor_tem_acesso_fundo_operacional(dg.fundo_id)
    )
    WHEN public.get_user_role() = 'cedente' THEN EXISTS (
      SELECT 1
      FROM public.documentos_gerados dg
      WHERE dg.id = p_documento_id
        AND dg.cedente_id = public.get_user_cedente_id()
    )
    WHEN public.get_user_role() = 'consultor' THEN EXISTS (
      SELECT 1
      FROM public.documentos_gerados dg
      JOIN public.consultor_cedente cc ON cc.cedente_id = dg.cedente_id
      WHERE dg.id = p_documento_id
        AND cc.consultor_id = (SELECT auth.uid())
    )
    ELSE false
  END;
$function$;

CREATE OR REPLACE FUNCTION public.usuario_pode_ler_remessa_cnab(p_remessa_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN public.get_user_role() = 'gestor' THEN EXISTS (
      SELECT 1
      FROM public.remessas_cnab remessa
      WHERE remessa.id = p_remessa_id
        AND private.gestor_tem_acesso_fundo_operacional(remessa.fundo_id)
    )
    WHEN public.get_user_role() = 'cedente' THEN EXISTS (
      SELECT 1
      FROM public.remessas_cnab remessa
      JOIN public.remessas_cnab_operacoes ro ON ro.remessa_cnab_id = remessa.id
      JOIN public.operacoes operacao ON operacao.id = ro.operacao_id
      WHERE remessa.id = p_remessa_id
        AND operacao.cedente_id = public.get_user_cedente_id()
    )
    WHEN public.get_user_role() = 'consultor' THEN EXISTS (
      SELECT 1
      FROM public.remessas_cnab remessa
      JOIN public.remessas_cnab_operacoes ro ON ro.remessa_cnab_id = remessa.id
      JOIN public.operacoes operacao ON operacao.id = ro.operacao_id
      JOIN public.consultor_cedente cc ON cc.cedente_id = operacao.cedente_id
      WHERE remessa.id = p_remessa_id
        AND cc.consultor_id = (SELECT auth.uid())
    )
    ELSE false
  END;
$function$;

-- Repositorio documental: leitura operacional multifundo; mutacoes permanecem
-- pelos RPCs transacionais ja existentes.
DROP POLICY IF EXISTS documentos_repositorio_gestor_all ON public.documentos_repositorio;
DROP POLICY IF EXISTS documentos_repositorio_gestor_multifundo_select ON public.documentos_repositorio;
CREATE POLICY documentos_repositorio_gestor_multifundo_select
  ON public.documentos_repositorio FOR SELECT TO authenticated
  USING (private.gestor_tem_acesso_documento(id));

DROP POLICY IF EXISTS documento_versoes_gestor_all ON public.documento_versoes;
DROP POLICY IF EXISTS documento_versoes_gestor_multifundo_select ON public.documento_versoes;
CREATE POLICY documento_versoes_gestor_multifundo_select
  ON public.documento_versoes FOR SELECT TO authenticated
  USING (private.gestor_tem_acesso_documento(documento_id));

DROP POLICY IF EXISTS documento_vinculos_gestor_all ON public.documento_vinculos;
DROP POLICY IF EXISTS documento_vinculos_gestor_multifundo_select ON public.documento_vinculos;
CREATE POLICY documento_vinculos_gestor_multifundo_select
  ON public.documento_vinculos FOR SELECT TO authenticated
  USING (private.gestor_tem_acesso_contexto_documental(
    nota_fiscal_id, nota_fiscal_entrega_id, operacao_id, cte_id, cedente_id
  ));

DROP POLICY IF EXISTS documento_requisito_gestor_all ON public.documento_requisito_instancias;
DROP POLICY IF EXISTS documento_requisito_gestor_multifundo_select ON public.documento_requisito_instancias;
CREATE POLICY documento_requisito_gestor_multifundo_select
  ON public.documento_requisito_instancias FOR SELECT TO authenticated
  USING (private.gestor_tem_acesso_requisito_documental(
    nota_fiscal_id,
    nota_fiscal_entrega_id,
    operacao_id,
    politica_operacional_versao_id,
    cedente_id
  ));

DROP POLICY IF EXISTS documento_analises_gestor_all ON public.documento_analises;
DROP POLICY IF EXISTS documento_analises_gestor_multifundo_select ON public.documento_analises;
CREATE POLICY documento_analises_gestor_multifundo_select
  ON public.documento_analises FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1
    FROM public.documento_versoes dv
    WHERE dv.id = documento_analises.documento_versao_id
      AND private.gestor_tem_acesso_documento(dv.documento_id)
  ));

-- Logistica por entrega/NF.
DROP POLICY IF EXISTS nota_fiscal_entregas_gestor_all ON public.nota_fiscal_entregas;
DROP POLICY IF EXISTS nota_fiscal_entregas_gestor_multifundo_all ON public.nota_fiscal_entregas;
CREATE POLICY nota_fiscal_entregas_gestor_multifundo_all
  ON public.nota_fiscal_entregas FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.notas_fiscais nf
    WHERE nf.id = nota_fiscal_entregas.nota_fiscal_id
      AND private.gestor_tem_acesso_fundo_operacional(nf.fundo_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.notas_fiscais nf
    WHERE nf.id = nota_fiscal_entregas.nota_fiscal_id
      AND private.gestor_tem_acesso_fundo_operacional(nf.fundo_id)
  ));

DROP POLICY IF EXISTS eventos_entrega_insert_gestor ON public.eventos_entrega;
DROP POLICY IF EXISTS eventos_entrega_insert_gestor_multifundo ON public.eventos_entrega;
CREATE POLICY eventos_entrega_insert_gestor_multifundo
  ON public.eventos_entrega FOR INSERT TO authenticated
  WITH CHECK (private.gestor_tem_acesso_entrega(nota_fiscal_entrega_id));

DROP POLICY IF EXISTS canhotos_gestor_all ON public.canhotos;
DROP POLICY IF EXISTS canhotos_gestor_multifundo_all ON public.canhotos;
CREATE POLICY canhotos_gestor_multifundo_all
  ON public.canhotos FOR ALL TO authenticated
  USING (private.gestor_tem_acesso_entrega(nota_fiscal_entrega_id))
  WITH CHECK (private.gestor_tem_acesso_entrega(nota_fiscal_entrega_id));

-- CT-e e vinculo CT-e x NF.
DROP POLICY IF EXISTS ctes_gestor_all ON public.ctes;
DROP POLICY IF EXISTS ctes_select ON public.ctes;
DROP POLICY IF EXISTS ctes_contexto_select ON public.ctes;
DROP POLICY IF EXISTS ctes_gestor_multifundo_all ON public.ctes;
CREATE POLICY ctes_contexto_select
  ON public.ctes FOR SELECT TO authenticated
  USING (
    (public.get_user_role() = 'cedente' AND cedente_id = public.get_user_cedente_id())
    OR (
      public.get_user_role() = 'consultor'
      AND EXISTS (
        SELECT 1 FROM public.consultor_cedente cc
        WHERE cc.consultor_id = (SELECT auth.uid())
          AND cc.cedente_id = ctes.cedente_id
      )
    )
  );
CREATE POLICY ctes_gestor_multifundo_all
  ON public.ctes FOR ALL TO authenticated
  USING (private.gestor_tem_acesso_cte_contexto(fundo_id, cedente_fundo_id, cedente_id))
  WITH CHECK (private.gestor_tem_acesso_cte_contexto(fundo_id, cedente_fundo_id, cedente_id));

DROP POLICY IF EXISTS cte_notas_gestor_all ON public.cte_notas_fiscais;
DROP POLICY IF EXISTS cte_notas_gestor_multifundo_all ON public.cte_notas_fiscais;
CREATE POLICY cte_notas_gestor_multifundo_all
  ON public.cte_notas_fiscais FOR ALL TO authenticated
  USING (private.gestor_tem_acesso_cte_nota(cte_id, nota_fiscal_id))
  WITH CHECK (private.gestor_tem_acesso_cte_nota(cte_id, nota_fiscal_id));

-- Demais superficies fund-owned encontradas pela varredura global. As policies
-- de cedente/consultor continuam intactas.
DROP POLICY IF EXISTS cedente_fundo_politicas_gestor_all ON public.cedente_fundo_politicas;
DROP POLICY IF EXISTS cedente_fundo_politicas_gestor_multifundo_all ON public.cedente_fundo_politicas;
CREATE POLICY cedente_fundo_politicas_gestor_multifundo_all
  ON public.cedente_fundo_politicas FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cedente_fundos cf
    WHERE cf.id = cedente_fundo_politicas.cedente_fundo_id
      AND private.gestor_tem_acesso_fundo_operacional(cf.fundo_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.cedente_fundos cf
    WHERE cf.id = cedente_fundo_politicas.cedente_fundo_id
      AND private.gestor_tem_acesso_fundo_operacional(cf.fundo_id)
  ));

DROP POLICY IF EXISTS politicas_operacionais_gestor_all ON public.politicas_operacionais;
DROP POLICY IF EXISTS politicas_operacionais_gestor_multifundo_all ON public.politicas_operacionais;
CREATE POLICY politicas_operacionais_gestor_multifundo_all
  ON public.politicas_operacionais FOR ALL TO authenticated
  USING (private.gestor_tem_acesso_fundo_operacional(fundo_id))
  WITH CHECK (private.gestor_tem_acesso_fundo_operacional(fundo_id));

DROP POLICY IF EXISTS politica_operacional_versoes_gestor_all ON public.politica_operacional_versoes;
DROP POLICY IF EXISTS politica_operacional_versoes_gestor_multifundo_all ON public.politica_operacional_versoes;
CREATE POLICY politica_operacional_versoes_gestor_multifundo_all
  ON public.politica_operacional_versoes FOR ALL TO authenticated
  USING (private.gestor_tem_acesso_fundo_operacional(fundo_id))
  WITH CHECK (private.gestor_tem_acesso_fundo_operacional(fundo_id));

DROP POLICY IF EXISTS politica_requisitos_gestor_all ON public.politica_requisitos_documentais;
DROP POLICY IF EXISTS politica_requisitos_gestor_multifundo_all ON public.politica_requisitos_documentais;
CREATE POLICY politica_requisitos_gestor_multifundo_all
  ON public.politica_requisitos_documentais FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.politica_operacional_versoes pov
    WHERE pov.id = politica_requisitos_documentais.politica_operacional_versao_id
      AND private.gestor_tem_acesso_fundo_operacional(pov.fundo_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.politica_operacional_versoes pov
    WHERE pov.id = politica_requisitos_documentais.politica_operacional_versao_id
      AND private.gestor_tem_acesso_fundo_operacional(pov.fundo_id)
  ));

DROP POLICY IF EXISTS templates_documentos_gestor_all ON public.templates_documentos;
DROP POLICY IF EXISTS templates_documentos_gestor_multifundo_all ON public.templates_documentos;
CREATE POLICY templates_documentos_gestor_multifundo_all
  ON public.templates_documentos FOR ALL TO authenticated
  USING (private.gestor_tem_acesso_fundo_operacional(fundo_id))
  WITH CHECK (private.gestor_tem_acesso_fundo_operacional(fundo_id));

DROP POLICY IF EXISTS template_versoes_gestor_all ON public.template_versoes;
DROP POLICY IF EXISTS template_versoes_gestor_multifundo_all ON public.template_versoes;
CREATE POLICY template_versoes_gestor_multifundo_all
  ON public.template_versoes FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.templates_documentos template
    WHERE template.id = template_versoes.template_id
      AND private.gestor_tem_acesso_fundo_operacional(template.fundo_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.templates_documentos template
    WHERE template.id = template_versoes.template_id
      AND private.gestor_tem_acesso_fundo_operacional(template.fundo_id)
  ));

DROP POLICY IF EXISTS documentos_gerados_gestor_all ON public.documentos_gerados;
DROP POLICY IF EXISTS documentos_gerados_gestor_multifundo_all ON public.documentos_gerados;
CREATE POLICY documentos_gerados_gestor_multifundo_all
  ON public.documentos_gerados FOR ALL TO authenticated
  USING (private.gestor_tem_acesso_fundo_operacional(fundo_id))
  WITH CHECK (private.gestor_tem_acesso_fundo_operacional(fundo_id));

DROP POLICY IF EXISTS remessas_cnab_gestor_all ON public.remessas_cnab;
DROP POLICY IF EXISTS remessas_cnab_gestor_multifundo_all ON public.remessas_cnab;
CREATE POLICY remessas_cnab_gestor_multifundo_all
  ON public.remessas_cnab FOR ALL TO authenticated
  USING (private.gestor_tem_acesso_fundo_operacional(fundo_id))
  WITH CHECK (private.gestor_tem_acesso_fundo_operacional(fundo_id));

DROP POLICY IF EXISTS remessas_cnab_operacoes_gestor_all ON public.remessas_cnab_operacoes;
DROP POLICY IF EXISTS remessas_cnab_operacoes_gestor_multifundo_all ON public.remessas_cnab_operacoes;
CREATE POLICY remessas_cnab_operacoes_gestor_multifundo_all
  ON public.remessas_cnab_operacoes FOR ALL TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.remessas_cnab remessa
    WHERE remessa.id = remessas_cnab_operacoes.remessa_cnab_id
      AND private.gestor_tem_acesso_fundo_operacional(remessa.fundo_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.remessas_cnab remessa
    WHERE remessa.id = remessas_cnab_operacoes.remessa_cnab_id
      AND private.gestor_tem_acesso_fundo_operacional(remessa.fundo_id)
  ));

DROP POLICY IF EXISTS sequencias_remessa_gestor_select ON public.sequencias_remessa;
DROP POLICY IF EXISTS sequencias_remessa_gestor_multifundo_select ON public.sequencias_remessa;
CREATE POLICY sequencias_remessa_gestor_multifundo_select
  ON public.sequencias_remessa FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.configuracoes_cnab configuracao
    WHERE configuracao.id = sequencias_remessa.configuracao_cnab_id
      AND private.gestor_tem_acesso_fundo_operacional(configuracao.fundo_id)
  ));

DROP POLICY IF EXISTS storage_docs_gestor_insert ON storage.objects;
DROP POLICY IF EXISTS storage_docs_gestor_insert_multifundo ON storage.objects;
CREATE POLICY storage_docs_gestor_insert_multifundo
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'documentos-cedentes'
    AND EXISTS (
      SELECT 1
      FROM public.cedentes cedente
      JOIN public.cedente_fundos cf
        ON cf.cedente_id = cedente.id
       AND cf.status = 'ativo'
      WHERE regexp_replace(coalesce(cedente.cnpj, ''), '\D', '', 'g') =
            regexp_replace(coalesce((storage.foldername(name))[1], ''), '\D', '', 'g')
        AND private.gestor_tem_acesso_fundo_operacional(cf.fundo_id)
    )
  );

NOTIFY pgrst, 'reload schema';
COMMIT;
