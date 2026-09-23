-- C2 - compatibilidade de producao.
--
-- Producao ainda possui a policy historica permissiva
-- `taxas_consultor_select`, removida anteriormente em homologacao. Como
-- policies permissivas sao combinadas por OR, ela anularia o filtro por
-- vinculo ativo criado pelo C2. Esta migration remove somente essa policy
-- legada e pode ser aplicada com seguranca mesmo quando ela ja nao existe.

BEGIN;

DROP POLICY IF EXISTS taxas_consultor_select ON public.taxas_cedente;

NOTIFY pgrst, 'reload schema';

COMMIT;
