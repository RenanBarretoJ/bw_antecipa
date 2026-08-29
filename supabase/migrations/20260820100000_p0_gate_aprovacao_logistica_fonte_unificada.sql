BEGIN;

-- P0: o gate de APROVACAO do Gestor (avaliar_gate_logistico_pre_cessao_nfs
-- -> private.classificar_status_logistico_pre_cessao) so reconhecia
-- evidencia via "envio antecipado" (evidencias_logisticas_antecipadas).
-- CT-e/Comprovante enviado e aprovado pelo fluxo REGULAR do checklist
-- (documento_requisito_instancias/documento_versoes, quando a politica
-- define o requisito como nf_pre_cessao normal) ficava invisivel para a
-- classificacao, mesmo apos aprovado -- reproduzindo, no gate de
-- aprovacao, a mesma divergencia de fonte ja corrigida no gate de
-- submissao (evidenciasDoChecklistRegular).
--
-- Esta migration une as duas fontes na propria classificacao, preservando
-- integralmente a regra OR (Comprovante > CT-e), o criterio de vitoria
-- (aprovado, mais recente) e a assinatura/contrato da funcao. Nao duplica
-- Storage nem cria segunda evidencia fisica -- apenas amplia a origem dos
-- dados já existentes que a classificacao considera.

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

CREATE OR REPLACE FUNCTION private.classificar_status_logistico_pre_cessao(
  p_nota_fiscal_id uuid,
  p_politica_operacional_versao_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  vencedor record;
BEGIN
  SELECT
    ev.familia_documental,
    ev.documento_id,
    ev.documento_versao_id AS documento_versao_atual_id,
    ev.analise_id,
    ev.resultado,
    ev.analisado_por,
    ev.analisado_em
  INTO vencedor
  FROM (
    -- Fonte 1: envio antecipado.
    SELECT
      ela.familia_documental,
      elv.documento_id,
      elv.documento_versao_id,
      da.id AS analise_id,
      da.resultado,
      da.analisado_por,
      da.analisado_em,
      coalesce(da.analisado_em, dv.enviado_em, dv.created_at) AS ordenacao_em,
      elv.created_at AS vinculo_created_at,
      elv.id AS vinculo_id
    FROM public.evidencias_logisticas_antecipadas ela
    JOIN public.evidencia_logistica_versoes elv
      ON elv.evidencia_logistica_id = ela.id
    JOIN public.documento_versoes dv ON dv.id = elv.documento_versao_id
    LEFT JOIN LATERAL (
      SELECT a.id, a.resultado, a.analisado_por, a.analisado_em
      FROM public.documento_analises a
      WHERE a.documento_versao_id = dv.id
      ORDER BY a.analisado_em DESC, a.id DESC
      LIMIT 1
    ) da ON true
    WHERE ela.nota_fiscal_id = p_nota_fiscal_id
      AND ela.politica_operacional_versao_id = p_politica_operacional_versao_id
      AND (dv.status = 'aprovado' OR da.resultado = 'aprovado')

    UNION ALL

    -- Fonte 2: checklist documental regular (requisito nf_pre_cessao
    -- comum, sem passar pelo envio antecipado).
    SELECT
      prd.familia_documental,
      dri.documento_id,
      dv.id AS documento_versao_id,
      da.id AS analise_id,
      da.resultado,
      da.analisado_por,
      da.analisado_em,
      coalesce(da.analisado_em, dv.enviado_em, dv.created_at) AS ordenacao_em,
      dv.created_at AS vinculo_created_at,
      dv.id AS vinculo_id
    FROM public.documento_requisito_instancias dri
    JOIN public.politica_requisitos_documentais prd ON prd.id = dri.politica_requisito_id
    JOIN public.documento_versoes dv ON dv.documento_id = dri.documento_id
    LEFT JOIN LATERAL (
      SELECT a.id, a.resultado, a.analisado_por, a.analisado_em
      FROM public.documento_analises a
      WHERE a.documento_versao_id = dv.id
      ORDER BY a.analisado_em DESC, a.id DESC
      LIMIT 1
    ) da ON true
    WHERE dri.nota_fiscal_id = p_nota_fiscal_id
      AND dri.politica_operacional_versao_id = p_politica_operacional_versao_id
      AND dri.escopo_snapshot = 'nf_pre_cessao'
      AND prd.familia_documental IN ('cte', 'comprovante_entrega')
      AND (dv.status = 'aprovado' OR da.resultado = 'aprovado')
  ) ev
  ORDER BY
    CASE ev.familia_documental WHEN 'comprovante_entrega' THEN 0 WHEN 'cte' THEN 1 ELSE 2 END,
    ev.ordenacao_em DESC,
    ev.vinculo_created_at DESC,
    ev.vinculo_id DESC
  LIMIT 1;

  IF vencedor.documento_id IS NULL THEN
    RETURN jsonb_build_object(
      'status', 'INDETERMINADA',
      'familia_vencedora', NULL,
      'documento_id', NULL,
      'documento_versao_id', NULL,
      'documento_analise_id', NULL,
      'analisado_por', NULL,
      'analisado_em', NULL,
      'fundamento', 'sem_evidencia_aprovada',
      'regra_classificacao', 'ENTREGUE>EM_TRANSITO>INDETERMINADA',
      'versao_resolvedor', 1
    );
  END IF;

  RETURN jsonb_build_object(
    'status', CASE vencedor.familia_documental WHEN 'comprovante_entrega' THEN 'ENTREGUE' ELSE 'EM_TRANSITO' END,
    'familia_vencedora', vencedor.familia_documental,
    'documento_id', vencedor.documento_id,
    'documento_versao_id', vencedor.documento_versao_atual_id,
    'documento_analise_id', vencedor.analise_id,
    'analisado_por', vencedor.analisado_por,
    'analisado_em', vencedor.analisado_em,
    'fundamento', CASE vencedor.familia_documental WHEN 'comprovante_entrega' THEN 'comprovante_entrega_aprovado' ELSE 'cte_aprovado' END,
    'regra_classificacao', 'ENTREGUE>EM_TRANSITO>INDETERMINADA',
    'versao_resolvedor', 1
  );
END;
$$;

COMMENT ON FUNCTION private.classificar_status_logistico_pre_cessao(uuid, uuid) IS
  'Classifica o status logistico pre-cessao (ENTREGUE/EM_TRANSITO/INDETERMINADA) combinando evidencia aprovada do envio antecipado e do checklist documental regular (nf_pre_cessao), sem duplicar Storage nem exigir reenvio duplicado em duas fontes.';

COMMIT;
