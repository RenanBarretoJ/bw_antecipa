BEGIN;

-- Super Admin administra importações e publicação, mas a leitura canônica
-- operacional continua dependente de vínculo gestor ativo com o fundo.
DROP POLICY IF EXISTS rlx_estoque_super_admin_select ON public.rlx_estoque_posicoes;
DROP POLICY IF EXISTS rlx_aquisicoes_super_admin_select ON public.rlx_aquisicao_movimentos;
DROP POLICY IF EXISTS rlx_liquidacoes_super_admin_select ON public.rlx_liquidacao_movimentos;
DROP POLICY IF EXISTS rlx_carteira_super_admin_select ON public.rlx_carteira_snapshots;

COMMIT;
