-- P0 (achado adicional durante a verificacao ao vivo): o hardening de ACL
-- (P2.6.4) revogou SELECT de authenticated em public.representantes e nunca
-- foi restaurado, ao contrario de cedentes/documentos/contas_escrow. O
-- Gestor nao conseguia listar representantes (permission denied, engolido
-- silenciosamente pelo client), caindo sempre no fallback legado da tela de
-- detalhe do Cedente — que so exibe RG/CPF e Procuracao, nunca Comprovante
-- de Renda nem Comprovante de Residencia do Representante. Isso e uma causa
-- mais fundamental do relato "Gestor enxerga apenas parte do conjunto
-- documental enviado" do que a inconsistencia de rotulos/tipos.
--
-- A policy legada representantes_gestor_all (FOR ALL, sem checagem de
-- fundo) tambem nunca foi migrada para o padrao multifundo ja aplicado em
-- cedentes/documentos. Como INSERT/UPDATE/DELETE de authenticated ja estao
-- revogados nesta tabela desde 20260818191418, so a leitura precisa ser
-- restaurada, e de forma escopada por fundo.

BEGIN;

GRANT SELECT ON TABLE public.representantes TO authenticated;

DROP POLICY IF EXISTS representantes_gestor_all ON public.representantes;
CREATE POLICY representantes_gestor_multifundo_select
  ON public.representantes
  FOR SELECT
  TO authenticated
  USING (
    (SELECT public.get_user_role()) = 'gestor'
    AND private.gestor_tem_acesso_cedente(cedente_id)
  );

COMMIT;
