-- P2.4 - preserva integralmente a escala monetaria do canonico financeiro P2.2.
-- Incremental: a migration estrutural 20260814164101 ja pode estar aplicada.

ALTER TABLE public.rlx_posicao_logistica_execucoes
  ALTER COLUMN valor_total_aquisicao TYPE numeric(24,4),
  ALTER COLUMN valor_matched TYPE numeric(24,4),
  ALTER COLUMN valor_sem_match TYPE numeric(24,4),
  ALTER COLUMN valor_entregue TYPE numeric(24,4),
  ALTER COLUMN valor_em_transito TYPE numeric(24,4),
  ALTER COLUMN valor_indeterminado TYPE numeric(24,4);

ALTER TABLE public.rlx_posicao_logistica_resultados
  ALTER COLUMN valor_nominal TYPE numeric(24,4),
  ALTER COLUMN valor_aquisicao TYPE numeric(24,4);
