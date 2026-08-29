-- Remove policies do schema legado de producao que concediam acesso global a
-- qualquer profile gestor. As migrations multifundo criam policies canonicas
-- por usuario_fundos/cedente_fundos, mas os nomes legados abaixo nao eram
-- conhecidos pelos DROP POLICY historicos e, portanto, sobreviviam ao upgrade.
--
-- Nao ha substituicao permissiva aqui: leitura multifundo continua atendida
-- pelas policies canonicas e mutacoes administrativas permanecem em RPCs
-- autorizadas/server-side.

DROP POLICY IF EXISTS "Gestores podem gerenciar fundos" ON public.fundos;
DROP POLICY IF EXISTS "Gestores podem ver fundos" ON public.fundos;

DROP POLICY IF EXISTS "Gestores podem gerenciar devedores" ON public.devedores_solidarios;
DROP POLICY IF EXISTS "Gestores podem ver devedores" ON public.devedores_solidarios;

DROP POLICY IF EXISTS taxas_gestor_all ON public.taxas_cedente;

-- Policies amplas atualmente inertes por ACL tambem sao removidas para que um
-- grant futuro nao reintroduza autorizacao global acidentalmente.
DROP POLICY IF EXISTS ca_gestor_all ON public.cedente_acessos;
DROP POLICY IF EXISTS notificacoes_gestor_all ON public.notificacoes;
DROP POLICY IF EXISTS sacados_gestor_all ON public.sacados;
DROP POLICY IF EXISTS testemunhas_gestor_all ON public.testemunhas;
