-- P2.6.4: matriz canonica de RLS e ACL.
-- Remove somente privilegios classificados como drift material no inventario P2.6.3.
BEGIN;

DO $p264$
BEGIN
  IF to_regclass('public.devedores_solidarios') IS NULL
     OR to_regclass('public.logs_auditoria') IS NULL
     OR to_regclass('public.eventos_dominio') IS NULL THEN
    RAISE EXCEPTION 'P2.6.4: pre-condicoes de RLS ausentes';
  END IF;
  IF to_regprocedure('private.usuario_tem_acesso_fundo(uuid)') IS NULL THEN
    RAISE EXCEPTION 'P2.6.4: helper multifundo ausente';
  END IF;
END
$p264$;

ALTER TABLE public.devedores_solidarios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS devedores_cedente_select ON public.devedores_solidarios;
DROP POLICY IF EXISTS devedores_gestor_all ON public.devedores_solidarios;
DROP POLICY IF EXISTS devedores_gestor_select ON public.devedores_solidarios;
DROP POLICY IF EXISTS devedores_solidarios_cedente_select ON public.devedores_solidarios;
DROP POLICY IF EXISTS devedores_solidarios_gestor_select_multifundo ON public.devedores_solidarios;

CREATE POLICY devedores_solidarios_cedente_select
  ON public.devedores_solidarios
  FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() = 'cedente'
    AND cedente_id = public.get_user_cedente_id()
  );

CREATE POLICY devedores_solidarios_gestor_select_multifundo
  ON public.devedores_solidarios
  FOR SELECT
  TO authenticated
  USING (
    public.get_user_role() = 'gestor'
    AND EXISTS (
      SELECT 1
      FROM public.cedente_fundos cf
      WHERE cf.cedente_id = devedores_solidarios.cedente_id
        AND cf.status = 'ativo'
        AND private.usuario_tem_acesso_fundo(cf.fundo_id)
    )
  );

DROP POLICY IF EXISTS logs_auditoria_gestor_all ON public.logs_auditoria;
DROP POLICY IF EXISTS logs_auditoria_insert ON public.logs_auditoria;
DROP POLICY IF EXISTS logs_auditoria_gestor_select ON public.logs_auditoria;
DROP POLICY IF EXISTS logs_auditoria_insert_usuario ON public.logs_auditoria;

CREATE POLICY logs_auditoria_gestor_select
  ON public.logs_auditoria
  FOR SELECT
  TO authenticated
  USING (public.get_user_role() = 'gestor');

CREATE POLICY logs_auditoria_insert_usuario
  ON public.logs_auditoria
  FOR INSERT
  TO authenticated
  WITH CHECK (
    ator_tipo = 'usuario'
    AND usuario_id = (SELECT auth.uid())
  );

DROP POLICY IF EXISTS eventos_dominio_insert ON public.eventos_dominio;
CREATE POLICY eventos_dominio_insert
  ON public.eventos_dominio
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      public.get_user_role() = 'gestor'
      AND (
        fundo_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.usuario_fundos uf
          WHERE uf.usuario_id = (SELECT auth.uid())
            AND uf.fundo_id = eventos_dominio.fundo_id
            AND uf.status = 'ativo'
        )
      )
    )
    OR (
      public.get_user_role() = 'cedente'
      AND cedente_id = public.get_user_cedente_id()
      AND visibilidade IN ('cedente', 'ambos')
    )
    OR (
      public.get_user_role() = 'sacado'
      AND visibilidade = 'ambos'
      AND (
        (
          nota_fiscal_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.notas_fiscais nf
            WHERE nf.id = eventos_dominio.nota_fiscal_id
              AND nf.cnpj_destinatario = public.get_user_sacado_cnpj()
          )
        )
        OR (
          operacao_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM public.operacoes_nfs onf
            JOIN public.notas_fiscais nf ON nf.id = onf.nota_fiscal_id
            WHERE onf.operacao_id = eventos_dominio.operacao_id
              AND nf.cnpj_destinatario = public.get_user_sacado_cnpj()
          )
        )
      )
    )
  );

DO $p264_acl$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['aquisicoes_atuais','canhotos','carteira_atual','cedente_acessos','cedente_fundo_migracao_legado_relatorio','cedente_fundo_politicas','cedentes','configuracao_cnab_versoes','configuracoes_cnab','contas_escrow','cte_notas_fiscais','ctes','devedores_solidarios','documento_analises','documento_requisito_instancias','documento_tipos','documento_versoes','documento_vinculos','documentos','documentos_gerados','documentos_repositorio','duplicata_correcoes','duplicata_validacoes','duplicata_versoes','duplicatas','estoque_atual','eventos_dominio','eventos_entrega','integracao_execucoes','integracao_fundo_versoes','integracoes_fundo','liquidacoes_atuais','logs_auditoria','mfa_recovery_codes','mfa_reset_solicitacoes','movimentos_escrow','nota_fiscal_entregas','notificacoes','politica_operacional_versoes','politica_requisitos_documentais','politicas_operacionais','profiles','remessas_cnab','remessas_cnab_operacoes','representantes','retornos_integracao','sacados','seguranca_eventos','seguranca_rate_limits','sequencias_remessa','sessoes_elevadas','solicitacoes_alteracao_cedente','template_versoes','templates_documentos','testemunhas']::text[] LOOP
    IF to_regclass(format('public.%I', relation_name)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM anon', relation_name);
    END IF;
  END LOOP;
END
$p264_acl$;

DO $p264_acl$
DECLARE
  relation_name text;
  privilege_name text;
  relation_names text[];
BEGIN
  FOR privilege_name, relation_names IN
    SELECT * FROM (VALUES
      ('DELETE', ARRAY['aquisicoes_atuais','canhotos','carteira_atual','cedente_acessos','cedente_fundo_migracao_legado_relatorio','cedentes','contas_escrow','cte_notas_fiscais','ctes','devedores_solidarios','documento_analises','documento_requisito_instancias','documento_tipos','documento_versoes','documento_vinculos','documentos','documentos_gerados','documentos_repositorio','duplicata_correcoes','duplicata_validacoes','duplicata_versoes','duplicatas','estoque_atual','eventos_dominio','eventos_entrega','liquidacoes_atuais','logs_auditoria','mfa_recovery_codes','mfa_reset_solicitacoes','movimentos_escrow','nota_fiscal_entregas','notificacoes','operacao_calculo_nfs','profiles','remessas_cnab','remessas_cnab_operacoes','representantes','sacados','seguranca_eventos','seguranca_rate_limits','sequencias_remessa','sessoes_elevadas','solicitacoes_alteracao_cedente','testemunhas']::text[]),
      ('INSERT', ARRAY['aquisicoes_atuais','carteira_atual','cedente_acessos','cedente_fundo_migracao_legado_relatorio','cedentes','contas_escrow','devedores_solidarios','documento_analises','documento_requisito_instancias','documento_versoes','documento_vinculos','documentos','documentos_repositorio','duplicata_correcoes','duplicata_validacoes','duplicata_versoes','duplicatas','estoque_atual','liquidacoes_atuais','logs_auditoria','mfa_recovery_codes','mfa_reset_solicitacoes','movimentos_escrow','notificacoes','operacao_calculo_nfs','profiles','representantes','sacados','seguranca_eventos','seguranca_rate_limits','sequencias_remessa','sessoes_elevadas','solicitacoes_alteracao_cedente','testemunhas']::text[]),
      ('SELECT', ARRAY['cedente_acessos','cedentes','contas_escrow','devedores_solidarios','documentos','logs_auditoria','movimentos_escrow','notificacoes','profiles','representantes','sacados','seguranca_rate_limits','solicitacoes_alteracao_cedente','testemunhas']::text[]),
      ('UPDATE', ARRAY['aquisicoes_atuais','carteira_atual','cedente_acessos','cedente_fundo_migracao_legado_relatorio','cedentes','contas_escrow','devedores_solidarios','documento_analises','documento_requisito_instancias','documento_versoes','documento_vinculos','documentos','documentos_repositorio','duplicata_correcoes','duplicata_validacoes','duplicata_versoes','duplicatas','estoque_atual','eventos_dominio','liquidacoes_atuais','logs_auditoria','mfa_recovery_codes','mfa_reset_solicitacoes','movimentos_escrow','notificacoes','operacao_calculo_nfs','profiles','representantes','sacados','seguranca_eventos','seguranca_rate_limits','sequencias_remessa','sessoes_elevadas','solicitacoes_alteracao_cedente','testemunhas']::text[])
    ) AS grouped(privilege_name, relation_names)
  LOOP
    FOREACH relation_name IN ARRAY relation_names LOOP
      IF to_regclass(format('public.%I', relation_name)) IS NOT NULL THEN
        EXECUTE format('REVOKE %s ON TABLE public.%I FROM authenticated', privilege_name, relation_name);
      END IF;
    END LOOP;
  END LOOP;
END
$p264_acl$;

DO $p264_acl$
DECLARE
  relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['aquisicao_movimentos','aquisicoes_atuais','carteira_atual','carteira_snapshots','cedente_acessos','cedentes','comunicacao_configuracao_versoes','comunicacao_configuracoes','comunicacao_execucoes','comunicacao_item_estagios','comunicacao_itens','comunicacao_template_versoes','comunicacao_tentativas','comunicacoes','consultor_cedente','contas_escrow','devedores_solidarios','documentos','estoque_atual','estoque_posicoes','importacao_arquivos','importacao_ciclos','importacao_linhas','importacoes_financeiras','liquidacao_movimentos','liquidacoes_atuais','logs_auditoria','movimentos_escrow','notas_fiscais','notificacoes','operacoes','operacoes_nfs','profiles','representantes','sacados','solicitacoes_alteracao_cedente','taxas_cedente','testemunhas']::text[] LOOP
    IF to_regclass(format('public.%I', relation_name)) IS NOT NULL THEN
      EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM service_role', relation_name);
    END IF;
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY['aquisicao_movimentos','carteira_snapshots','cedente_acessos','cedentes','comunicacao_configuracao_versoes','comunicacao_configuracoes','comunicacao_execucoes','comunicacao_item_estagios','comunicacao_itens','comunicacao_template_versoes','comunicacao_tentativas','comunicacoes','consultor_cedente','contas_escrow','devedores_solidarios','documentos','estoque_posicoes','importacao_arquivos','importacao_ciclos','importacao_linhas','importacoes_financeiras','liquidacao_movimentos','logs_auditoria','movimentos_escrow','notas_fiscais','notificacoes','operacoes','operacoes_nfs','profiles','representantes','sacados','solicitacoes_alteracao_cedente','taxas_cedente','testemunhas']::text[] LOOP
    IF to_regclass(format('public.%I', relation_name)) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', relation_name);
    END IF;
  END LOOP;
  FOREACH relation_name IN ARRAY ARRAY['aquisicoes_atuais','carteira_atual','estoque_atual','liquidacoes_atuais']::text[] LOOP
    IF to_regclass(format('public.%I', relation_name)) IS NOT NULL THEN
      EXECUTE format('GRANT SELECT ON TABLE public.%I TO service_role', relation_name);
    END IF;
  END LOOP;
END
$p264_acl$;

DO $p264_acl$
DECLARE
  item record;
  names_anon text[] := ARRAY['analisar_canhoto_documento','analisar_cte_documento','analisar_documento_versao','avaliar_conclusao_entrega','desembolsar_operacao_com_logistica','documento_tipo_compativel_com_requisito','get_user_cedente_id','get_user_operacao_ids','get_user_role','get_user_sacado_cnpj','handle_new_user','impedir_exclusao_configuracao_cnab_utilizada','impedir_exclusao_documento_gerado','impedir_exclusao_politica','impedir_exclusao_remessa_cnab','impedir_exclusao_template_utilizado','instanciar_requisitos_nota','logistica_usuario_pode_ler_entrega','marcar_entrega_aguardando_validacao','marcar_entrega_cte_aguardando_validacao','obter_politica_aplicavel_cedente_fundo','processar_aceite_sacado','processar_prazos_entrega','proteger_analise_documento','proteger_contexto_operacao','proteger_eventos_entrega','proteger_papel_primario_profile','proteger_postergacao_upload_canhoto','proteger_requisito_publicado','proteger_versao_documento_aprovada','reconciliar_base_nf_apos_vinculo','reconciliar_documentos_base_nf','reconciliar_documentos_base_nf_existentes','registrar_canhoto_documento','registrar_cte_documento','registrar_documento_entrega_upload','registrar_documento_upload','registrar_evento_aceite_sacado','registrar_evento_entrega','reparar_requisitos_pos_cessao_operacao','reservar_sequencial_remessa','revalidar_cte_nota_fiscal','sincronizar_papel_primario_usuario','sincronizar_status_versao_politica','solicitar_operacao_antecipacao_atomica','update_updated_at','usuario_pode_ler_documento_gerado','usuario_pode_ler_remessa_cnab','usuario_possui_mfa_elevado','validar_cedente_fundo_politica','validar_configuracao_cnab_versao','validar_contexto_multifundo_nota_fiscal','validar_credencial_integracao','validar_integracao_fundo_versao','validar_integracao_fundo_versao_capacidade','validar_integracao_versao_credencial','validar_linhagem_integracao_financeira','validar_template_versao','validar_versao_publicada']::text[];
  names_authenticated text[] := ARRAY['handle_new_user','impedir_exclusao_configuracao_cnab_utilizada','impedir_exclusao_documento_gerado','impedir_exclusao_politica','impedir_exclusao_remessa_cnab','impedir_exclusao_template_utilizado','proteger_analise_documento','proteger_contexto_operacao','proteger_eventos_entrega','proteger_papel_primario_profile','proteger_postergacao_upload_canhoto','proteger_requisito_publicado','proteger_versao_documento_aprovada','reservar_sequencial_remessa','sincronizar_papel_primario_usuario','sincronizar_status_versao_politica','update_updated_at','usuario_possui_mfa_elevado','validar_cedente_fundo_politica','validar_configuracao_cnab_versao','validar_contexto_multifundo_nota_fiscal','validar_credencial_integracao','validar_integracao_fundo_versao','validar_integracao_fundo_versao_capacidade','validar_integracao_versao_credencial','validar_linhagem_integracao_financeira','validar_template_versao','validar_versao_publicada']::text[];
  names_service text[] := ARRAY['admin_ativar_credencial_integracao','admin_desativar_cnab_versao','admin_desativar_integracao_versao','admin_finalizar_teste_integracao','admin_obter_configuracoes_tecnicas_fundo','admin_preparar_teste_integracao','admin_publicar_cnab_versao','admin_publicar_integracao_versao','admin_revogar_credencial_integracao','admin_salvar_cnab_rascunho','analisar_canhoto_documento','analisar_cte_documento','analisar_documento_versao','aprovar_operacao_atomica','aprovar_operacao_com_risco_atomica','avaliar_conclusao_entrega','avaliar_gate_logistico_pre_cessao_nfs','carregar_dashboard_sacado','carregar_indicadores_nfs_sacado','confirmar_match_manual','consumir_autorizacao_acao_sensivel','criar_autorizacao_acao_sensivel','criar_rascunho_configuracao_comunicacoes','dashboard_cedente_resumo','dashboard_consultor_resumo','dashboard_gestor_resumo','decidir_revisao_risco','desembolsar_operacao_com_logistica','excluir_notas_fiscais_rascunho_cedente','handle_new_user','impedir_exclusao_configuracao_cnab_utilizada','impedir_exclusao_documento_gerado','impedir_exclusao_politica','impedir_exclusao_remessa_cnab','impedir_exclusao_template_utilizado','instanciar_requisitos_nota','listar_cedentes_aprovacao_sacado','listar_documentos_atuais_cedente','listar_onboarding_cedentes_paginado','logistica_usuario_pode_ler_entrega','marcar_entrega_aguardando_validacao','marcar_entrega_cte_aguardando_validacao','obter_politica_aplicavel_cedente_fundo','obter_sessao_mfa_atual','preparar_contexto_calculo_nova_operacao','preparar_exclusao_nota_fiscal_eventos_dominio','processar_aceite_sacado','proteger_analise_documento','proteger_contexto_operacao','proteger_eventos_entrega','proteger_memoria_logistica_operacao','proteger_papel_primario_profile','proteger_postergacao_upload_canhoto','proteger_requisito_publicado','proteger_resultado_financeiro_operacao','proteger_versao_documento_aprovada','publicar_configuracao_comunicacoes','reconciliar_documentos_base_nf','reconciliar_documentos_base_nf_existentes','registrar_canhoto_documento','registrar_cte_documento','registrar_documento_entrega_upload','registrar_documento_logistico_antecipado','registrar_documento_upload','registrar_evento_entrega','registrar_sessao_mfa_atual','relatorio_consultor_analitico','relatorio_gestor_analitico','reparar_requisitos_pos_cessao_operacao','revalidar_cte_nota_fiscal','revogar_match_manual','revogar_sessao_mfa_atual','sincronizar_papel_primario_usuario','sincronizar_status_versao_politica','solicitar_operacao_antecipacao_atomica','update_updated_at','usuario_possui_mfa_elevado','validar_cedente_fundo_politica','validar_configuracao_cnab_versao','validar_contexto_multifundo_nota_fiscal','validar_integracao_fundo_versao','validar_integracao_fundo_versao_capacidade','validar_linhagem_integracao_financeira','validar_template_versao','validar_versao_publicada']::text[];
BEGIN
  FOR item IN
    SELECT p.oid::regprocedure AS target,
           p.proname = ANY(names_anon) AS revoke_anon,
           p.proname = ANY(names_authenticated) AS revoke_authenticated,
           p.proname = ANY(names_service) AS revoke_service
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.proname = ANY(names_anon) OR p.proname = ANY(names_authenticated) OR p.proname = ANY(names_service))
  LOOP
    IF item.revoke_anon THEN EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', item.target); END IF;
    IF item.revoke_authenticated THEN EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', item.target); END IF;
    IF item.revoke_service THEN EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM service_role', item.target); END IF;
  END LOOP;
END
$p264_acl$;

GRANT SELECT ON TABLE public.devedores_solidarios TO authenticated;
GRANT SELECT, INSERT ON TABLE public.logs_auditoria TO authenticated;

-- Defaults fechados para objetos criados pelo proprietario das migrations.
-- supabase_admin e um papel gerenciado pela plataforma; alterar defaults de outro
-- owner nao e permitido no fluxo normal de migrations e nao faz parte do dominio BW.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
