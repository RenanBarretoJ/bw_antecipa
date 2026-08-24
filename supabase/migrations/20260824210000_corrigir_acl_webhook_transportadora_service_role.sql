-- Restaura somente as leituras server-side exigidas pelo webhook de
-- comprovantes de entrega. O service_role continua sem escrita direta nas
-- configuracoes/tokens, e anon/authenticated nao recebem novos privilegios.

BEGIN;

GRANT SELECT ON TABLE public.integracoes_transportadoras TO service_role;
GRANT SELECT ON TABLE public.integracao_logistica_webhook_eventos TO service_role;
GRANT SELECT ON TABLE public.nota_fiscal_remessas TO service_role;

COMMIT;
