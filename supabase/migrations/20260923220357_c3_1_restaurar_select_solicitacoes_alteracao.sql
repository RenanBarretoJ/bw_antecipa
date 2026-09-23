BEGIN;

-- A policy manager_select do C3 filtra as linhas por Fundo/Consultor, mas o
-- papel authenticated tambem precisa do privilegio de tabela para que o
-- Gestor consiga listar a solicitacao pendente na tela do Cedente.
GRANT SELECT ON TABLE public.solicitacoes_alteracao_cedente TO authenticated;

COMMIT;
