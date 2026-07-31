-- Escopo 9C: fecha a leitura cruzada dos buckets privados.
--
-- A URL assinada nao e uma decisao de autorizacao. O Storage so permite
-- assinar/listar um objeto quando o caminho esta registrado no dominio e o
-- usuario autenticado possui acesso a entidade correspondente.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('private.usuario_tem_acesso_fundo(uuid)') IS NULL
     OR to_regprocedure('private.consultor_tem_acesso_cedente(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Pre-condicoes do Escopo 9C ausentes: helpers privados do Escopo 9B.';
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_notas_fiscais_storage_path
  ON public.notas_fiscais(arquivo_url)
  WHERE arquivo_url IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documentos_storage_path
  ON public.documentos(url_arquivo)
  WHERE url_arquivo IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documento_versoes_storage_object
  ON public.documento_versoes(bucket, path);

CREATE INDEX IF NOT EXISTS idx_documentos_gerados_storage_object
  ON public.documentos_gerados(bucket, storage_path);

CREATE INDEX IF NOT EXISTS idx_remessas_cnab_storage_object
  ON public.remessas_cnab(bucket, storage_path);

CREATE INDEX IF NOT EXISTS idx_retornos_integracao_storage_object
  ON public.retornos_integracao(bucket, storage_path);

CREATE OR REPLACE FUNCTION private.usuario_pode_ler_objeto_storage(
  p_bucket text,
  p_path text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, private
AS $$
DECLARE
  v_role text := public.get_user_role();
  v_cedente_id uuid := public.get_user_cedente_id();
BEGIN
  IF auth.uid() IS NULL OR p_bucket IS NULL OR p_path IS NULL THEN
    RETURN false;
  END IF;

  IF p_bucket = 'notas-fiscais' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.notas_fiscais nf
      WHERE nf.arquivo_url = p_path
        AND (
          (v_role = 'gestor' AND private.usuario_tem_acesso_fundo(nf.fundo_id))
          OR (v_role = 'cedente' AND nf.cedente_id = v_cedente_id)
          OR (v_role = 'consultor' AND private.consultor_tem_acesso_cedente(nf.cedente_id))
          OR (
            v_role = 'sacado'
            AND regexp_replace(coalesce(nf.cnpj_destinatario, ''), '\D', '', 'g') = (
              SELECT regexp_replace(coalesce(s.cnpj, ''), '\D', '', 'g')
              FROM public.sacados s
              WHERE s.user_id = auth.uid()
              LIMIT 1
            )
          )
        )
    );
  END IF;

  IF p_bucket = 'documentos-v2' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.documento_versoes dv
      JOIN public.documento_vinculos vinculo
        ON vinculo.documento_id = dv.documento_id
      WHERE dv.bucket = p_bucket
        AND dv.path = p_path
        AND (
          (v_role = 'cedente' AND vinculo.cedente_id = v_cedente_id)
          OR (
            v_role = 'consultor'
            AND private.consultor_tem_acesso_cedente(vinculo.cedente_id)
          )
          OR (
            v_role = 'gestor'
            AND (
              EXISTS (
                SELECT 1
                FROM public.notas_fiscais nf
                WHERE nf.id = vinculo.nota_fiscal_id
                  AND private.usuario_tem_acesso_fundo(nf.fundo_id)
              )
              OR EXISTS (
                SELECT 1
                FROM public.nota_fiscal_entregas entrega
                JOIN public.notas_fiscais nf ON nf.id = entrega.nota_fiscal_id
                WHERE entrega.id = vinculo.nota_fiscal_entrega_id
                  AND private.usuario_tem_acesso_fundo(nf.fundo_id)
              )
              OR EXISTS (
                SELECT 1
                FROM public.operacoes operacao
                JOIN public.cedente_fundos cf ON cf.id = operacao.cedente_fundo_id
                WHERE operacao.id = vinculo.operacao_id
                  AND private.usuario_tem_acesso_fundo(cf.fundo_id)
              )
              OR EXISTS (
                SELECT 1
                FROM public.cte_notas_fiscais cte_nf
                JOIN public.notas_fiscais nf ON nf.id = cte_nf.nota_fiscal_id
                WHERE cte_nf.cte_id = vinculo.cte_id
                  AND private.usuario_tem_acesso_fundo(nf.fundo_id)
              )
              OR (
                vinculo.nota_fiscal_id IS NULL
                AND vinculo.nota_fiscal_entrega_id IS NULL
                AND vinculo.operacao_id IS NULL
                AND vinculo.cte_id IS NULL
                AND EXISTS (
                  SELECT 1
                  FROM public.cedente_fundos cf
                  WHERE cf.cedente_id = vinculo.cedente_id
                    AND cf.status = 'ativo'
                    AND private.usuario_tem_acesso_fundo(cf.fundo_id)
                )
              )
            )
          )
        )
    );
  END IF;

  IF p_bucket = 'documentos-cedentes' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.documentos documento
      WHERE documento.url_arquivo = p_path
        AND (
          (v_role = 'cedente' AND documento.cedente_id = v_cedente_id)
          OR (v_role = 'consultor' AND private.consultor_tem_acesso_cedente(documento.cedente_id))
          OR (
            v_role = 'gestor'
            AND EXISTS (
              SELECT 1
              FROM public.cedente_fundos cf
              WHERE cf.cedente_id = documento.cedente_id
                AND cf.status = 'ativo'
                AND private.usuario_tem_acesso_fundo(cf.fundo_id)
            )
          )
        )
    );
  END IF;

  IF p_bucket = 'contratos' THEN
    RETURN EXISTS (
      SELECT 1
      FROM public.documentos_gerados documento
      WHERE documento.bucket = p_bucket
        AND documento.storage_path = p_path
        AND (
          (v_role = 'gestor' AND private.usuario_tem_acesso_fundo(documento.fundo_id))
          OR (v_role = 'cedente' AND documento.cedente_id = v_cedente_id)
          OR (v_role = 'consultor' AND private.consultor_tem_acesso_cedente(documento.cedente_id))
        )
    );
  END IF;

  IF p_bucket = 'remessas-cnab' THEN
    RETURN v_role = 'gestor' AND EXISTS (
      SELECT 1
      FROM public.remessas_cnab remessa
      WHERE remessa.bucket = p_bucket
        AND remessa.storage_path = p_path
        AND private.usuario_tem_acesso_fundo(remessa.fundo_id)
    );
  END IF;

  IF p_bucket = 'retornos-integracao' THEN
    RETURN v_role = 'gestor' AND EXISTS (
      SELECT 1
      FROM public.retornos_integracao retorno
      WHERE retorno.bucket = p_bucket
        AND retorno.storage_path = p_path
        AND private.usuario_tem_acesso_fundo(retorno.fundo_id)
    );
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION private.usuario_pode_ler_objeto_storage(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.usuario_pode_ler_objeto_storage(text, text) TO authenticated;

-- Policies permissivas sao combinadas por OR. Todas as policies SELECT
-- anteriores precisam ser removidas para que nenhuma regra ampla por papel
-- anule a autorizacao por entidade/fundo acima.
DROP POLICY IF EXISTS storage_documentos_v2_select ON storage.objects;
DROP POLICY IF EXISTS storage_nfs_cedente_select ON storage.objects;
DROP POLICY IF EXISTS storage_nfs_gestor_select ON storage.objects;
DROP POLICY IF EXISTS storage_nfs_consultor_select ON storage.objects;
DROP POLICY IF EXISTS storage_nfs_sacado_select ON storage.objects;
DROP POLICY IF EXISTS storage_docs_cedente_select ON storage.objects;
DROP POLICY IF EXISTS storage_docs_gestor_select ON storage.objects;
DROP POLICY IF EXISTS storage_docs_consultor_select ON storage.objects;
DROP POLICY IF EXISTS storage_contratos_cedente_select ON storage.objects;
DROP POLICY IF EXISTS storage_contratos_consultor_select ON storage.objects;
DROP POLICY IF EXISTS storage_contratos_gestor_all ON storage.objects;
DROP POLICY IF EXISTS storage_private_objects_select_authorized ON storage.objects;

CREATE POLICY storage_private_objects_select_authorized
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    private.usuario_pode_ler_objeto_storage(storage.objects.bucket_id, storage.objects.name)
  );

COMMIT;
