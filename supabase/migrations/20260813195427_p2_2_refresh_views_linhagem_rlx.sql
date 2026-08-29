BEGIN;

CREATE OR REPLACE VIEW public.rlx_estoque_atual
WITH (security_invoker = true)
AS SELECT * FROM public.rlx_estoque_posicoes WHERE vigente;

CREATE OR REPLACE VIEW public.rlx_aquisicoes_atuais
WITH (security_invoker = true)
AS SELECT * FROM public.rlx_aquisicao_movimentos WHERE vigente;

CREATE OR REPLACE VIEW public.rlx_liquidacoes_atuais
WITH (security_invoker = true)
AS SELECT * FROM public.rlx_liquidacao_movimentos WHERE vigente;

CREATE OR REPLACE VIEW public.rlx_carteira_atual
WITH (security_invoker = true)
AS SELECT * FROM public.rlx_carteira_snapshots WHERE vigente;

GRANT SELECT ON TABLE
  public.rlx_estoque_atual,
  public.rlx_aquisicoes_atuais,
  public.rlx_liquidacoes_atuais,
  public.rlx_carteira_atual
TO authenticated;

COMMIT;
