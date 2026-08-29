BEGIN;

-- O evento e emitido por avaliar_conclusao_entrega quando ja existe documento
-- aprovado, mas a entrega ainda aguarda a validacao dos demais requisitos.
-- A migration alinha somente o catalogo aceito; nao altera estados nem transicoes.
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
    'canhoto_postergacao_comunicada',
    'documento_entrega_enviado',
    'entrega_em_validacao',
    'entrega_confirmada',
    'entrega_com_pendencia',
    'devolucao_registrada'
  ));

COMMIT;
