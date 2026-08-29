-- Corrige o fluxo de status da entrega pós-cessão.
--
-- Regras:
-- 1) Desembolso cria a entrega como em_transito.
-- 2) Upload de comprovante/canhoto ou CT-e coloca a entrega em aguardando_validacao.
-- 3) Aprovação dos documentos obrigatórios da entrega confirma a entrega como entregue.
--
-- A regra anterior exigia CT-e aprovado E canhoto aprovado sempre. Isso impedia
-- a confirmação quando a política exigia apenas canhoto/comprovante de entrega.

CREATE OR REPLACE FUNCTION public.marcar_entrega_aguardando_validacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entrega_id uuid;
  status_atual text;
BEGIN
  entrega_id := NEW.nota_fiscal_entrega_id;

  IF entrega_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status_entrega
    INTO status_atual
  FROM public.nota_fiscal_entregas
  WHERE id = entrega_id;

  IF status_atual IN ('em_transito', 'entrega_com_pendencia') THEN
    UPDATE public.nota_fiscal_entregas
    SET status_entrega = 'aguardando_validacao',
        motivo_pendencia = NULL
    WHERE id = entrega_id;

    PERFORM public.registrar_evento_entrega(
      entrega_id,
      'canhoto_enviado',
      status_atual,
      'aguardando_validacao',
      'sistema',
      jsonb_build_object('origem', 'canhotos')
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.marcar_entrega_cte_aguardando_validacao()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entrega record;
BEGIN
  FOR entrega IN
    SELECT id, status_entrega
    FROM public.nota_fiscal_entregas
    WHERE nota_fiscal_id = NEW.nota_fiscal_id
      AND status_entrega IN ('em_transito', 'entrega_com_pendencia')
  LOOP
    UPDATE public.nota_fiscal_entregas
    SET status_entrega = 'aguardando_validacao',
        motivo_pendencia = NULL
    WHERE id = entrega.id;

    PERFORM public.registrar_evento_entrega(
      entrega.id,
      'cte_enviado',
      entrega.status_entrega,
      'aguardando_validacao',
      'sistema',
      jsonb_build_object('origem', 'cte_notas_fiscais', 'cte_id', NEW.cte_id)
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS canhotos_marcar_entrega_aguardando_validacao ON public.canhotos;
CREATE TRIGGER canhotos_marcar_entrega_aguardando_validacao
  AFTER INSERT ON public.canhotos
  FOR EACH ROW
  EXECUTE FUNCTION public.marcar_entrega_aguardando_validacao();

DROP TRIGGER IF EXISTS cte_notas_fiscais_marcar_entrega_aguardando_validacao ON public.cte_notas_fiscais;
CREATE TRIGGER cte_notas_fiscais_marcar_entrega_aguardando_validacao
  AFTER INSERT ON public.cte_notas_fiscais
  FOR EACH ROW
  EXECUTE FUNCTION public.marcar_entrega_cte_aguardando_validacao();

CREATE OR REPLACE FUNCTION public.avaliar_conclusao_entrega(p_nota_fiscal_entrega_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  entrega record;
  old_status text;
  obrigatorios_total integer;
  obrigatorios_pendentes integer;
  canhoto_data_assinatura date;
  canhoto_recebido_em timestamptz;
  tem_documento_aprovado boolean;
BEGIN
  SELECT * INTO entrega
  FROM public.nota_fiscal_entregas
  WHERE id = p_nota_fiscal_entrega_id
  FOR UPDATE;

  IF entrega.id IS NULL THEN
    RAISE EXCEPTION 'Entrega nao encontrada';
  END IF;

  IF entrega.status_entrega IN ('nao_aplicavel', 'entregue', 'cancelada', 'devolvida') THEN
    RETURN jsonb_build_object('entrega_id', p_nota_fiscal_entrega_id, 'status', entrega.status_entrega);
  END IF;

  old_status := entrega.status_entrega;

  SELECT count(*),
         count(*) FILTER (
           WHERE obrigatorio = true
             AND status NOT IN ('satisfeito', 'dispensado', 'cancelado')
         )
    INTO obrigatorios_total, obrigatorios_pendentes
  FROM public.documento_requisito_instancias
  WHERE nota_fiscal_entrega_id = p_nota_fiscal_entrega_id
    AND obrigatorio = true;

  SELECT c.data_assinatura, c.recebido_em
    INTO canhoto_data_assinatura, canhoto_recebido_em
  FROM public.canhotos c
  WHERE c.nota_fiscal_entrega_id = p_nota_fiscal_entrega_id
    AND c.status = 'aprovado'
    AND c.documento_versao_aprovada_id IS NOT NULL
  ORDER BY c.analisado_em DESC NULLS LAST, c.created_at DESC
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM public.documento_requisito_instancias
    WHERE nota_fiscal_entrega_id = p_nota_fiscal_entrega_id
      AND status = 'satisfeito'
      AND versao_aprovada_id IS NOT NULL
  ) INTO tem_documento_aprovado;

  IF obrigatorios_total > 0 AND obrigatorios_pendentes = 0 THEN
    UPDATE public.nota_fiscal_entregas
    SET status_entrega = 'entregue',
        data_entrega = COALESCE(canhoto_data_assinatura, canhoto_recebido_em::date, now()::date),
        entrega_confirmada_em = now(),
        motivo_pendencia = NULL
    WHERE id = p_nota_fiscal_entrega_id;

    PERFORM public.registrar_evento_entrega(p_nota_fiscal_entrega_id, 'entrega_confirmada', old_status, 'entregue', 'sistema', jsonb_build_object('criterio', 'requisitos_obrigatorios_satisfeitos'));
    RETURN jsonb_build_object('entrega_id', p_nota_fiscal_entrega_id, 'status', 'entregue');
  END IF;

  -- Compatibilidade para bases sem instâncias obrigatórias logísticas:
  -- se não houver requisito obrigatório, mas existir documento aprovado
  -- vinculado à entrega, considera a entrega confirmada.
  IF obrigatorios_total = 0 AND tem_documento_aprovado THEN
    UPDATE public.nota_fiscal_entregas
    SET status_entrega = 'entregue',
        data_entrega = COALESCE(canhoto_data_assinatura, canhoto_recebido_em::date, now()::date),
        entrega_confirmada_em = now(),
        motivo_pendencia = NULL
    WHERE id = p_nota_fiscal_entrega_id;

    PERFORM public.registrar_evento_entrega(p_nota_fiscal_entrega_id, 'entrega_confirmada', old_status, 'entregue', 'sistema', jsonb_build_object('criterio', 'documento_aprovado_sem_requisito_obrigatorio'));
    RETURN jsonb_build_object('entrega_id', p_nota_fiscal_entrega_id, 'status', 'entregue');
  END IF;

  IF old_status <> 'aguardando_validacao' AND tem_documento_aprovado THEN
    UPDATE public.nota_fiscal_entregas
    SET status_entrega = 'aguardando_validacao',
        motivo_pendencia = NULL
    WHERE id = p_nota_fiscal_entrega_id;

    PERFORM public.registrar_evento_entrega(p_nota_fiscal_entrega_id, 'entrega_em_validacao', old_status, 'aguardando_validacao', 'sistema', '{}'::jsonb);
    RETURN jsonb_build_object('entrega_id', p_nota_fiscal_entrega_id, 'status', 'aguardando_validacao');
  END IF;

  RETURN jsonb_build_object('entrega_id', p_nota_fiscal_entrega_id, 'status', old_status);
END;
$$;

REVOKE ALL ON FUNCTION public.marcar_entrega_aguardando_validacao() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_entrega_aguardando_validacao() TO authenticated;
REVOKE ALL ON FUNCTION public.marcar_entrega_cte_aguardando_validacao() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_entrega_cte_aguardando_validacao() TO authenticated;
