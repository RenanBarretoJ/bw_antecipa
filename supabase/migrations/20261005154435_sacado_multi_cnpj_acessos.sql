-- SACADO R2: apply only through the reviewed explicit Preview allowlist.
-- No financial rows, snapshots, Storage objects or historical acceptance are changed.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.sacados ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.sacados DROP CONSTRAINT sacados_user_id_fkey;
ALTER TABLE public.sacados ADD CONSTRAINT sacados_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
-- Keep the stored legacy representation, but prohibit formatted duplicates.
CREATE UNIQUE INDEX sacados_cnpj_normalizado_unique
  ON public.sacados ((regexp_replace(cnpj, '\D', '', 'g')));
ALTER TABLE public.sacados ADD CONSTRAINT sacados_cnpj_completo_check
  CHECK (regexp_replace(cnpj, '\D', '', 'g') ~ '^[0-9]{14}$');

CREATE TABLE public.sacado_acessos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  sacado_id uuid NOT NULL REFERENCES public.sacados(id) ON DELETE RESTRICT,
  fundo_id uuid NOT NULL REFERENCES public.fundos(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'inativo', 'revogado')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT sacado_acessos_vinculo_unique UNIQUE (user_id, sacado_id, fundo_id),
  CONSTRAINT sacado_acessos_revogacao_check CHECK ((status = 'revogado') = (revoked_at IS NOT NULL))
);
CREATE INDEX sacado_acessos_empresa_idx ON public.sacado_acessos(sacado_id, fundo_id);
CREATE INDEX sacado_acessos_fundo_idx ON public.sacado_acessos(fundo_id, user_id);
CREATE INDEX sacado_acessos_ativos_idx ON public.sacado_acessos(user_id, fundo_id, sacado_id) WHERE status = 'ativo';
ALTER TABLE public.sacado_acessos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sacado_acessos FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sacado_acessos TO authenticated;
GRANT ALL ON public.sacado_acessos TO service_role;

-- Backfill evidence is deliberately exact-CNPJ and must resolve to one fund.
DO $$
DECLARE legacy record; funds uuid[];
BEGIN
  FOR legacy IN SELECT s.*, p.role::text profile_role FROM public.sacados s
    LEFT JOIN public.profiles p ON p.id = s.user_id WHERE s.user_id IS NOT NULL
  LOOP
    IF legacy.profile_role IS DISTINCT FROM 'sacado' THEN
      RAISE EXCEPTION 'SACADO_BACKFILL_PROFILE_REVIEW_REQUIRED';
    END IF;
    SELECT array_agg(DISTINCT e.fundo_id) FILTER (WHERE e.fundo_id IS NOT NULL) INTO funds
    FROM (
      SELECT nf.fundo_id FROM public.notas_fiscais nf
       WHERE regexp_replace(nf.cnpj_destinatario, '\D', '', 'g') = regexp_replace(legacy.cnpj, '\D', '', 'g')
      UNION
      SELECT cf.fundo_id FROM public.notas_fiscais nf
      JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id = nf.id
      JOIN public.operacoes op ON op.id = onf.operacao_id
      JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
       WHERE regexp_replace(nf.cnpj_destinatario, '\D', '', 'g') = regexp_replace(legacy.cnpj, '\D', '', 'g')
    ) e;
    IF coalesce(cardinality(funds), 0) <> 1 THEN
      RAISE EXCEPTION 'SACADO_BACKFILL_FUND_REVIEW_REQUIRED';
    END IF;
    -- Secondary registration evidence must not contradict operational evidence.
    IF EXISTS (SELECT 1 FROM public.cedentes c JOIN public.cedente_fundos cf ON cf.cedente_id = c.id
      WHERE regexp_replace(c.sacado_cnpj, '\D', '', 'g') = regexp_replace(legacy.cnpj, '\D', '', 'g')
        AND cf.fundo_id <> funds[1]) THEN
      RAISE EXCEPTION 'SACADO_BACKFILL_CONFLICTING_FUND';
    END IF;
    INSERT INTO public.sacado_acessos(user_id, sacado_id, fundo_id)
    VALUES (legacy.user_id, legacy.id, funds[1]) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- Private definer lookup avoids circular RLS; actor is always auth.uid(), never input.
CREATE FUNCTION private.sacado_contexto()
RETURNS TABLE(user_id uuid, sacado_id uuid, cnpj text, razao_social text, fundo_id uuid, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT a.user_id, a.sacado_id, regexp_replace(s.cnpj, '\D', '', 'g'), s.razao_social, a.fundo_id, a.status
  FROM public.sacado_acessos a JOIN public.sacados s ON s.id = a.sacado_id
  JOIN public.profiles p ON p.id = a.user_id
  JOIN public.fundos f ON f.id = a.fundo_id AND f.ativo
  WHERE a.user_id = (SELECT auth.uid()) AND a.status = 'ativo'
    AND p.status::text = 'ativo' AND p.role::text = 'sacado';
$$;
REVOKE ALL ON FUNCTION private.sacado_contexto() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.sacado_contexto() TO authenticated;
CREATE FUNCTION public.get_user_sacado_context()
RETURNS TABLE(user_id uuid, sacado_id uuid, cnpj text, razao_social text, fundo_id uuid, status text)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT * FROM private.sacado_contexto(); $$;
REVOKE ALL ON FUNCTION public.get_user_sacado_context() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_sacado_context() TO authenticated;

CREATE FUNCTION private.sacado_tem_acesso_cnpj_fundo(p_cnpj text, p_fundo_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM private.sacado_contexto() c
    WHERE c.cnpj = regexp_replace(p_cnpj, '\D', '', 'g') AND c.fundo_id = p_fundo_id);
$$;
CREATE FUNCTION private.sacado_tem_acesso_nf(p_nf_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.notas_fiscais nf WHERE nf.id = p_nf_id
    AND private.sacado_tem_acesso_cnpj_fundo(nf.cnpj_destinatario, nf.fundo_id));
$$;
CREATE OR REPLACE FUNCTION private.sacado_tem_acesso_operacao_nf(p_operacao_id uuid, p_nota_fiscal_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.operacoes_nfs onf
    JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
    JOIN public.operacoes op ON op.id = onf.operacao_id
    JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
    WHERE onf.operacao_id = p_operacao_id AND nf.id = p_nota_fiscal_id
      AND nf.fundo_id = cf.fundo_id
      AND private.sacado_tem_acesso_cnpj_fundo(nf.cnpj_destinatario, cf.fundo_id));
$$;
CREATE OR REPLACE FUNCTION private.sacado_tem_acesso_operacao(p_operacao_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.operacoes_nfs onf WHERE onf.operacao_id = p_operacao_id
      AND private.sacado_tem_acesso_operacao_nf(p_operacao_id, onf.nota_fiscal_id));
$$;
REVOKE ALL ON FUNCTION private.sacado_tem_acesso_cnpj_fundo(text, uuid), private.sacado_tem_acesso_nf(uuid),
  private.sacado_tem_acesso_operacao(uuid), private.sacado_tem_acesso_operacao_nf(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.sacado_tem_acesso_cnpj_fundo(text, uuid), private.sacado_tem_acesso_nf(uuid),
  private.sacado_tem_acesso_operacao(uuid), private.sacado_tem_acesso_operacao_nf(uuid, uuid) TO authenticated;

CREATE FUNCTION private.sacado_admin_fundo(p_fundo_id uuid, p_escrita boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.fundos f WHERE f.id = p_fundo_id AND f.ativo)
    AND (private.usuario_e_super_admin() OR (
      private.gestor_tem_acesso_fundo_operacional(p_fundo_id) AND (NOT p_escrita OR EXISTS (
        SELECT 1 FROM public.usuario_fundos uf WHERE uf.usuario_id = auth.uid() AND uf.fundo_id = p_fundo_id
          AND uf.status = 'ativo' AND uf.perfil_no_fundo IN ('gestor', 'administrador', 'operador', 'plataforma')
      ))));
$$;
REVOKE ALL ON FUNCTION private.sacado_admin_fundo(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.sacado_admin_fundo(uuid, boolean) TO authenticated;
CREATE POLICY sacado_acessos_select ON public.sacado_acessos FOR SELECT TO authenticated USING (
  (user_id = (SELECT auth.uid()) AND status = 'ativo' AND EXISTS (
    SELECT 1 FROM private.sacado_contexto() c WHERE c.sacado_id = sacado_acessos.sacado_id AND c.fundo_id = sacado_acessos.fundo_id))
  OR private.sacado_admin_fundo(fundo_id)
);
DROP POLICY sacados_own_select ON public.sacados;
DROP POLICY sacados_own_update ON public.sacados;
CREATE POLICY sacados_acessos_select ON public.sacados FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM private.sacado_contexto() c WHERE c.sacado_id = sacados.id)
);
DROP POLICY notas_fiscais_sacado_aceitar ON public.notas_fiscais;
DROP POLICY notas_fiscais_sacado_contestar ON public.notas_fiscais;
DROP POLICY notas_fiscais_sacado_select ON public.notas_fiscais;
CREATE POLICY notas_fiscais_sacado_select ON public.notas_fiscais FOR SELECT TO authenticated
  USING (private.sacado_tem_acesso_cnpj_fundo(cnpj_destinatario, fundo_id));
-- Writes must go through the atomic, fully validated RPC, never a direct table UPDATE.
DROP POLICY eventos_dominio_sacado_select ON public.eventos_dominio;
CREATE POLICY eventos_dominio_sacado_select ON public.eventos_dominio FOR SELECT TO authenticated USING (
  public.get_user_role() = 'sacado' AND visibilidade IN ('cedente', 'ambos') AND (
    (nota_fiscal_id IS NOT NULL AND private.sacado_tem_acesso_nf(nota_fiscal_id)) OR
    (nota_fiscal_id IS NULL AND operacao_id IS NOT NULL AND private.sacado_tem_acesso_operacao(operacao_id))
  )
);
-- Prevent the older permissive INSERT policy from authorizing another fund.
CREATE POLICY eventos_dominio_sacado_scope ON public.eventos_dominio AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (
  public.get_user_role() <> 'sacado' OR (
    ator_usuario_id = (SELECT auth.uid()) AND visibilidade = 'ambos'
    AND (nota_fiscal_id IS NULL OR private.sacado_tem_acesso_nf(nota_fiscal_id))
    AND operacao_id IS NOT NULL AND private.sacado_tem_acesso_operacao(operacao_id)
  )
);

-- Compatibility consumers get a scalar only if the entire active set has one CNPJ.
CREATE OR REPLACE FUNCTION public.get_user_sacado_cnpj() RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE WHEN count(DISTINCT c.cnpj) = 1 THEN min(c.cnpj) END FROM private.sacado_contexto() c;
$$;


-- Preserve existing business projections and non-Sacado branches; replace only authorization sources.
DROP FUNCTION public.carregar_dashboard_sacado();
CREATE OR REPLACE FUNCTION "public"."carregar_dashboard_sacado"("p_cnpj" text DEFAULT NULL) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH contexto AS (
    SELECT * FROM public.get_user_sacado_context() c
    WHERE p_cnpj IS NULL OR c.cnpj = regexp_replace(p_cnpj, '\D', '', 'g')
  ),
  nfs_contexto AS (
    SELECT DISTINCT ON (nf.id)
      nf.id,
      nf.numero_nf,
      nf.cedente_id,
      nf.razao_social_emitente,
      regexp_replace(nf.cnpj_emitente, '\D', '', 'g') AS cnpj_emitente,
      nf.valor_bruto,
      nf.data_vencimento,
      op.id AS operacao_id,
      op.status AS operacao_status,
      ce.identificador AS conta_escrow
    FROM contexto ctx
    JOIN public.notas_fiscais nf
      ON regexp_replace(nf.cnpj_destinatario, '\D', '', 'g') = ctx.cnpj AND nf.fundo_id = ctx.fundo_id
    JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id = nf.id
    JOIN public.operacoes op ON op.id = onf.operacao_id
    LEFT JOIN public.contas_escrow ce ON ce.id = op.conta_escrow_id
    ORDER BY nf.id, op.created_at DESC, op.id DESC
  ),
  ativas AS (
    SELECT *
      FROM nfs_contexto
     WHERE operacao_status IN ('aprovada', 'em_andamento', 'inadimplente')
  ),
  indicadores AS (
    SELECT
      count(*)::integer AS nfs_ativas,
      coalesce(sum(valor_bruto), 0)::numeric AS total_devido,
      count(*) FILTER (WHERE data_vencimento < current_date)::integer AS vencidas,
      coalesce(sum(valor_bruto) FILTER (WHERE data_vencimento < current_date), 0)::numeric AS valor_vencido,
      count(*) FILTER (WHERE data_vencimento = current_date)::integer AS vencem_hoje,
      coalesce(sum(valor_bruto) FILTER (WHERE data_vencimento = current_date), 0)::numeric AS valor_vence_hoje,
      count(*) FILTER (
        WHERE data_vencimento > current_date
          AND data_vencimento <= current_date + 7
      )::integer AS proximos_7_dias,
      coalesce(sum(valor_bruto) FILTER (
        WHERE data_vencimento > current_date
          AND data_vencimento <= current_date + 7
      ), 0)::numeric AS valor_proximos_7_dias
    FROM ativas
  ),
  proximos AS (
    SELECT *
      FROM ativas
     ORDER BY data_vencimento ASC, id ASC
     LIMIT 8
  ),
  cedentes AS (
    SELECT
      cedente_id,
      max(razao_social_emitente) AS nome,
      max(cnpj_emitente) AS cnpj,
      sum(valor_bruto)::numeric AS total_devido,
      count(DISTINCT id)::integer AS quantidade_nfs,
      count(DISTINCT operacao_id)::integer AS quantidade_operacoes,
      min(data_vencimento) AS proximo_vencimento,
      max(conta_escrow) AS conta_escrow
    FROM ativas
    GROUP BY cedente_id
    ORDER BY min(data_vencimento) ASC, cedente_id ASC
    LIMIT 8
  )
  SELECT jsonb_build_object(
    'indicadores', jsonb_build_object(
      'totalDevido', i.total_devido,
      'nfsAtivas', i.nfs_ativas,
      'vencidas', i.vencidas,
      'valorVencido', i.valor_vencido,
      'vencemHoje', i.vencem_hoje,
      'valorVenceHoje', i.valor_vence_hoje,
      'proximos7Dias', i.proximos_7_dias,
      'valorProximos7Dias', i.valor_proximos_7_dias
    ),
    'proximosVencimentos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        'numero', p.numero_nf,
        'cedenteNome', p.razao_social_emitente,
        'cedenteCnpj', p.cnpj_emitente,
        'valor', p.valor_bruto,
        'vencimentoEm', p.data_vencimento
      ) ORDER BY p.data_vencimento ASC, p.id ASC)
      FROM proximos p
    ), '[]'::jsonb),
    'cedentesEmAberto', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'cedenteId', c.cedente_id,
        'nome', c.nome,
        'cnpj', c.cnpj,
        'totalDevido', c.total_devido,
        'quantidadeNfs', c.quantidade_nfs,
        'quantidadeOperacoes', c.quantidade_operacoes,
        'proximoVencimento', c.proximo_vencimento,
        'contaEscrow', c.conta_escrow
      ) ORDER BY c.proximo_vencimento ASC, c.cedente_id ASC)
      FROM cedentes c
    ), '[]'::jsonb)
  )
  FROM indicadores i;
$$;
REVOKE ALL ON FUNCTION public.carregar_dashboard_sacado(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carregar_dashboard_sacado(text) TO authenticated;

DROP FUNCTION public.carregar_indicadores_nfs_sacado();
CREATE OR REPLACE FUNCTION "public"."carregar_indicadores_nfs_sacado"("p_cnpj" text DEFAULT NULL) RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH contexto AS (
    SELECT * FROM public.get_user_sacado_context() c
    WHERE p_cnpj IS NULL OR c.cnpj = regexp_replace(p_cnpj, '\D', '', 'g')
  ),
  nfs_contexto AS (
    SELECT DISTINCT ON (nf.id)
      nf.id,
      nf.status AS nf_status,
      nf.data_vencimento,
      op.status AS operacao_status
    FROM contexto ctx
    JOIN public.notas_fiscais nf
      ON regexp_replace(nf.cnpj_destinatario, '\D', '', 'g') = ctx.cnpj AND nf.fundo_id = ctx.fundo_id
    LEFT JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id = nf.id
    LEFT JOIN public.operacoes op ON op.id = onf.operacao_id
    ORDER BY nf.id, op.created_at DESC NULLS LAST, op.id DESC NULLS LAST
  )
  SELECT jsonb_build_object(
    'total', count(*)::integer,
    'cedidas', count(*) FILTER (
      WHERE operacao_status IN ('aprovada', 'em_andamento', 'inadimplente')
    )::integer,
    'liquidadas', count(*) FILTER (
      WHERE operacao_status = 'liquidada' OR nf_status = 'liquidada'
    )::integer,
    'vencidas', count(*) FILTER (
      WHERE operacao_status IN ('aprovada', 'em_andamento', 'inadimplente')
        AND data_vencimento < current_date
    )::integer
  )
  FROM nfs_contexto;
$$;
REVOKE ALL ON FUNCTION public.carregar_indicadores_nfs_sacado(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carregar_indicadores_nfs_sacado(text) TO authenticated;

CREATE OR REPLACE FUNCTION "public"."listar_cedentes_aprovacao_sacado"() RETURNS TABLE("id" "uuid", "nome" "text", "cnpj" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT
    nf.cedente_id AS id,
    max(nf.razao_social_emitente) AS nome,
    max(regexp_replace(nf.cnpj_emitente, '\D', '', 'g')) AS cnpj
  FROM public.get_user_sacado_context() s
  JOIN public.notas_fiscais nf
    ON regexp_replace(nf.cnpj_destinatario, '\D', '', 'g')
      = s.cnpj AND nf.fundo_id = s.fundo_id
  JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id = nf.id
  JOIN public.operacoes op ON op.id = onf.operacao_id
  WHERE s.user_id = auth.uid()
    AND nf.status = 'em_antecipacao'
    AND op.aceite_sacado_exigido = true
    AND op.aceite_sacado_status = 'pendente'
    AND op.status IN ('solicitada', 'em_analise')
  GROUP BY nf.cedente_id
  ORDER BY max(nf.razao_social_emitente) ASC, nf.cedente_id ASC;
$$;

CREATE OR REPLACE FUNCTION "private"."usuario_pode_ler_objeto_storage"("p_bucket" "text", "p_path" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'private'
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
            AND private.sacado_tem_acesso_cnpj_fundo(nf.cnpj_destinatario, nf.fundo_id)
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

ALTER POLICY "eventos_dominio_insert" ON "public"."eventos_dominio" WITH CHECK (((("public"."get_user_role"() = 'gestor'::"text") AND (("fundo_id" IS NULL) OR (EXISTS ( SELECT 1
   FROM "public"."usuario_fundos" "uf"
  WHERE (("uf"."usuario_id" = ( SELECT "auth"."uid"() AS "uid")) AND ("uf"."fundo_id" = "eventos_dominio"."fundo_id") AND ("uf"."status" = 'ativo'::"text")))))) OR (("public"."get_user_role"() = 'cedente'::"text") AND ("cedente_id" = "public"."get_user_cedente_id"()) AND ("visibilidade" = ANY (ARRAY['cedente'::"text", 'ambos'::"text"]))) OR (("public"."get_user_role"() = 'sacado'::"text") AND ("visibilidade" = 'ambos'::"text") AND ((("nota_fiscal_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."notas_fiscais" "nf"
  WHERE (("nf"."id" = "eventos_dominio"."nota_fiscal_id") AND private.sacado_tem_acesso_nf("nf"."id"))))) OR (("operacao_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM ("public"."operacoes_nfs" "onf"
     JOIN "public"."notas_fiscais" "nf" ON (("nf"."id" = "onf"."nota_fiscal_id")))
  WHERE (("onf"."operacao_id" = "eventos_dominio"."operacao_id") AND private.sacado_tem_acesso_nf("nf"."id")))))))));

ALTER TABLE public.autorizacoes_acoes_sensiveis DROP CONSTRAINT autorizacoes_acoes_sensiveis_action_check;
ALTER TABLE public.autorizacoes_acoes_sensiveis ADD CONSTRAINT "autorizacoes_acoes_sensiveis_action_check" CHECK (("action_type" = ANY (ARRAY['gerenciar_acesso_sacado'::"text", 'alterar_senha'::"text", 'alterar_email'::"text", 'regenerar_recovery_codes'::"text", 'encerrar_outras_sessoes'::"text", 'reset_mfa_administrativo'::"text", 'cadastrar_credencial_integracao'::"text", 'rotacionar_credencial_integracao'::"text", 'ativar_credencial_integracao'::"text", 'revogar_credencial_integracao'::"text", 'criar_fundo'::"text", 'atualizar_fundo_estrutural'::"text", 'ativar_fundo'::"text", 'desativar_fundo'::"text", 'convidar_usuario_admin'::"text", 'vincular_gestor_fundo'::"text", 'revogar_gestor_fundo'::"text", 'reativar_gestor_fundo'::"text", 'desativar_usuario'::"text", 'reativar_usuario'::"text", 'conceder_super_admin'::"text", 'revogar_super_admin'::"text", 'criar_integracao_versao'::"text", 'publicar_integracao'::"text", 'desativar_integracao'::"text", 'testar_integracao'::"text", 'atualizar_cnab'::"text", 'atualizar_codigo_originador'::"text", 'publicar_base_financeira'::"text", 'confirmar_match_manual'::"text", 'revogar_match_manual'::"text", 'revisar_risco_operacao'::"text", 'criar_integracao_transportadora'::"text", 'ativar_integracao_transportadora'::"text", 'desativar_integracao_transportadora'::"text", 'rotacionar_token_integracao_transportadora'::"text", 'revogar_token_integracao_transportadora'::"text", 'reprocessar_webhook_evento_transportadora'::"text", 'configurar_credencial_vortx_vrs'::"text", 'testar_conexao_vortx_vrs'::"text", 'criar_consultoria'::"text", 'convidar_usuario_consultoria'::"text", 'atualizar_consultoria'::"text", 'atualizar_fundos_consultoria'::"text"])));
CREATE OR REPLACE FUNCTION "public"."criar_autorizacao_acao_sensivel"("p_action_type" "text", "p_nonce_hash" "text") RETURNS TABLE("expira_em" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'pg_temp'
    AS $_$
DECLARE
  v_user_id uuid := auth.uid();
  v_session_id uuid;
  v_agora timestamptz := clock_timestamp();
BEGIN
  BEGIN
    v_session_id := nullif(auth.jwt() ->> 'session_id', '')::uuid;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessao Supabase invalida';
  END;

  IF p_action_type IS NULL OR p_action_type NOT IN (
    'gerenciar_acesso_sacado', 'alterar_senha', 'alterar_email', 'regenerar_recovery_codes',
    'encerrar_outras_sessoes', 'reset_mfa_administrativo',
    'cadastrar_credencial_integracao', 'rotacionar_credencial_integracao',
    'ativar_credencial_integracao', 'revogar_credencial_integracao',
    'criar_fundo', 'atualizar_fundo_estrutural', 'ativar_fundo', 'desativar_fundo',
    'convidar_usuario_admin', 'vincular_gestor_fundo', 'revogar_gestor_fundo',
    'reativar_gestor_fundo', 'desativar_usuario', 'reativar_usuario',
    'conceder_super_admin', 'revogar_super_admin', 'criar_integracao_versao',
    'publicar_integracao', 'desativar_integracao', 'testar_integracao',
    'atualizar_cnab', 'atualizar_codigo_originador', 'publicar_base_financeira',
    'confirmar_match_manual', 'revogar_match_manual', 'revisar_risco_operacao',
    'criar_integracao_transportadora', 'ativar_integracao_transportadora',
    'desativar_integracao_transportadora', 'rotacionar_token_integracao_transportadora',
    'revogar_token_integracao_transportadora', 'reprocessar_webhook_evento_transportadora',
    'configurar_credencial_vortx_vrs', 'testar_conexao_vortx_vrs',
    'criar_consultoria', 'convidar_usuario_consultoria',
    'atualizar_consultoria', 'atualizar_fundos_consultoria'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Tipo de acao sensivel invalido';
  END IF;
  IF p_nonce_hash IS NULL OR p_nonce_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Nonce invalido';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.obter_sessao_mfa_atual() estado
    WHERE estado.status = 'valid' AND estado.session_id = v_session_id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sessao MFA de 24 horas invalida';
  END IF;

  INSERT INTO public.autorizacoes_acoes_sensiveis (
    user_id, session_id, action_type, nonce_hash, criada_em, expira_em
  ) VALUES (
    v_user_id, v_session_id, p_action_type, p_nonce_hash, v_agora, v_agora + interval '5 minutes'
  );
  RETURN QUERY SELECT v_agora + interval '5 minutes';
END;
$_$;

CREATE OR REPLACE FUNCTION public.processar_aceite_sacado(
  p_nota_fiscal_ids uuid[],
  p_acao text,
  p_motivo text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_sacado_cnpj text;
  v_sacado_nome text;
  v_sacado_id uuid;
  v_requested_count integer;
  v_found_count integer;
  v_nf record;
  v_op record;
  v_total integer;
  v_aceitas integer;
  v_operation_ids uuid[] := ARRAY[]::uuid[];
  v_nf_ids uuid[] := ARRAY[]::uuid[];
  v_event text;
  v_title text;
  v_message text;
  v_dedupe text;
  v_recipient uuid;
BEGIN
  IF v_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM private.sacado_contexto()) THEN
    RAISE EXCEPTION 'Apenas um sacado autenticado pode executar esta operação.';
  END IF;

  IF p_acao NOT IN ('aceitar', 'contestar') THEN
    RAISE EXCEPTION 'Ação de aceite inválida.';
  END IF;
  IF p_nota_fiscal_ids IS NULL OR cardinality(p_nota_fiscal_ids) = 0 THEN
    RAISE EXCEPTION 'Nenhuma NF foi informada.';
  END IF;
  IF p_acao = 'contestar' AND COALESCE(trim(p_motivo), '') = '' THEN
    RAISE EXCEPTION 'O motivo da contestação é obrigatório.';
  END IF;

  -- Membership revocation and acceptance serialize on the same rows.
  PERFORM 1 FROM public.sacado_acessos WHERE user_id = v_user_id ORDER BY id FOR SHARE;
  IF cardinality(p_nota_fiscal_ids) > 500 OR array_position(p_nota_fiscal_ids, NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Lote invalido.';
  END IF;

  -- Serializar as NFs ANTES de conferir cardinalidade. Uma operacao pode
  -- continuar historicamente em operacoes_nfs apos cancelamento.
  PERFORM 1
    FROM public.notas_fiscais
   WHERE id = ANY(p_nota_fiscal_ids)
   ORDER BY id
   FOR UPDATE;

  v_requested_count := (
    SELECT count(DISTINCT nf_id)
      FROM unnest(p_nota_fiscal_ids) AS item(nf_id)
  );
  SELECT count(DISTINCT nf.id)
    INTO v_found_count
    FROM public.notas_fiscais nf
    JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id = nf.id
    JOIN public.operacoes op ON op.id = onf.operacao_id
   WHERE nf.id = ANY(p_nota_fiscal_ids)
     AND op.status::text NOT IN ('cancelada', 'reprovada');
  IF v_requested_count <> v_found_count THEN
    RAISE EXCEPTION 'Todas as NFs precisam estar vinculadas a uma operação ativa.';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public.operacoes_nfs onf
      JOIN public.operacoes op ON op.id = onf.operacao_id
     WHERE onf.nota_fiscal_id = ANY(p_nota_fiscal_ids)
       AND op.status::text NOT IN ('cancelada', 'reprovada')
     GROUP BY onf.nota_fiscal_id
    HAVING count(DISTINCT onf.operacao_id) <> 1
  ) THEN
    RAISE EXCEPTION 'A NF possui vínculo operacional ambíguo.';
  END IF;

  FOR v_op IN
    SELECT op.id, op.cedente_id
      FROM public.operacoes op
     WHERE op.status::text NOT IN ('cancelada', 'reprovada')
       AND op.id IN (
         SELECT onf.operacao_id
           FROM public.operacoes_nfs onf
          WHERE onf.nota_fiscal_id = ANY(p_nota_fiscal_ids)
       )
     ORDER BY op.id
     FOR UPDATE
  LOOP
    v_operation_ids := array_append(v_operation_ids, v_op.id);
  END LOOP;

  FOR v_nf IN
    SELECT nf.id, nf.numero_nf, nf.cnpj_destinatario, nf.razao_social_emitente,
           nf.cedente_id, nf.status, onf.operacao_id,
           op.aceite_sacado_exigido, op.aceite_sacado_status,
           op.status AS operacao_status, cf.fundo_id, nf.fundo_id AS nf_fundo_id
      FROM public.notas_fiscais nf
      JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id = nf.id
      JOIN public.operacoes op ON op.id = onf.operacao_id
      JOIN public.cedentes c ON c.id = op.cedente_id
      JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
     WHERE nf.id = ANY(p_nota_fiscal_ids)
       AND op.status::text NOT IN ('cancelada', 'reprovada')
     ORDER BY nf.id
  LOOP
    SELECT c.sacado_id, c.cnpj, c.razao_social INTO v_sacado_id, v_sacado_cnpj, v_sacado_nome
      FROM private.sacado_contexto() c WHERE c.cnpj = regexp_replace(v_nf.cnpj_destinatario, '\D', '', 'g')
        AND c.fundo_id = v_nf.fundo_id;
    IF NOT FOUND OR v_nf.nf_fundo_id IS DISTINCT FROM v_nf.fundo_id THEN
      RAISE EXCEPTION 'Esta NF nao esta autorizada para este usuario e Fundo.' USING ERRCODE = '42501';
    END IF;
    IF COALESCE(v_nf.aceite_sacado_exigido, true) = false
       OR COALESCE(v_nf.aceite_sacado_status, 'pendente') = 'dispensado' THEN
      RAISE EXCEPTION 'Esta operação não exige aceite do sacado.';
    END IF;
    IF v_nf.aceite_sacado_status IS NOT NULL AND v_nf.aceite_sacado_status <> 'pendente' THEN
      RAISE EXCEPTION 'A operação não está aberta para aceite.';
    END IF;
    IF v_nf.operacao_status NOT IN ('solicitada', 'em_analise') THEN
      RAISE EXCEPTION 'A operação não está aberta para aceite.';
    END IF;
    IF v_nf.status <> 'em_antecipacao' THEN
      RAISE EXCEPTION 'Esta NF não pode ser alterada no status atual.';
    END IF;

  END LOOP;

  -- Entire batch has passed validation; only now begin financial state mutations.
  FOR v_nf IN
    SELECT nf.id, nf.numero_nf, nf.cnpj_destinatario, nf.razao_social_emitente,
           nf.cedente_id, nf.status, onf.operacao_id,
           op.aceite_sacado_exigido, op.aceite_sacado_status,
           op.status AS operacao_status, cf.fundo_id, nf.fundo_id AS nf_fundo_id
      FROM public.notas_fiscais nf
      JOIN public.operacoes_nfs onf ON onf.nota_fiscal_id = nf.id
      JOIN public.operacoes op ON op.id = onf.operacao_id
      JOIN public.cedentes c ON c.id = op.cedente_id
      JOIN public.cedente_fundos cf ON cf.id = op.cedente_fundo_id
     WHERE nf.id = ANY(p_nota_fiscal_ids)
       AND op.status::text NOT IN ('cancelada', 'reprovada')
     ORDER BY nf.id
  LOOP
    SELECT c.sacado_id, c.cnpj, c.razao_social INTO v_sacado_id, v_sacado_cnpj, v_sacado_nome
      FROM private.sacado_contexto() c WHERE c.cnpj = regexp_replace(v_nf.cnpj_destinatario, '\D', '', 'g')
        AND c.fundo_id = v_nf.fundo_id;
    IF NOT FOUND OR v_nf.nf_fundo_id IS DISTINCT FROM v_nf.fundo_id THEN
      RAISE EXCEPTION 'Esta NF nao esta autorizada para este usuario e Fundo.' USING ERRCODE = '42501';
    END IF;
    IF p_acao = 'aceitar' THEN
      UPDATE public.notas_fiscais
         SET status = 'aceita', aprovacao_sacado_em = now()
       WHERE id = v_nf.id;
      v_event := 'CESSAO_ACEITA';
      v_title := 'Cessão aceita pelo sacado';
      v_message := format('O sacado %s aceitou a cessão da NF %s.', v_sacado_nome, v_nf.numero_nf);
    ELSE
      UPDATE public.notas_fiscais
         SET status = 'contestada', motivo_ajuste = p_motivo
       WHERE id = v_nf.id;
      v_event := 'CESSAO_CONTESTADA';
      v_title := 'ALERTA: Cessão contestada pelo sacado';
      v_message := format('O sacado %s contestou a cessão da NF %s. Motivo: %s', v_sacado_nome, v_nf.numero_nf, p_motivo);
    END IF;

    v_nf_ids := array_append(v_nf_ids, v_nf.id);
    v_dedupe := format('operacao:%s:nf:%s:%s', v_nf.operacao_id, v_nf.id, p_acao);

    INSERT INTO public.logs_auditoria (usuario_id, ator_tipo, origem, tipo_evento, entidade_tipo, entidade_id, dados_depois)
    VALUES (v_user_id, 'usuario', 'rpc_sacado', v_event, 'notas_fiscais', v_nf.id,
            jsonb_build_object('user_id', v_user_id, 'sacado_id', v_sacado_id, 'sacado_cnpj', v_sacado_cnpj, 'fundo_id', v_nf.fundo_id, 'nota_fiscal_id', v_nf.id, 'operacao_id', v_nf.operacao_id, 'acao', p_acao, 'timestamp', now(), 'motivo', CASE WHEN p_acao = 'contestar' THEN p_motivo ELSE NULL END));

    PERFORM private.notificar_cedente_ativos(
      v_nf.cedente_id,
      CASE WHEN p_acao = 'contestar' THEN 'Cessão contestada pelo sacado' ELSE 'Aceite de cessão confirmado' END,
      CASE WHEN p_acao = 'contestar' THEN v_message || '. O gestor foi notificado.' ELSE v_message END,
      CASE WHEN p_acao = 'contestar' THEN 'cessao_contestada' ELSE 'cessao_aceita' END,
      v_dedupe || ':cedente'
    );

    FOR v_recipient IN SELECT DISTINCT p.id FROM public.profiles p
      JOIN public.usuario_fundos uf ON uf.usuario_id = p.id AND uf.status = 'ativo'
      WHERE p.role = 'gestor' AND p.status = 'ativo' AND uf.fundo_id = v_nf.fundo_id
    LOOP
      INSERT INTO public.notificacoes (usuario_id, titulo, mensagem, tipo, dedupe_key)
      VALUES (
        v_recipient,
        v_title,
        CASE WHEN p_acao = 'contestar' THEN v_message ELSE v_message || format(' (emitente: %s).', v_nf.razao_social_emitente) END,
        CASE WHEN p_acao = 'contestar' THEN 'cessao_contestada' ELSE 'cessao_aceita' END,
        v_dedupe || ':gestor:' || v_recipient::text
      ) ON CONFLICT (usuario_id, dedupe_key) DO NOTHING;
    END LOOP;
  END LOOP;

  FOR v_op IN
    SELECT id, cedente_id FROM public.operacoes
     WHERE id = ANY(v_operation_ids)
     ORDER BY id
  LOOP
    SELECT count(*), count(*) FILTER (WHERE nf.status = 'aceita')
      INTO v_total, v_aceitas
      FROM public.operacoes_nfs onf
      JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
     WHERE onf.operacao_id = v_op.id;

    IF p_acao = 'contestar' THEN
      UPDATE public.operacoes
         SET aceite_sacado_status = 'contestado', aceite_sacado_em = now()
       WHERE id = v_op.id;
    ELSIF v_total > 0 AND v_total = v_aceitas THEN
      UPDATE public.operacoes
         SET aceite_sacado_status = 'aceito', aceite_sacado_em = now()
       WHERE id = v_op.id;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('acao', p_acao, 'nota_fiscal_ids', to_jsonb(v_nf_ids), 'operacao_ids', to_jsonb(v_operation_ids));
END;
$$;

REVOKE ALL ON FUNCTION public.processar_aceite_sacado(uuid[], text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.processar_aceite_sacado(uuid[], text, text) TO authenticated;

-- Administrative mutations are private definers, reached by invoker wrappers.
-- Both the fund scope and the one-use MFA authorization are checked in this transaction.
CREATE FUNCTION private.gerenciar_sacado_acesso(
  p_user_id uuid, p_fundo_id uuid, p_cnpj text, p_razao_social text,
  p_acao text, p_nonce_hash text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_cnpj text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g');
  v_company public.sacados; v_access public.sacado_acessos;
  v_before jsonb; v_event text; v_status text;
BEGIN
  IF NOT private.sacado_admin_fundo(p_fundo_id, true) THEN
    RAISE EXCEPTION 'Sem permissao para gerenciar Sacados neste Fundo.' USING ERRCODE = '42501';
  END IF;
  IF v_cnpj !~ '^[0-9]{14}$' OR p_acao IS NULL OR p_acao NOT IN ('adicionar','revogar','ativar','desativar','atualizar_empresa') THEN
    RAISE EXCEPTION 'Informe CNPJ completo e acao valida.' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = p_user_id AND p.role::text = 'sacado' AND p.status::text = 'ativo') THEN
    RAISE EXCEPTION 'Usuario Sacado ativo nao encontrado.' USING ERRCODE = '22023';
  END IF;
  IF coalesce(auth.jwt()->>'aal','') <> 'aal2' OR NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) a
    WHERE a->>'method' = 'totp' AND (a->>'timestamp')::numeric BETWEEN extract(epoch FROM clock_timestamp())-120 AND extract(epoch FROM clock_timestamp())+5
  ) OR NOT EXISTS (SELECT 1 FROM public.obter_sessao_mfa_atual() m WHERE m.status = 'valid') THEN
    RAISE EXCEPTION 'Confirme um novo codigo MFA para esta acao.' USING ERRCODE = '42501';
  END IF;
  IF NOT public.consumir_autorizacao_acao_sensivel('gerenciar_acesso_sacado', p_nonce_hash) THEN
    RAISE EXCEPTION 'Autorizacao MFA expirada ou ja utilizada.' USING ERRCODE = '42501';
  END IF;
  -- Serialize creation/revocation of this company without affecting unrelated CNPJs.
  PERFORM pg_advisory_xact_lock(hashtextextended('sacado:' || v_cnpj, 0));
  SELECT * INTO v_company FROM public.sacados s WHERE regexp_replace(s.cnpj, '\D', '', 'g') = v_cnpj FOR UPDATE;
  IF NOT FOUND THEN
    IF p_acao <> 'adicionar' OR length(btrim(coalesce(p_razao_social,''))) NOT BETWEEN 2 AND 200 THEN
      RAISE EXCEPTION 'Informe a razao social para cadastrar a empresa.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.sacados(cnpj, razao_social) VALUES(v_cnpj, btrim(p_razao_social)) RETURNING * INTO v_company;
    INSERT INTO public.plataforma_auditoria(tipo_evento, ator_usuario_id, origem, dados)
      VALUES ('SACADO_COMPANY_CREATED', auth.uid(), 'sacado_acessos', jsonb_build_object('sacado_id',v_company.id,'cnpj',v_cnpj,'fundo_id',p_fundo_id));
  END IF;
  SELECT * INTO v_access FROM public.sacado_acessos WHERE user_id = p_user_id AND sacado_id = v_company.id AND fundo_id = p_fundo_id FOR UPDATE;
  v_before := to_jsonb(v_access);
  IF p_acao = 'atualizar_empresa' THEN
    -- A shared entity cannot be edited by an administrator of only one of its funds.
    IF v_access.id IS NULL OR length(btrim(coalesce(p_razao_social,''))) NOT BETWEEN 2 AND 200 OR EXISTS (
      SELECT 1 FROM public.sacado_acessos a WHERE a.sacado_id = v_company.id AND NOT private.sacado_admin_fundo(a.fundo_id, true)
    ) THEN RAISE EXCEPTION 'Sem permissao para alterar esta empresa compartilhada.' USING ERRCODE = '42501'; END IF;
    UPDATE public.sacados SET razao_social = btrim(p_razao_social), updated_at = now() WHERE id = v_company.id;
    INSERT INTO public.plataforma_auditoria(tipo_evento, ator_usuario_id, origem, dados)
      VALUES('SACADO_COMPANY_UPDATED', auth.uid(), 'sacado_acessos', jsonb_build_object('sacado_id',v_company.id,'antes',v_company.razao_social,'depois',btrim(p_razao_social),'fundo_id',p_fundo_id));
    RETURN v_access.id;
  END IF;
  IF p_acao = 'adicionar' THEN
    IF v_access.id IS NOT NULL THEN RAISE EXCEPTION 'Este vinculo ja existe. Use Ativar para reativar.' USING ERRCODE = '22023'; END IF;
    INSERT INTO public.sacado_acessos(user_id,sacado_id,fundo_id,created_by)
      VALUES(p_user_id,v_company.id,p_fundo_id,auth.uid()) RETURNING * INTO v_access;
    v_event := 'SACADO_ACCESS_CREATED';
  ELSE
    IF v_access.id IS NULL THEN RAISE EXCEPTION 'Vinculo nao encontrado.' USING ERRCODE = '22023'; END IF;
    v_status := CASE p_acao WHEN 'ativar' THEN 'ativo' WHEN 'desativar' THEN 'inativo' ELSE 'revogado' END;
    IF v_access.status = v_status THEN RETURN v_access.id; END IF;
    UPDATE public.sacado_acessos SET status = v_status, updated_at = now(),
      revoked_at = CASE WHEN v_status = 'revogado' THEN now() END,
      revoked_by = CASE WHEN v_status = 'revogado' THEN auth.uid() END
      WHERE id = v_access.id RETURNING * INTO v_access;
    v_event := CASE p_acao WHEN 'ativar' THEN 'SACADO_ACCESS_ENABLED' WHEN 'desativar' THEN 'SACADO_ACCESS_DISABLED' ELSE 'SACADO_ACCESS_REVOKED' END;
  END IF;
  INSERT INTO public.plataforma_auditoria(tipo_evento, ator_usuario_id, origem, dados)
    VALUES(v_event, auth.uid(), 'sacado_acessos', jsonb_build_object('cnpj',v_cnpj,'antes',v_before,'depois',to_jsonb(v_access)));
  RETURN v_access.id;
END $$;
REVOKE ALL ON FUNCTION private.gerenciar_sacado_acesso(uuid,uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.gerenciar_sacado_acesso(uuid,uuid,text,text,text,text) TO authenticated;
CREATE FUNCTION public.gerenciar_sacado_acesso(p_user_id uuid,p_fundo_id uuid,p_cnpj text,p_razao_social text,p_acao text,p_nonce_hash text)
RETURNS uuid LANGUAGE sql SECURITY INVOKER SET search_path = '' AS $$
 SELECT private.gerenciar_sacado_acesso(p_user_id,p_fundo_id,p_cnpj,p_razao_social,p_acao,p_nonce_hash);
$$;
REVOKE ALL ON FUNCTION public.gerenciar_sacado_acesso(uuid,uuid,text,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gerenciar_sacado_acesso(uuid,uuid,text,text,text,text) TO authenticated;

CREATE FUNCTION private.listar_gestao_sacados(p_fundo_id uuid,p_busca text,p_pagina integer,p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF NOT private.sacado_admin_fundo(p_fundo_id) THEN RAISE EXCEPTION 'Fundo nao autorizado.' USING ERRCODE='42501'; END IF;
  WITH users AS (
    SELECT p.id,p.nome_completo,p.email,p.status,
      (SELECT count(*) FROM public.sacado_acessos a WHERE a.user_id=p.id AND a.fundo_id=p_fundo_id AND a.status='ativo') cnpjs_ativos
    FROM public.profiles p WHERE p.role::text='sacado'
      AND (p_user_id IS NULL OR p.id=p_user_id)
      AND (private.usuario_e_super_admin() OR EXISTS (SELECT 1 FROM public.sacado_acessos a WHERE a.user_id=p.id AND a.fundo_id=p_fundo_id)
        OR (p_busca LIKE '%@%' AND lower(p.email)=lower(btrim(p_busca))))
      AND (coalesce(p_busca,'')='' OR p.nome_completo ILIKE '%'||p_busca||'%' OR p.email ILIKE '%'||p_busca||'%')
  ), page AS (SELECT * FROM users ORDER BY nome_completo,id LIMIT 20 OFFSET (greatest(1,least(coalesce(p_pagina,1),10000))-1)*20)
  SELECT jsonb_build_object('total',(SELECT count(*) FROM users), 'usuarios',coalesce((SELECT jsonb_agg(to_jsonb(p)) FROM page p),'[]'::jsonb),
    'pode_editar',private.sacado_admin_fundo(p_fundo_id,true),
    'acessos',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'user_id',a.user_id,'cnpj',s.cnpj,'razao_social',s.razao_social,'status',a.status,'created_at',a.created_at,'updated_at',a.updated_at) ORDER BY s.razao_social,a.id)
      FROM public.sacado_acessos a JOIN public.sacados s ON s.id=a.sacado_id
      WHERE a.fundo_id=p_fundo_id AND a.user_id=p_user_id AND EXISTS (SELECT 1 FROM page p WHERE p.id=a.user_id)),'[]'::jsonb)) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION private.listar_gestao_sacados(uuid,text,integer,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.listar_gestao_sacados(uuid,text,integer,uuid) TO authenticated;
CREATE FUNCTION public.listar_gestao_sacados(p_fundo_id uuid,p_busca text DEFAULT '',p_pagina integer DEFAULT 1,p_user_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
 SELECT private.listar_gestao_sacados(p_fundo_id,p_busca,p_pagina,p_user_id);
$$;
REVOKE ALL ON FUNCTION public.listar_gestao_sacados(uuid,text,integer,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.listar_gestao_sacados(uuid,text,integer,uuid) TO authenticated;

CREATE FUNCTION private.consultar_empresa_sacado(p_fundo_id uuid,p_cnpj text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT private.sacado_admin_fundo(p_fundo_id) THEN RAISE EXCEPTION 'Fundo nao autorizado.' USING ERRCODE='42501'; END IF;
  IF regexp_replace(p_cnpj,'\D','','g') !~ '^[0-9]{14}$' THEN RAISE EXCEPTION 'Informe o CNPJ completo.' USING ERRCODE='22023'; END IF;
  RETURN (SELECT jsonb_build_object('cnpj',s.cnpj,'razao_social',s.razao_social)
    FROM public.sacados s WHERE regexp_replace(s.cnpj,'\D','','g')=regexp_replace(p_cnpj,'\D','','g'));
END $$;
REVOKE ALL ON FUNCTION private.consultar_empresa_sacado(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.consultar_empresa_sacado(uuid,text) TO authenticated;
CREATE FUNCTION public.consultar_empresa_sacado(p_fundo_id uuid,p_cnpj text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT private.consultar_empresa_sacado(p_fundo_id,p_cnpj); $$;
REVOKE ALL ON FUNCTION public.consultar_empresa_sacado(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.consultar_empresa_sacado(uuid,text) TO authenticated;

-- Existing operation/cron notification consumers must not target a revoked legacy owner.
CREATE FUNCTION private.destinatarios_sacado_operacao(p_operacao_id uuid)
RETURNS TABLE(user_id uuid,cnpj text) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT DISTINCT a.user_id,regexp_replace(s.cnpj,'\D','','g') FROM public.operacoes op
  JOIN public.cedente_fundos cf ON cf.id=op.cedente_fundo_id
  JOIN public.operacoes_nfs onf ON onf.operacao_id=op.id
  JOIN public.notas_fiscais nf ON nf.id=onf.nota_fiscal_id AND nf.fundo_id=cf.fundo_id
  JOIN public.sacados s ON regexp_replace(s.cnpj,'\D','','g')=regexp_replace(nf.cnpj_destinatario,'\D','','g')
  JOIN public.sacado_acessos a ON a.sacado_id=s.id AND a.fundo_id=cf.fundo_id AND a.status='ativo'
  JOIN public.profiles p ON p.id=a.user_id AND p.role::text='sacado' AND p.status::text='ativo'
  WHERE op.id=p_operacao_id AND (private.sacado_admin_fundo(cf.fundo_id) OR auth.jwt()->>'role'='service_role');
$$;
REVOKE ALL ON FUNCTION private.destinatarios_sacado_operacao(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.destinatarios_sacado_operacao(uuid) TO authenticated,service_role;
CREATE FUNCTION public.destinatarios_sacado_operacao(p_operacao_id uuid)
RETURNS TABLE(user_id uuid,cnpj text) LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$ SELECT * FROM private.destinatarios_sacado_operacao(p_operacao_id); $$;
REVOKE ALL ON FUNCTION public.destinatarios_sacado_operacao(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.destinatarios_sacado_operacao(uuid) TO authenticated,service_role;

COMMIT;
