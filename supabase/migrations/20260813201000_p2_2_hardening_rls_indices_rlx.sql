BEGIN;

-- Views correntes devem respeitar as policies das tabelas-base do invocador.
ALTER VIEW public.rlx_estoque_atual SET (security_invoker = true);
ALTER VIEW public.rlx_aquisicoes_atuais SET (security_invoker = true);
ALTER VIEW public.rlx_liquidacoes_atuais SET (security_invoker = true);
ALTER VIEW public.rlx_carteira_atual SET (security_invoker = true);

-- Acesso técnico global do Super Admin, sem conceder acesso operacional a NFs.
DROP POLICY IF EXISTS rlx_estoque_super_admin_select ON public.rlx_estoque_posicoes;
CREATE POLICY rlx_estoque_super_admin_select ON public.rlx_estoque_posicoes
  FOR SELECT TO authenticated USING (private.usuario_e_super_admin());

DROP POLICY IF EXISTS rlx_aquisicoes_super_admin_select ON public.rlx_aquisicao_movimentos;
CREATE POLICY rlx_aquisicoes_super_admin_select ON public.rlx_aquisicao_movimentos
  FOR SELECT TO authenticated USING (private.usuario_e_super_admin());

DROP POLICY IF EXISTS rlx_liquidacoes_super_admin_select ON public.rlx_liquidacao_movimentos;
CREATE POLICY rlx_liquidacoes_super_admin_select ON public.rlx_liquidacao_movimentos
  FOR SELECT TO authenticated USING (private.usuario_e_super_admin());

DROP POLICY IF EXISTS rlx_carteira_super_admin_select ON public.rlx_carteira_snapshots;
CREATE POLICY rlx_carteira_super_admin_select ON public.rlx_carteira_snapshots
  FOR SELECT TO authenticated USING (private.usuario_e_super_admin());

-- Índices voltados às futuras consultas por título, partes e vencimento.
CREATE INDEX IF NOT EXISTS rlx_estoque_seu_numero_lookup_idx
  ON public.rlx_estoque_posicoes (fundo_id, data_referencia, seu_numero)
  WHERE seu_numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS rlx_estoque_chave_nfe_lookup_idx
  ON public.rlx_estoque_posicoes (fundo_id, data_referencia, chave_nfe)
  WHERE chave_nfe IS NOT NULL;
CREATE INDEX IF NOT EXISTS rlx_estoque_partes_vencimento_idx
  ON public.rlx_estoque_posicoes (fundo_id, cedente_documento, sacado_documento, data_vencimento_original);

CREATE INDEX IF NOT EXISTS rlx_aquisicoes_titulo_lookup_idx
  ON public.rlx_aquisicao_movimentos (fundo_id, data_referencia, seu_numero, id_recebivel)
  WHERE seu_numero IS NOT NULL OR id_recebivel IS NOT NULL;
CREATE INDEX IF NOT EXISTS rlx_aquisicoes_partes_vencimento_idx
  ON public.rlx_aquisicao_movimentos (fundo_id, cedente_documento, sacado_documento, data_vencimento);

CREATE INDEX IF NOT EXISTS rlx_liquidacoes_titulo_lookup_idx
  ON public.rlx_liquidacao_movimentos (fundo_id, data_referencia, seu_numero, id_recebivel)
  WHERE seu_numero IS NOT NULL OR id_recebivel IS NOT NULL;
CREATE INDEX IF NOT EXISTS rlx_liquidacoes_partes_vencimento_idx
  ON public.rlx_liquidacao_movimentos (fundo_id, cedente_documento, sacado_documento, data_vencimento);

COMMIT;
