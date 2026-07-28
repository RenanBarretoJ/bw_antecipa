-- Permite registrar comprovantes de entrega que não são especificamente
-- CT-e ou canhoto. A função de upload documental já usa este evento para
-- requisitos genéricos de pós-cessão.

DO $$
BEGIN
  IF to_regclass('public.eventos_entrega') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.eventos_entrega
    DROP CONSTRAINT IF EXISTS eventos_entrega_tipo_check;

  ALTER TABLE public.eventos_entrega
    ADD CONSTRAINT eventos_entrega_tipo_check CHECK (tipo_evento IN (
      'cessao_efetivada',
      'cte_pendente',
      'cte_enviado',
      'cte_aprovado',
      'cte_rejeitado',
      'cte_atrasado',
      'canhoto_pendente',
      'canhoto_enviado',
      'canhoto_aprovado',
      'canhoto_rejeitado',
      'canhoto_atrasado',
      'documento_entrega_enviado',
      'entrega_confirmada',
      'entrega_com_pendencia',
      'devolucao_registrada'
    ));
END;
$$;
