BEGIN;

-- P0: NF-78 ficava bloqueada na submissao mesmo com CT-e enviado/em
-- analise (evidencia "vigente", que e a regra correta de SUBMISSAO).
--
-- Causa raiz confirmada ao vivo: o trigger `notas_fiscais_validar_
-- logistica_pre_cessao` (private.validar_logistica_antes_transicao_nf)
-- dispara tanto na transicao para 'submetida' (Cedente) quanto para
-- 'aprovada' (Gestor), e usava em AMBOS os casos a mesma semantica --
-- private.classificar_status_logistico_pre_cessao, que exige evidencia
-- APROVADA. Isso duplicava, no banco, a regra de APROVACAO por cima da
-- submissao, mesmo depois de submeterNF (TypeScript) ja ter validado
-- corretamente com a regra de submissao (permitidoSubmissao -- evidencia
-- vigente basta). Resultado: um segundo gate, mais restritivo e
-- incorreto para este caso, bloqueando a transicao de status na camada
-- de banco depois que a camada de aplicacao ja havia liberado.
--
-- Corrige separando a semantica por transicao de status:
--   - 'submetida' (Cedente): exige apenas evidencia VIGENTE (enviada, em
--     analise ou aprovada, nao rejeitada/sem ajuste pendente na versao
--     mais recente por upload) -- mesma regra de
--     avaliarSubmissaoLogisticaPreCessao (TypeScript), agora tambem em
--     SQL, unificando as duas fontes (envio antecipado + checklist
--     regular).
--   - 'aprovada' (Gestor): continua exigindo evidencia APROVADA, via
--     private.classificar_status_logistico_pre_cessao (inalterada) --
--     nenhuma mudanca na regra de aprovacao do Gestor.

DO $$
BEGIN
  IF to_regclass('public.documento_requisito_instancias') IS NULL
     OR to_regclass('public.politica_requisitos_documentais') IS NULL
     OR to_regclass('public.documento_versoes') IS NULL
     OR to_regclass('public.evidencias_logisticas_antecipadas') IS NULL THEN
    RAISE EXCEPTION 'Dependencias do gate logistico pre-cessao nao foram aplicadas';
  END IF;
END;
$$;

-- Espelha avaliarSubmissaoLogisticaPreCessao (src/lib/logistica/
-- evidencias-logisticas.ts): para cada familia (CT-e/DACTE OU
-- Comprovante de Entrega), considera apenas a versao mais recente por
-- data de upload (nao por analise, para uma rejeicao antiga com reenvio
-- pendente nao bloquear) e verifica se ela esta vigente (enviada, em
-- analise ou aprovada; nao rejeitada nem com ajuste pendente). Permite
-- se QUALQUER uma das familias estiver vigente.
CREATE OR REPLACE FUNCTION private.avaliar_submissao_logistica_pre_cessao(
  p_nota_fiscal_id uuid,
  p_politica_operacional_versao_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_permitido boolean;
BEGIN
  SELECT bool_or(vencedora.vigente) INTO v_permitido
  FROM (
    SELECT DISTINCT ON (evidencias.familia_documental)
      evidencias.familia_documental,
      evidencias.versao_status IN ('enviado', 'em_analise', 'aprovado')
        AND coalesce(evidencias.analise_resultado, '') NOT IN ('rejeitado', 'requer_ajuste') AS vigente
    FROM (
      -- Fonte 1: envio antecipado.
      SELECT
        ela.familia_documental,
        dv.status AS versao_status,
        da.resultado AS analise_resultado,
        coalesce(dv.enviado_em, dv.created_at) AS criado_em,
        dv.numero_versao AS numero_versao,
        dv.id AS versao_id
      FROM public.evidencias_logisticas_antecipadas ela
      JOIN public.evidencia_logistica_versoes elv
        ON elv.evidencia_logistica_id = ela.id
      JOIN public.documento_versoes dv ON dv.id = elv.documento_versao_id
      LEFT JOIN LATERAL (
        SELECT a.resultado
        FROM public.documento_analises a
        WHERE a.documento_versao_id = dv.id
        ORDER BY a.analisado_em DESC, a.id DESC
        LIMIT 1
      ) da ON true
      WHERE ela.nota_fiscal_id = p_nota_fiscal_id
        AND ela.politica_operacional_versao_id = p_politica_operacional_versao_id

      UNION ALL

      -- Fonte 2: checklist documental regular (requisito nf_pre_cessao
      -- comum, sem passar pelo envio antecipado).
      SELECT
        prd.familia_documental,
        dv.status,
        da.resultado,
        coalesce(dv.enviado_em, dv.created_at),
        dv.numero_versao,
        dv.id
      FROM public.documento_requisito_instancias dri
      JOIN public.politica_requisitos_documentais prd ON prd.id = dri.politica_requisito_id
      JOIN public.documento_versoes dv ON dv.documento_id = dri.documento_id
      LEFT JOIN LATERAL (
        SELECT a.resultado
        FROM public.documento_analises a
        WHERE a.documento_versao_id = dv.id
        ORDER BY a.analisado_em DESC, a.id DESC
        LIMIT 1
      ) da ON true
      WHERE dri.nota_fiscal_id = p_nota_fiscal_id
        AND dri.politica_operacional_versao_id = p_politica_operacional_versao_id
        AND dri.escopo_snapshot = 'nf_pre_cessao'
        AND prd.familia_documental IN ('cte', 'comprovante_entrega')
    ) evidencias
    -- Desempate por numero_versao (sequencia monotonica por documento),
    -- nao por versao_id: dois uploads na MESMA transacao (ex.: rejeicao
    -- seguida de reenvio no mesmo teste/lote) podem ter timestamps
    -- identicos (now() e congelado por transacao), e um UUID aleatorio
    -- nao reflete ordem de insercao.
    ORDER BY evidencias.familia_documental, evidencias.criado_em DESC, evidencias.numero_versao DESC, evidencias.versao_id DESC
  ) vencedora;

  RETURN coalesce(v_permitido, false);
END;
$$;

REVOKE ALL ON FUNCTION private.avaliar_submissao_logistica_pre_cessao(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.validar_logistica_antes_transicao_nf()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_politica_versao_id uuid;
  v_gate_exigido boolean := false;
  v_classificacao jsonb;
BEGIN
  IF NEW.status::text NOT IN ('submetida', 'aprovada')
     OR OLD.status::text = NEW.status::text THEN
    RETURN NEW;
  END IF;

  v_politica_versao_id := private.resolver_politica_versao_nf_logistica(NEW.id);
  IF v_politica_versao_id IS NULL THEN RETURN NEW; END IF;

  SELECT pov.exigir_status_logistico_pre_cessao
  INTO v_gate_exigido
  FROM public.politica_operacional_versoes pov
  WHERE pov.id = v_politica_versao_id;

  IF NOT coalesce(v_gate_exigido, false) THEN RETURN NEW; END IF;

  IF NEW.status::text = 'submetida' THEN
    IF NOT private.avaliar_submissao_logistica_pre_cessao(NEW.id, v_politica_versao_id) THEN
      RAISE EXCEPTION 'A politica exige o envio de CT-e/DACTE ou Comprovante de Entrega antes da submissao'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  -- NEW.status = 'aprovada': regra de aprovacao do Gestor, inalterada
  -- (continua exigindo evidencia aprovada).
  v_classificacao := private.classificar_status_logistico_pre_cessao(NEW.id, v_politica_versao_id);
  IF coalesce(v_classificacao->>'status', 'INDETERMINADA') = 'INDETERMINADA' THEN
    RAISE EXCEPTION 'A politica exige CT-e/DACTE ou Comprovante de Entrega aprovado antes desta etapa'
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION private.validar_logistica_antes_transicao_nf() IS
  'Trigger de notas_fiscais: para a transicao para "submetida" exige apenas evidencia logistica vigente (regra de submissao); para "aprovada" continua exigindo evidencia aprovada (regra de aprovacao do Gestor, inalterada).';

COMMIT;
