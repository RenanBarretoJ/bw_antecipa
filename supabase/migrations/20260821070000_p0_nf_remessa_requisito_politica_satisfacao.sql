-- P0 Claude: conecta o requisito de politica `nf_remessa` a fonte real de
-- satisfacao (nota_fiscal_remessas.status_validacao), em vez de deixa-lo
-- cair no fluxo generico de upload/analise documental (que nunca teria
-- documento_id/documento_versoes para este tipo -- GENERIC_DOCUMENT_
-- INSTANCE_MISMATCH).
--
-- Regra: requisito nf_remessa fica SATISFEITO quando existir >=1
-- nota_fiscal_remessas.status_validacao='VALIDADA' vinculada a mesma NF de
-- venda; REVISAO_MANUAL/REJEITADA nao satisfazem; se uma remessa antes
-- valida deixar de ser (nao ha hoje um caminho de UPDATE, mas o trigger
-- cobre a coluna por seguranca), o requisito volta a PENDENTE.
--
-- Nao cria documentos_repositorio/documento_versoes fake -- apenas
-- persiste o status derivado em documento_requisito_instancias.status,
-- a mesma coluna que o checklist (cedente/gestor) e o resumo documental
-- do gestor ja leem genericamente hoje.

BEGIN;

CREATE OR REPLACE FUNCTION private.reconciliar_requisito_nf_remessa(p_nota_fiscal_venda_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_satisfeito boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.nota_fiscal_remessas r
    WHERE r.nota_fiscal_venda_id = p_nota_fiscal_venda_id
      AND r.status_validacao = 'VALIDADA'
  ) INTO v_satisfeito;

  UPDATE public.documento_requisito_instancias
  SET status = 'satisfeito', satisfeito_em = now()
  WHERE nota_fiscal_id = p_nota_fiscal_venda_id
    AND tipo_documento_codigo_snapshot = 'nf_remessa'
    AND status = 'pendente'
    AND v_satisfeito;

  UPDATE public.documento_requisito_instancias
  SET status = 'pendente', satisfeito_em = NULL, versao_aprovada_id = NULL
  WHERE nota_fiscal_id = p_nota_fiscal_venda_id
    AND tipo_documento_codigo_snapshot = 'nf_remessa'
    AND status = 'satisfeito'
    AND NOT v_satisfeito;
END;
$function$;

REVOKE ALL ON FUNCTION private.reconciliar_requisito_nf_remessa(uuid) FROM PUBLIC, anon, authenticated;

-- Trigger: toda vez que uma remessa e cadastrada, ou seu status_validacao
-- muda (hoje so ha caminho de INSERT via registrar_nota_fiscal_remessa,
-- mas o trigger tambem cobre UPDATE para nao depender de nenhum caminho
-- futuro de revisao ainda nao implementado), reconcilia o requisito da
-- venda correspondente.
CREATE OR REPLACE FUNCTION private.trigger_reconciliar_requisito_nf_remessa()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM private.reconciliar_requisito_nf_remessa(NEW.nota_fiscal_venda_id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS nota_fiscal_remessas_reconciliar_requisito ON public.nota_fiscal_remessas;
CREATE TRIGGER nota_fiscal_remessas_reconciliar_requisito
  AFTER INSERT OR UPDATE OF status_validacao ON public.nota_fiscal_remessas
  FOR EACH ROW EXECUTE FUNCTION private.trigger_reconciliar_requisito_nf_remessa();

-- Reconcilia tambem no momento da instanciacao dos requisitos (caso a
-- politica passe a exigir nf_remessa, ou a NF seja reprocessada, depois de
-- uma remessa VALIDADA ja existir) -- mesma assinatura, sem novos
-- parametros, sem necessidade de novo GRANT.
CREATE OR REPLACE FUNCTION public.instanciar_requisitos_nota(
  p_nota_fiscal_id uuid,
  p_politica_operacional_id uuid,
  p_politica_versao_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nf_cedente uuid;
  nf_cedente_fundo uuid;
  nf_fundo uuid;
  version_number integer;
  affected_count integer;
  reconciliation jsonb;
BEGIN
  IF auth.uid() IS NULL OR get_user_role() NOT IN ('gestor', 'cedente') THEN
    RAISE EXCEPTION 'Usuario sem permissao para instanciar requisitos';
  END IF;

  SELECT cedente_id, cedente_fundo_id, fundo_id
    INTO nf_cedente, nf_cedente_fundo, nf_fundo
  FROM public.notas_fiscais
  WHERE id = p_nota_fiscal_id;

  IF nf_cedente IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal nao encontrada';
  END IF;

  IF nf_cedente_fundo IS NULL OR nf_fundo IS NULL THEN
    RAISE EXCEPTION 'Nota fiscal sem contexto cedente-fundo/fundo';
  END IF;

  IF get_user_role() = 'cedente' AND nf_cedente <> get_user_cedente_id() THEN
    RAISE EXCEPTION 'Nota fiscal fora do cedente autenticado';
  END IF;

  SELECT pov.versao
    INTO version_number
  FROM public.politica_operacional_versoes pov
  JOIN public.politicas_operacionais po
    ON po.id = pov.politica_operacional_id
  JOIN public.cedente_fundo_politicas cfp
    ON cfp.politica_operacional_id = po.id
   AND cfp.cedente_fundo_id = nf_cedente_fundo
   AND cfp.status = 'ativa'
   AND cfp.vigente_desde <= now()
   AND (cfp.vigente_ate IS NULL OR cfp.vigente_ate > now())
  WHERE pov.id = p_politica_versao_id
    AND po.id = p_politica_operacional_id
    AND po.fundo_id = nf_fundo
    AND po.status = 'ativa'
    AND pov.fundo_id = nf_fundo
    AND pov.publicada_em IS NOT NULL
    AND pov.vigente_ate IS NULL
  ORDER BY cfp.vigente_desde DESC
  LIMIT 1;

  IF version_number IS NULL THEN
    RAISE EXCEPTION 'Politica operacional publicada nao vinculada ao contexto da NF';
  END IF;

  WITH candidatos AS (
    SELECT r.*, dt.id AS resolved_documento_tipo_id, coalesce(dt.cardinalidade, 'por_nf') AS cardinalidade
    FROM public.politica_requisitos_documentais r
    LEFT JOIN public.documento_tipos dt ON dt.codigo = r.tipo_documento_codigo
    WHERE r.politica_operacional_versao_id = p_politica_versao_id
      AND r.escopo = 'nf_pre_cessao'
      AND r.ativo
  ),
  por_nf AS (
    SELECT c.id, c.politica_operacional_id, c.politica_operacional_versao_id, c.resolved_documento_tipo_id AS documento_tipo_id,
      c.tipo_documento_codigo, c.escopo, c.obrigatorio, c.prazo_dias_corridos, c.formatos_aceitos,
      c.nivel_validacao, c.quantidade_minima, c.responsavel_upload, c.responsavel_aprovacao,
      NULL::uuid AS parcela_id
    FROM candidatos c
    WHERE c.cardinalidade = 'por_nf'
  ),
  por_parcela AS (
    SELECT c.id, c.politica_operacional_id, c.politica_operacional_versao_id, c.resolved_documento_tipo_id AS documento_tipo_id,
      c.tipo_documento_codigo, c.escopo, c.obrigatorio, c.prazo_dias_corridos, c.formatos_aceitos,
      c.nivel_validacao, c.quantidade_minima, c.responsavel_upload, c.responsavel_aprovacao,
      p.id AS parcela_id
    FROM candidatos c
    JOIN public.nota_fiscal_parcelas p ON p.nota_fiscal_id = p_nota_fiscal_id
    WHERE c.cardinalidade = 'por_parcela'
  ),
  todos AS (
    SELECT * FROM por_nf UNION ALL SELECT * FROM por_parcela
  )
  INSERT INTO public.documento_requisito_instancias (
    politica_requisito_id, politica_operacional_id, politica_operacional_versao_id, politica_versao,
    documento_tipo_id, tipo_documento_codigo_snapshot, escopo_snapshot, nota_fiscal_id, parcela_id, cedente_id,
    status, obrigatorio, prazo_limite, formatos_aceitos_snapshot, nivel_validacao_snapshot,
    quantidade_minima_snapshot, responsavel_upload_snapshot, responsavel_aprovacao_snapshot
  )
  SELECT t.id, t.politica_operacional_id, t.politica_operacional_versao_id, version_number,
    t.documento_tipo_id, t.tipo_documento_codigo, t.escopo, p_nota_fiscal_id, t.parcela_id, nf_cedente,
    'pendente', t.obrigatorio,
    CASE WHEN t.prazo_dias_corridos IS NULL THEN NULL ELSE (CURRENT_DATE + t.prazo_dias_corridos) END,
    t.formatos_aceitos, t.nivel_validacao, t.quantidade_minima, t.responsavel_upload, t.responsavel_aprovacao
  FROM todos t
  ON CONFLICT (politica_requisito_id, nota_fiscal_id, parcela_id) DO UPDATE
    SET documento_tipo_id = COALESCE(EXCLUDED.documento_tipo_id, documento_requisito_instancias.documento_tipo_id);

  GET DIAGNOSTICS affected_count = ROW_COUNT;

  UPDATE public.documento_requisito_instancias dri
  SET documento_tipo_id = dt.id
  FROM public.documento_tipos dt
  WHERE dri.nota_fiscal_id = p_nota_fiscal_id
    AND dt.codigo = dri.tipo_documento_codigo_snapshot
    AND dri.documento_tipo_id IS DISTINCT FROM dt.id;

  reconciliation := public.reconciliar_documentos_base_nf(p_nota_fiscal_id);

  PERFORM private.reconciliar_requisito_nf_remessa(p_nota_fiscal_id);

  RETURN jsonb_build_object(
    'nota_fiscal_id', p_nota_fiscal_id,
    'inseridos_ou_atualizados', affected_count,
    'documentos_base_reconciliados', COALESCE((reconciliation->>'reconciliados')::integer, 0),
    'politica_versao', version_number,
    'cedente_fundo_id', nf_cedente_fundo,
    'fundo_id', nf_fundo
  );
END;
$$;

REVOKE ALL ON FUNCTION public.instanciar_requisitos_nota(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.instanciar_requisitos_nota(uuid, uuid, uuid) TO authenticated;

COMMIT;
