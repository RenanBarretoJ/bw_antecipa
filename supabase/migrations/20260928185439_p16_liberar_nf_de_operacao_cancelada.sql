BEGIN;

-- P16: estende o predicado P14 usado pelas duas sobrecargas de solicitacao.
-- Cancelamento libera a reserva, sem remover a participacao historica da NF.
CREATE OR REPLACE FUNCTION private.operacao_status_reserva_nf(
  p_status public.operacao_status
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT p_status IN (
    'solicitada'::public.operacao_status,
    'em_analise'::public.operacao_status,
    'aprovada'::public.operacao_status,
    'em_andamento'::public.operacao_status,
    'liquidada'::public.operacao_status,
    'inadimplente'::public.operacao_status
  );
$$;

REVOKE ALL ON FUNCTION private.operacao_status_reserva_nf(public.operacao_status)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION private.operacao_status_reserva_nf(public.operacao_status) IS
  'P16: fonte unica dos status que reservam NF no submit; reprovada e cancelada nao reservam. Demais estados preservam a regra P14.';

COMMIT;
