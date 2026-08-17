BEGIN;

-- O dashboard do gestor e SECURITY INVOKER e consulta estas duas tabelas.
-- O hardening P2.6.4 removeu os grants de SELECT, embora as consultas
-- autenticadas continuem protegidas por RLS.
ALTER TABLE public.documentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contas_escrow ENABLE ROW LEVEL SECURITY;

-- A policy legada autorizava qualquer gestor a ler documentos de todos os
-- cedentes. Substitui-la antes de restaurar o grant evita reabrir acesso
-- cruzado entre fundos pela Data API.
DROP POLICY IF EXISTS documentos_gestor_all ON public.documentos;
DROP POLICY IF EXISTS documentos_gestor_multifundo_select ON public.documentos;

CREATE POLICY documentos_gestor_multifundo_select
ON public.documentos
FOR SELECT
TO authenticated
USING (
  public.get_user_role() = 'gestor'
  AND EXISTS (
    SELECT 1
    FROM public.cedente_fundos cf
    WHERE cf.cedente_id = documentos.cedente_id
      AND cf.status IN ('ativo', 'suspenso')
      AND (SELECT private.usuario_tem_acesso_fundo(cf.fundo_id))
  )
);

REVOKE ALL PRIVILEGES ON TABLE public.documentos FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.documentos FROM authenticated;
GRANT SELECT ON TABLE public.documentos TO authenticated;

REVOKE ALL PRIVILEGES ON TABLE public.contas_escrow FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.contas_escrow FROM authenticated;
GRANT SELECT ON TABLE public.contas_escrow TO authenticated;

COMMIT;
