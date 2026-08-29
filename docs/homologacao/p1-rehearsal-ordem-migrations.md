# P1 — Ordem controlada das migrations do rehearsal

Este manifesto registra a ordem efetivamente certificada no clone local de produção. A ordem não deve ser substituída por `supabase db push` direto em produção.

## 1. Histórico já presente no baseline

1. `003`
2. `004`
3. `005`
4. `006`
5. `007`
6. `008`
7. `009`
8. `010`
9. `011`
10. `012`
11. `013`
12. `014`
13. `015`
14. `016`

## 2. Bridges pré-upgrade obrigatórias

1. `20260827183411_bridge_consultor_cedentes_para_consultor_cedente.sql`
2. `20260827184403_bridge_documentos_representante_legado.sql`
3. `20260827185557_bridge_remover_policies_legadas_gestor_global.sql`

As bridges são registradas no histórico antes da cadeia pendente para satisfazer as pré-condições do schema real de produção.

## 3. Cadeia pendente aplicada

1. `20260720203009_fase1_auditoria_atores_origem.sql`
2. `20260721123935_fase2_nucleo_multifundo_politicas_snapshot.sql`
3. `20260721132903_fase3_repositorio_documental_nf.sql`
4. `20260721170157_fase4_roteamento_aceite_sacado.sql`
5. `20260721183540_fase5_logistica_pos_cessao.sql`
6. `20260721190904_fase6_templates_juridicos_fundo.sql`
7. `20260721194546_fase7_cnab_configuravel_rastreavel.sql`
8. `20260722090000_fase8_portal_fidc_fundo.sql`
9. `20260722132525_fase9_mfa_totp_hardening.sql`
10. `20260722143728_fase10_reset_administrativo_mfa.sql`
11. `20260722145820_complemento_credenciais_portal_fidc_banco.sql`
12. `20260722170510_corrigir_templates_juridicos_multifundo.sql`
13. `20260722183107_ampliar_catalogo_requisitos_politica_operacional.sql`
14. `20260722191000_corrigir_contexto_multifundo_upload_nf.sql`
15. `20260722192500_corrigir_rls_fundos_cedente_vinculado.sql`
16. `20260722193500_corrigir_catalogo_documental_requisitos_nf.sql`
17. `20260723124410_corrigir_constraints_desembolso_logistica.sql`
18. `20260723124929_corrigir_contexto_requisito_logistico_nullable.sql`
19. `20260723125851_corrigir_fluxo_status_entrega_pos_cessao.sql`
20. `20260723134849_estabilizacao_operacoes_atomicas_cnab_compensacao.sql`
21. `20260723143749_evoluir_documentos_pos_cessao_nf_cedente.sql`
22. `20260723165651_corrigir_requisitos_pos_cessao_snapshot.sql`
23. `20260723195804_corrigir_validacao_politica_operacao_atomica.sql`
24. `20260727130046_fundo_ativo_usuario_fundos.sql`
25. `20260727142150_validacao_cte_nfe.sql`
26. `20260727151731_politicas_catalogo_fundo.sql`
27. `20260727192402_onboarding_cedentes_sem_fundo_fallback.sql`
28. `20260727202747_desacoplar_politicas_operacionais_cedente_fundo.sql`
29. `20260727204346_relaxar_cedente_fundo_versoes_politica.sql`
30. `20260727205426_corrigir_instanciacao_checklist_nf_sem_colunas_contexto.sql`
31. `20260727212053_reconciliar_documentos_base_nf_checklist.sql`
32. `20260727212953_corrigir_documento_tipo_requisitos_nf.sql`
33. `20260728122849_corrigir_status_documentos_upload_aguardando_aprovacao.sql`
34. `20260728123821_permitir_tipo_cte_catalogado_em_requisito_generico.sql`
35. `20260728130438_historico_operacional_eventos_dominio.sql`
36. `20260728145033_password_recovery_flow.sql`
37. `20260728155942_password_recovery_security_hardening.sql`
38. `20260728172000_password_reauth_nonce_event.sql`
39. `20260728181152_corrigir_rls_politica_versionada_cedente.sql`
40. `20260728182000_rls_historico_portal_sacado.sql`
41. `20260728190000_auditoria_portal_sacado_contexto.sql`
42. `20260728200000_historico_aceite_sacado_operacao.sql`
43. `20260728210000_permitir_evento_documento_entrega.sql`
44. `20260728213000_corrigir_trigger_historico_aceite_nf_status.sql`
45. `20260728220000_reconciliar_documentos_base_nf_checklist_v2.sql`
46. `20260728223000_corrigir_perfil_evento_reconciliacao.sql`
47. `20260729133826_nf_submissao_manual.sql`
48. `20260729180000_simplificar_requisitos_documentais_politica.sql`
49. `20260729185443_performance_escopo2_onboarding_paginado.sql`
50. `20260729203749_performance_portal_sacado_dashboard.sql`
51. `20260730143000_performance_escopo6_escrow_rls.sql`
52. `20260730152328_performance_escopo7_dashboards_relatorios.sql`
53. `20260730170007_performance_escopo8_hardening_grants_rls.sql`
54. `20260730190000_escopo9b_corrigir_isolamento_rls.sql`
55. `20260730194500_escopo9b_policies_explicitas.sql`
56. `20260730200000_escopo9b_corrigir_recursao_sacado_rls.sql`
57. `20260731140710_escopo9c_storage_autorizacao_multifundo.sql`
58. `20260731171219_postergacao_upload_canhoto.sql`
59. `20260803172546_mfa_sessao_24h.sql`
60. `20260804093210_corrigir_ambiguidade_registrar_sessao_mfa.sql`
61. `20260804171538_corrigir_recursao_rls_cedente_fundos.sql`
62. `20260805160000_metodos_calculo_financeiro_operacao.sql`
63. `20260805170000_corrigir_ambiguidade_valor_bruto_aprovacao.sql`
64. `20260805180000_endurecer_aprovacao_financeira.sql`
65. `20260806170000_envio_antecipado_documentos_logisticos.sql`
66. `20260806180000_excluir_nfs_rascunho_cedente.sql`
67. `20260806190000_corrigir_record_nf_upload_logistico_antecipado.sql`
68. `20260806200000_corrigir_exclusao_rascunho_eventos_dominio.sql`
69. `20260807132532_corrigir_evento_entrega_em_validacao.sql`
70. `20260807170000_p1_motor_comunicacoes_email.sql`
71. `20260810120000_usar_smtp_ionos_comunicacoes.sql`
72. `20260810121000_snapshot_remetente_gestora_comunicacoes.sql`
73. `20260811120000_p2_0_duplicata_ativo_financeiro.sql`
74. `20260812115900_sa0_super_admin_enum.sql`
75. `20260812120000_sa0_super_admin_roles.sql`
76. `20260812143000_sa1_admin_fundos.sql`
77. `20260812170000_sa2_admin_usuarios_acessos.sql`
78. `20260812190000_sa3_admin_configuracoes_tecnicas.sql`
79. `20260813103000_corrigir_ciclo_vida_credenciais_sa3.sql`
80. `20260813150432_corrigir_semantica_rascunhos_sa3.sql`
81. `20260813191143_p2_2_ingestao_financeira_versionada_rlx.sql`
82. `20260813193629_p2_2_complemento_linhagem_sem_movimento_rlx.sql`
83. `20260813194809_p2_2_lock_ciclo_financeiro_rlx.sql`
84. `20260813195427_p2_2_refresh_views_linhagem_rlx.sql`
85. `20260813201000_p2_2_hardening_rls_indices_rlx.sql`
86. `20260813202000_p2_2_escopo_hibrido_rlx.sql`
87. `20260813203000_p2_2_helper_rls_super_admin_rlx.sql`
88. `20260813210000_p2_2_1_integracoes_capabilities.sql`
89. `20260814123000_p2_2_2_sinqia_financeiro_envios.sql`
90. `20260814141629_p2_3_matching_conciliacao_rlx.sql`
91. `20260814144500_p2_2_2_cnpj_financeiro_derivado_fundo.sql`
92. `20260814164101_p2_4_posicao_logistica_rlx.sql`
93. `20260814170500_p2_4_precisao_valores_logisticos.sql`
94. `20260814213000_p2_5_exposicao_pl_overlay.sql`
95. `20260814214500_p2_5_politica_exposicao_imutavel.sql`
96. `20260814220000_p2_5_1_generalizacao_dominio_financeiro.sql`
97. `20260814230000_p2_6_gate_risco_decisao_operacional.sql`
98. `20260817150505_p2_6_4_canonicalizar_schema_funcional.sql`
99. `20260817150507_p2_6_4_canonicalizar_acl_rls.sql`
100. `20260817150510_p2_6_4_canonicalizar_storage.sql`
101. `20260817152140_p2_6_4_fechar_acl_rotinas_internas.sql`
102. `20260817154500_p2_6_4_restaurar_leitura_carteira_consultor.sql`
103. `20260817171441_p2_6_6_hardening_rls_multifundo_documental_logistico.sql`
104. `20260817171442_p2_6_6_corrigir_acessos_financeiros_legitimos.sql`
105. `20260817174233_p2_6_6_remover_gestor_global_politicas_operacionais.sql`
106. `20260817182112_hotfix_restaurar_leitura_identidade_autenticada.sql`
107. `20260817185117_hotfix_dashboard_gestor_acl.sql`
108. `20260817200014_p2_6_8_remover_legado_estrutural_rlx.sql`
109. `20260817204159_p2_6_8_1_hardening_rls_identidade_profiles.sql`
110. `20260818191418_p0_onboarding_cedente_rpc_segura.sql`
111. `20260818194455_p0_upload_documentos_cedente_permission_denied.sql`
112. `20260818195119_p0_compensacao_storage_documentos_cedente.sql`
113. `20260818200641_multi_cnpj_cedente_estabelecimentos.sql`
114. `20260819120000_p0_analise_documentos_gestor_permission_denied.sql`
115. `20260819140000_p0_mutacoes_cadastro_cedente_gestor.sql`
116. `20260819141000_p0_cedentes_leitura_multifundo_gestor.sql`
117. `20260819150000_p0_catalogo_documental_cadastro_estabelecimento.sql`
118. `20260819160000_p0_novo_tipo_comprovante_residencia_representante.sql`
119. `20260819160500_p0_backfill_comprovante_residencia_representante.sql`
120. `20260819161000_p0_representantes_leitura_multifundo_gestor.sql`
121. `20260819170000_evolucao_estabelecimentos_reuso_documental.sql`
122. `20260819180000_evolucao_estabelecimentos_listagem_paginada.sql`
123. `20260819190000_p0_validacao_raiz_cnpj_filial.sql`
124. `20260819200000_p0_permissao_cadastro_filiais_cedente.sql`
125. `20260819210000_fase1_parcelas_nf_boleto_por_parcela.sql`
126. `20260819220000_fase1_boleto_por_parcela.sql`
127. `20260819230000_fase2_selecao_parcelas_operacao.sql`
128. `20260819240000_fase2_solicitar_aprovar_operacao_por_parcela.sql`
129. `20260820100000_p0_gate_aprovacao_logistica_fonte_unificada.sql`
130. `20260820110000_p0_segundo_gate_logistico_submissao_nf78.sql`
131. `20260820120000_ui_parcelas_nf_operacao_editar_parcelas.sql`
132. `20260820130000_liberar_parcelas_operacao_rejeitada_cancelada.sql`
133. `20260820140000_permitir_cedente_cancelar_propria_operacao.sql`
134. `20260820150000_get_user_cedente_acesso_perfil.sql`
135. `20260820160000_dashboard_cedente_resumo_acesso_delegado.sql`
136. `20260820170000_simular_memoria_financeira_operacao_parcelas.sql`
137. `20260820180000_persistir_matching_execucao_universo_vazio.sql`
138. `20260821000000_bootstrap_fundo_virgem_carteira_qa.sql`
139. `20260821010000_bootstrap_risco_motivos_pl_oficial_indisponivel.sql`
140. `20260821020000_bootstrap_exposicao_flag_persistido.sql`
141. `20260821030000_bootstrap_fundo_virgem_evidencia_economica.sql`
142. `20260821040000_p0_nf_remessa_lastro_logistico.sql`
143. `20260821050000_p0_ajustes_finais_nf_remessa.sql`
144. `20260821060000_p0_politica_nf_remessa_requisito.sql`
145. `20260821070000_p0_nf_remessa_requisito_politica_satisfacao.sql`
146. `20260823130000_p0_nf_remessa_aprovacao_documental.sql`
147. `20260823140000_p0_canhoto_requisito_checklist.sql`
148. `20260823150000_p0_nf_remessa_atualizar_mesma_chave.sql`
149. `20260824100000_p0_webhook_comprovante_transportadora.sql`
150. `20260824150000_p0_fechar_webhook_transportadora_gaps.sql`
151. `20260824180000_p1_super_admin_integracao_transportadora.sql`
152. `20260824190000_p1_corrigir_idempotencia_backfill_token.sql`
153. `20260824200000_corrigir_digest_integracao_transportadora.sql`
154. `20260824210000_corrigir_acl_webhook_transportadora_service_role.sql`
155. `20260825100000_p0_vortx_vrs2_auth_mtls.sql`
156. `20260825130000_p0_vortx_vrs2_adapter_capabilities.sql`
157. `20260826100000_p0_webhook_transportadora_payload_auditoria.sql`
158. `20260826110000_p0_cadastro_cnpj_cep_bancos_filiais.sql`
159. `20260826111500_p0_corrigir_overloads_cadastro_filiais.sql`
160. `20260826120000_p0_corrigir_permissao_solicitacao_alteracao_cedente.sql`
161. `20260826143321_p0_vinculo_gestor_fundo_busca_paginada.sql`
162. `20260826172150_p1_identidade_organizacional_cedente.sql`
163. `20260826190000_p2_invite_first_novo_cedente.sql`
164. `20260826193000_p2_invite_first_compatibilidade_convites_existentes.sql`
165. `20260826200000_p3_cutover_autorizacao_cedente.sql`
166. `20260826201000_p3_notificacoes_cedente_ativas.sql`
167. `20260826202000_p3_hardening_acl_rpcs_cedente.sql`
168. `20260826211301_p4_remessas_operacionais_adapter.sql`
169. `20260826211522_p4_index_remessas_gerado_por.sql`
170. `20260826220731_p4_1_pagamento_vrs_estabelecimento.sql`
171. `20260826223437_p4_1_1_titular_pagamento_vrs.sql`
172. `20260827150511_p0_convite_gestor_lifecycle_aceite.sql`

Total aplicado nesta etapa: 172 migrations.

## 4. Artefatos bloqueados

- `20260723182639_reset_operacional_fundo_homolog_rpc.sql` — RPC destrutiva exclusiva de homologacao.
- `20260728153646_reset_operacional_eventos_dominio.sql` — correcao da RPC destrutiva de homologacao.
- `20260804103235_corrigir_reset_postergacoes_canhoto.sql` — correcao da RPC destrutiva de homologacao.
- `20260811153000_corrigir_reset_dependencias_logisticas_duplicatas.sql` — correcao da RPC destrutiva de homologacao.
- `20260823125731_corrigir_reset_dependencias_risco.sql` — correcao da RPC destrutiva de homologacao.

Esses artefatos não pertencem ao upgrade de produção e não podem entrar no plano de promoção.

