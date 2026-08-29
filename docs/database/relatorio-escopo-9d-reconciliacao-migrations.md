# Relatório do Escopo 9D — auditoria e reconciliação de migrations

## 1. Resumo executivo

**Parecer: NO-GO PARA RECONCILIAÇÃO.**

O inventário local contém 73 migrations, enquanto o histórico remoto contém 5. A análise material encontrou 4 registradas e equivalentes, 14 integralmente materializadas sem histórico, 8 parciais, 2 divergentes, 45 indeterminadas e 0 ausentes.

A homologação permaneceu inalterada. Toda consulta remota ocorreu em transação `READ ONLY`; não houve `migration repair`, aplicação de migration, alteração de histórico, commit ou push.

O bloqueio principal é estrutural: o repositório começa na migration `003` e não versiona a criação de 16 tabelas e 10 enums-base já presentes em homologação. Além disso, a prova em base vazia não chegou à primeira migration por falha da infraestrutura Docker local. Sem base limpa, não há schema diff conclusivo.

## 2. Estado local e pré-condições

- Ambiente autorizado: homologação.
- Projeto conferido: `fhgkmggthxikfpogrvaa`.
- Branch: `homolog`.
- HEAD auditado: `db4ef876ed547de1f71346bcb2d85f2cafcc278d`.
- Worktree: checkpoint local identificável dos Escopos 9A/9C/9D; não estava limpo e foi preservado.
- `testar_smtp_ionos.py`: arquivo não rastreado, explicitamente fora do escopo e não alterado.
- Arquivos de ambiente: ignorados e não rastreados.
- Backup PERF9A confirmado em diretório local restrito; nenhum backup foi adicionado ao Git.
- Massa PERF9A preservada: 20 usuários, 2 fundos, 180 cedentes, 121 vínculos, 250 operações, 1.000 NFs, 900 documentos, 5.000 movimentos, 4.500 notificações, 1.000 logs e 200 eventos.
- Gate RLS 9B: 50/50 aprovado.
- Gate Storage 9C: 19/19 aprovado.
- Smoke já registrado no checkpoint: 26/26 aprovado.
- Estado do worktree no fechamento:

```
M docs/performance/relatorio-homologacao-escopo-9a-retomada.md
 M package.json
 M src/app/cedente/notas-fiscais/[id]/page.tsx
 M src/app/gestor/notas-fiscais/[id]/page.tsx
 M src/lib/actions/notificacoes-listagem.ts
 M src/lib/actions/sacado-portal.ts
 M src/lib/gestor/contexto-fundo.server.ts
 M src/lib/notificacoes/listagem.server.ts
 M src/lib/pagination/cursor.ts
 M src/lib/sacado/portal-listagens.test.ts
 M vitest.config.ts
?? docs/database/
?? docs/performance/relatorio-escopo-9c-bloqueadores-9a2.md
?? docs/performance/relatorio-homologacao-escopo-9a-final.md
?? scripts/perf9a/browser-final-homolog.mjs
?? scripts/perf9a/react-profiler-final-homolog.mjs
?? scripts/perf9a/realtime-visual-final-homolog.mjs
?? scripts/perf9a/smoke-escopo9c-browser.mjs
?? scripts/perf9a/storage-escopo9c-homolog.mjs
?? scripts/perf9d/
?? src/lib/actions/arquivo-nota-fiscal.ts
?? src/lib/gestor/contexto-fundo.server.test.ts
?? src/lib/pagination/cursor.test.ts
?? src/lib/storage-authorization-escopo9c.test.ts
?? supabase/migrations/20260731140710_escopo9c_storage_autorizacao_multifundo.sql
?? testar_smtp_ionos.py
```

## 3. Histórico remoto real

| Versão | Nome | Statements | SHA-256 canônico |
| --- | --- | --- | --- |
| 003 | storage_buckets_env | 31 | `8b4cbed0faefd40db43de6aa85d0bb444421cfe7f40c8d233f9680147c5a37fe` |
| 004 | aceite_sacado_em | 2 | `23581ee68e79befff93021de386ba2b64937b5faf1992576a0477f55e95d697e` |
| 005 | testemunhas | 6 | `9521a2607aba215bc94e5be91e13b8ea534a77c01096e24ff481b673c45a7982` |
| 006 | documentos_assinados | 2 | `a510a383c1b4891f970c9fdc2cb2ca07142481ef271e903d7f61830077018360` |
| 20260730170007 | performance_escopo8_hardening_grants_rls | 1 | `5bf9fc1f04eb7e09c328f507f928810c4ba403ab3e1b0f6ecb22d07ed66f787d` |

O histórico remoto não representa o schema material. Não se deve inferir ausência de objeto apenas pelo histórico nem marcar uma migration como aplicada apenas pela existência de objeto com nome semelhante.

## 4. Inventário das 73 migrations

- Versões duplicadas: nenhuma.
- Nomes fora do padrão: nenhum.
- Ordem canônica: lexicográfica, registrada no manifest e no grafo.
- Migrations com `DROP` estrutural detectado: `20260723182639_reset_operacional_fundo_homolog_rpc.sql`, `20260727202747_desacoplar_politicas_operacionais_cedente_fundo.sql`, `20260728153646_reset_operacional_eventos_dominio.sql`.
- SQL não transacional detectado: nenhum.
- Dependência de ambiente detectada: `003_storage_buckets_env.sql`, `20260721132903_fase3_repositorio_documental_nf.sql`, `20260721183540_fase5_logistica_pos_cessao.sql`, `20260721194546_fase7_cnab_configuravel_rastreavel.sql`, `20260722090000_fase8_portal_fidc_fundo.sql`.
- Reexecução potencialmente insegura: 33 migrations.
- SQL dinâmico: 41 migrations.

O inventário estruturado está em [migration-manifest.json](./migration-manifest.json).

## 5. Equivalência e decisão por migration

| Versão | Migration | Histórico | Evidência material | Decisão 9D |
| --- | --- | --- | --- | --- |
| 003 | storage_buckets_env | equivalente | registrada e equivalente | já registrada; preservar |
| 004 | aceite_sacado_em | equivalente | registrada e equivalente | já registrada; preservar |
| 005 | testemunhas | equivalente | registrada e equivalente | já registrada; preservar |
| 006 | documentos_assinados | equivalente | registrada e equivalente | já registrada; preservar |
| 007 | rename_aceite_sacado_em | ausente | indeterminada | exige comparação adicional |
| 008 | document_update_request | ausente | integral sem histórico | candidata após controle formal |
| 009 | habilitar_escrow_cedente | ausente | integral sem histórico | candidata após controle formal |
| 010 | solicitacoes_alteracao_cedente | ausente | indeterminada | exige comparação adicional |
| 011 | cedente_acessos | ausente | indeterminada | exige comparação adicional |
| 012 | storage_policies_acesso_vinculado | ausente | indeterminada | exige comparação adicional |
| 013 | nf_solicitar_ajuste | ausente | indeterminada | exige comparação adicional |
| 014 | coobrigacao_notificacao | ausente | integral sem histórico | candidata após controle formal |
| 015 | remessa_fromtis | ausente | integral sem histórico | candidata após controle formal |
| 016 | termo_quitacao | ausente | integral sem histórico | candidata após controle formal |
| 20260720203009 | fase1_auditoria_atores_origem | ausente | indeterminada | exige comparação adicional |
| 20260721123935 | fase2_nucleo_multifundo_politicas_snapshot | ausente | indeterminada | exige comparação adicional |
| 20260721132903 | fase3_repositorio_documental_nf | ausente | indeterminada | exige comparação adicional |
| 20260721170157 | fase4_roteamento_aceite_sacado | ausente | parcial | exige migration corretiva |
| 20260721183540 | fase5_logistica_pos_cessao | ausente | indeterminada | exige comparação adicional |
| 20260721190904 | fase6_templates_juridicos_fundo | ausente | indeterminada | exige comparação adicional |
| 20260721194546 | fase7_cnab_configuravel_rastreavel | ausente | indeterminada | exige comparação adicional |
| 20260722090000 | fase8_portal_fidc_fundo | ausente | indeterminada | exige comparação adicional |
| 20260722132525 | fase9_mfa_totp_hardening | ausente | indeterminada | exige comparação adicional |
| 20260722143728 | fase10_reset_administrativo_mfa | ausente | indeterminada | exige comparação adicional |
| 20260722145820 | complemento_credenciais_portal_fidc_banco | ausente | indeterminada | exige comparação adicional |
| 20260722170510 | corrigir_templates_juridicos_multifundo | ausente | indeterminada | exige comparação adicional |
| 20260722183107 | ampliar_catalogo_requisitos_politica_operacional | ausente | indeterminada | exige comparação adicional |
| 20260722191000 | corrigir_contexto_multifundo_upload_nf | ausente | indeterminada | exige comparação adicional |
| 20260722192500 | corrigir_rls_fundos_cedente_vinculado | ausente | indeterminada | exige comparação adicional |
| 20260722193500 | corrigir_catalogo_documental_requisitos_nf | ausente | indeterminada | exige comparação adicional |
| 20260723124410 | corrigir_constraints_desembolso_logistica | ausente | indeterminada | exige comparação adicional |
| 20260723124929 | corrigir_contexto_requisito_logistico_nullable | ausente | indeterminada | exige comparação adicional |
| 20260723125851 | corrigir_fluxo_status_entrega_pos_cessao | ausente | indeterminada | exige comparação adicional |
| 20260723134849 | estabilizacao_operacoes_atomicas_cnab_compensacao | ausente | parcial | exige migration corretiva |
| 20260723143749 | evoluir_documentos_pos_cessao_nf_cedente | ausente | indeterminada | exige comparação adicional |
| 20260723165651 | corrigir_requisitos_pos_cessao_snapshot | ausente | parcial | exige migration corretiva |
| 20260723182639 | reset_operacional_fundo_homolog_rpc | ausente | indeterminada | exige comparação adicional |
| 20260723195804 | corrigir_validacao_politica_operacao_atomica | ausente | parcial | exige migration corretiva |
| 20260727130046 | fundo_ativo_usuario_fundos | ausente | indeterminada | exige comparação adicional |
| 20260727142150 | validacao_cte_nfe | ausente | indeterminada | exige comparação adicional |
| 20260727151731 | politicas_catalogo_fundo | ausente | indeterminada | exige comparação adicional |
| 20260727192402 | onboarding_cedentes_sem_fundo_fallback | ausente | indeterminada | exige comparação adicional |
| 20260727202747 | desacoplar_politicas_operacionais_cedente_fundo | ausente | indeterminada | exige comparação adicional |
| 20260727204346 | relaxar_cedente_fundo_versoes_politica | ausente | indeterminada | exige comparação adicional |
| 20260727205426 | corrigir_instanciacao_checklist_nf_sem_colunas_contexto | ausente | integral sem histórico | candidata após controle formal |
| 20260727212053 | reconciliar_documentos_base_nf_checklist | ausente | integral sem histórico | candidata após controle formal |
| 20260727212953 | corrigir_documento_tipo_requisitos_nf | ausente | indeterminada | exige comparação adicional |
| 20260728122849 | corrigir_status_documentos_upload_aguardando_aprovacao | ausente | indeterminada | exige comparação adicional |
| 20260728123821 | permitir_tipo_cte_catalogado_em_requisito_generico | ausente | parcial | exige migration corretiva |
| 20260728130438 | historico_operacional_eventos_dominio | ausente | indeterminada | exige comparação adicional |
| 20260728145033 | password_recovery_flow | ausente | indeterminada | exige comparação adicional |
| 20260728153646 | reset_operacional_eventos_dominio | ausente | indeterminada | exige comparação adicional |
| 20260728155942 | password_recovery_security_hardening | ausente | indeterminada | exige comparação adicional |
| 20260728172000 | password_reauth_nonce_event | ausente | indeterminada | exige comparação adicional |
| 20260728181152 | corrigir_rls_politica_versionada_cedente | ausente | integral sem histórico | candidata após controle formal |
| 20260728182000 | rls_historico_portal_sacado | ausente | indeterminada | exige comparação adicional |
| 20260728190000 | auditoria_portal_sacado_contexto | ausente | indeterminada | exige comparação adicional |
| 20260728200000 | historico_aceite_sacado_operacao | ausente | indeterminada | exige comparação adicional |
| 20260728210000 | permitir_evento_documento_entrega | ausente | indeterminada | exige comparação adicional |
| 20260728213000 | corrigir_trigger_historico_aceite_nf_status | ausente | divergente | exige investigação/correção |
| 20260728220000 | reconciliar_documentos_base_nf_checklist_v2 | ausente | indeterminada | exige comparação adicional |
| 20260728223000 | corrigir_perfil_evento_reconciliacao | ausente | parcial | exige migration corretiva |
| 20260729133826 | nf_submissao_manual | ausente | integral sem histórico | candidata após controle formal |
| 20260729180000 | simplificar_requisitos_documentais_politica | ausente | indeterminada | exige comparação adicional |
| 20260729185443 | performance_escopo2_onboarding_paginado | ausente | parcial | exige migration corretiva |
| 20260729203749 | performance_portal_sacado_dashboard | ausente | integral sem histórico | candidata após controle formal |
| 20260730143000 | performance_escopo6_escrow_rls | ausente | indeterminada | exige comparação adicional |
| 20260730152328 | performance_escopo7_dashboards_relatorios | ausente | parcial | exige migration corretiva |
| 20260730170007 | performance_escopo8_hardening_grants_rls | divergente | divergente | exige investigação/correção |
| 20260730190000 | escopo9b_corrigir_isolamento_rls | ausente | integral sem histórico | candidata após controle formal |
| 20260730194500 | escopo9b_policies_explicitas | ausente | integral sem histórico | candidata após controle formal |
| 20260730200000 | escopo9b_corrigir_recursao_sacado_rls | ausente | integral sem histórico | candidata após controle formal |
| 20260731140710 | escopo9c_storage_autorizacao_multifundo | ausente | integral sem histórico | candidata após controle formal |

## 6. Divergências

- `20260728213000_corrigir_trigger_historico_aceite_nf_status.sql` — histórico/definição não equivalente; exige investigação e migration corretiva, nunca repair retroativo imediato.
- `20260730170007_performance_escopo8_hardening_grants_rls.sql` — histórico/definição não equivalente; exige investigação e migration corretiva, nunca repair retroativo imediato.

## 7. Migrations parciais

- `20260721170157_fase4_roteamento_aceite_sacado.sql` — presentes: 4; ausentes: 1; divergentes: 0; indeterminados: 0.
- `20260723134849_estabilizacao_operacoes_atomicas_cnab_compensacao.sql` — presentes: 5; ausentes: 0; divergentes: 2; indeterminados: 0.
- `20260723165651_corrigir_requisitos_pos_cessao_snapshot.sql` — presentes: 5; ausentes: 0; divergentes: 1; indeterminados: 0.
- `20260723195804_corrigir_validacao_politica_operacao_atomica.sql` — presentes: 1; ausentes: 0; divergentes: 1; indeterminados: 0.
- `20260728123821_permitir_tipo_cte_catalogado_em_requisito_generico.sql` — presentes: 6; ausentes: 2; divergentes: 1; indeterminados: 0.
- `20260728223000_corrigir_perfil_evento_reconciliacao.sql` — presentes: 2; ausentes: 0; divergentes: 1; indeterminados: 0.
- `20260729185443_performance_escopo2_onboarding_paginado.sql` — presentes: 1; ausentes: 1; divergentes: 1; indeterminados: 0.
- `20260730152328_performance_escopo7_dashboards_relatorios.sql` — presentes: 10; ausentes: 2; divergentes: 3; indeterminados: 0.

Migration parcial não pode ser marcada como aplicada. Cada caso exige lista objeto a objeto, migration incremental corretiva, reaplicação em QA e nova auditoria.

## 8. Materializadas sem histórico e indeterminadas

### Candidatas após controle formal

- `008_document_update_request.sql`
- `009_habilitar_escrow_cedente.sql`
- `014_coobrigacao_notificacao.sql`
- `015_remessa_fromtis.sql`
- `016_termo_quitacao.sql`
- `20260727205426_corrigir_instanciacao_checklist_nf_sem_colunas_contexto.sql`
- `20260727212053_reconciliar_documentos_base_nf_checklist.sql`
- `20260728181152_corrigir_rls_politica_versionada_cedente.sql`
- `20260729133826_nf_submissao_manual.sql`
- `20260729203749_performance_portal_sacado_dashboard.sql`
- `20260730190000_escopo9b_corrigir_isolamento_rls.sql`
- `20260730194500_escopo9b_policies_explicitas.sql`
- `20260730200000_escopo9b_corrigir_recursao_sacado_rls.sql`
- `20260731140710_escopo9c_storage_autorizacao_multifundo.sql`

As quatro migrations 9B/9C estão neste grupo e tiveram validação específica. As demais continuam candidatas, não autorização para repair automático.

### Exigem comparação adicional

- `007_rename_aceite_sacado_em.sql`
- `010_solicitacoes_alteracao_cedente.sql`
- `011_cedente_acessos.sql`
- `012_storage_policies_acesso_vinculado.sql`
- `013_nf_solicitar_ajuste.sql`
- `20260720203009_fase1_auditoria_atores_origem.sql`
- `20260721123935_fase2_nucleo_multifundo_politicas_snapshot.sql`
- `20260721132903_fase3_repositorio_documental_nf.sql`
- `20260721183540_fase5_logistica_pos_cessao.sql`
- `20260721190904_fase6_templates_juridicos_fundo.sql`
- `20260721194546_fase7_cnab_configuravel_rastreavel.sql`
- `20260722090000_fase8_portal_fidc_fundo.sql`
- `20260722132525_fase9_mfa_totp_hardening.sql`
- `20260722143728_fase10_reset_administrativo_mfa.sql`
- `20260722145820_complemento_credenciais_portal_fidc_banco.sql`
- `20260722170510_corrigir_templates_juridicos_multifundo.sql`
- `20260722183107_ampliar_catalogo_requisitos_politica_operacional.sql`
- `20260722191000_corrigir_contexto_multifundo_upload_nf.sql`
- `20260722192500_corrigir_rls_fundos_cedente_vinculado.sql`
- `20260722193500_corrigir_catalogo_documental_requisitos_nf.sql`
- `20260723124410_corrigir_constraints_desembolso_logistica.sql`
- `20260723124929_corrigir_contexto_requisito_logistico_nullable.sql`
- `20260723125851_corrigir_fluxo_status_entrega_pos_cessao.sql`
- `20260723143749_evoluir_documentos_pos_cessao_nf_cedente.sql`
- `20260723182639_reset_operacional_fundo_homolog_rpc.sql`
- `20260727130046_fundo_ativo_usuario_fundos.sql`
- `20260727142150_validacao_cte_nfe.sql`
- `20260727151731_politicas_catalogo_fundo.sql`
- `20260727192402_onboarding_cedentes_sem_fundo_fallback.sql`
- `20260727202747_desacoplar_politicas_operacionais_cedente_fundo.sql`
- `20260727204346_relaxar_cedente_fundo_versoes_politica.sql`
- `20260727212953_corrigir_documento_tipo_requisitos_nf.sql`
- `20260728122849_corrigir_status_documentos_upload_aguardando_aprovacao.sql`
- `20260728130438_historico_operacional_eventos_dominio.sql`
- `20260728145033_password_recovery_flow.sql`
- `20260728153646_reset_operacional_eventos_dominio.sql`
- `20260728155942_password_recovery_security_hardening.sql`
- `20260728172000_password_reauth_nonce_event.sql`
- `20260728182000_rls_historico_portal_sacado.sql`
- `20260728190000_auditoria_portal_sacado_contexto.sql`
- `20260728200000_historico_aceite_sacado_operacao.sql`
- `20260728210000_permitir_evento_documento_entrega.sql`
- `20260728220000_reconciliar_documentos_base_nf_checklist_v2.sql`
- `20260729180000_simplificar_requisitos_documentais_politica.sql`
- `20260730143000_performance_escopo6_escrow_rls.sql`

## 9. Objetos remotos sem origem local identificada

Após o refinamento que exclui índices implícitos de constraints e reconhece DDL em blocos dinâmicos, restaram 86 candidatos:

| Tipo | Quantidade |
| --- | --- |
| table | 16 |
| enum | 10 |
| index | 23 |
| function | 1 |
| trigger | 8 |
| policy | 28 |

### table

- `public.cedentes`
- `public.consultor_cedente`
- `public.contas_escrow`
- `public.devedores_solidarios`
- `public.documentos`
- `public.fundos`
- `public.logs_auditoria`
- `public.movimentos_escrow`
- `public.notas_fiscais`
- `public.notificacoes`
- `public.operacoes`
- `public.operacoes_nfs`
- `public.profiles`
- `public.representantes`
- `public.sacados`
- `public.taxas_cedente`

### enum

- `public.cedente_status`
- `public.conta_escrow_status`
- `public.documento_status`
- `public.documento_tipo`
- `public.movimento_tipo`
- `public.nf_status`
- `public.operacao_status`
- `public.tipo_conta_bancaria`
- `public.user_role`
- `public.user_status`

### index

- `public.idx_cedentes_cnpj`
- `public.idx_cedentes_status`
- `public.idx_cedentes_user_id`
- `public.idx_contas_escrow_cedente_id`
- `public.idx_documentos_cedente_id`
- `public.idx_documentos_representante_id`
- `public.idx_documentos_status`
- `public.idx_logs_auditoria_entidade`
- `public.idx_logs_auditoria_tipo_evento`
- `public.idx_logs_auditoria_usuario_id`
- `public.idx_movimentos_escrow_conta_id`
- `public.idx_notas_fiscais_cedente_id`
- `public.idx_notas_fiscais_cnpj_destinatario`
- `public.idx_notas_fiscais_status`
- `public.idx_notificacoes_lida`
- `public.idx_notificacoes_usuario_id`
- `public.idx_operacoes_cedente_id`
- `public.idx_operacoes_status`
- `public.idx_profiles_role`
- `public.idx_representantes_cedente_id`
- `public.idx_representantes_principal`
- `public.idx_sacados_cnpj`
- `public.idx_sacados_user_id`

### function

- `public.handle_new_user`

### trigger

- `public.cedentes_updated_at`
- `public.contas_escrow_updated_at`
- `public.documentos_updated_at`
- `public.notas_fiscais_updated_at`
- `public.operacoes_updated_at`
- `public.profiles_updated_at`
- `public.representantes_updated_at`
- `public.sacados_updated_at`

### policy

- `public.cedentes_gestor_all`
- `public.cedentes_own_insert`
- `public.cedentes_own_select`
- `public.cedentes_own_update`
- `public.contas_escrow_cedente_select`
- `public.devedores_cedente_select`
- `public.devedores_gestor_all`
- `public.devedores_gestor_select`
- `public.documentos_cedente_insert`
- `public.documentos_cedente_select`
- `public.documentos_cedente_update`
- `public.documentos_gestor_all`
- `public.movimentos_escrow_cedente_select`
- `public.notificacoes_gestor_all`
- `public.notificacoes_own_select`
- `public.notificacoes_own_update`
- `public.profiles_gestor_all`
- `public.profiles_own_select`
- `public.profiles_own_update`
- `public.representantes_cedente_delete`
- `public.representantes_cedente_insert`
- `public.representantes_cedente_select`
- `public.representantes_cedente_update`
- `public.representantes_consultor_select`
- `public.representantes_gestor_all`
- `public.sacados_gestor_all`
- `public.sacados_own_select`
- `public.sacados_own_update`

Esses objetos não devem ser apagados. A lista representa ausência de origem local identificada, não autorização de correção.

## 10. Grafo e ordem de execução

- 234 arestas locais.
- 2 referências futuras.
- 14 referências externas.
- 815 referências não resolvidas estaticamente.

O grafo completo e a ordem canônica estão em [migration-dependency-graph.md](./migration-dependency-graph.md). As referências futuras envolvem `cedente_fundo_politicas` e `eventos_dominio` na RPC de reset de homologação.

## 11. Prova em base vazia

**Não concluída.** O ambiente descartável foi isolado, sem credenciais remotas herdadas e sem mutação remota. A inicialização falhou antes da primeira migration:

- CLI 2.88.1: imagem local inconsistente (usuário `supabase` ausente no container).
- CLI 2.111.0: Docker Desktop apresentou metadados em modo somente leitura/erro de I/O durante o pull.
- Primeira migration executada: nenhuma.
- Histórico local criado: nenhum.
- Dump limpo: indisponível.

Não foi executado prune/reset/restart destrutivo do Docker sem autorização.

## 12. Schema diff

O diff normalizado não pode ser produzido sem lado B. O diagnóstico e o procedimento de retomada estão em [schema-diff-homolog-vs-clean.md](./schema-diff-homolog-vs-clean.md).

## 13. Validação específica do Escopo 9B

- `20260730190000_escopo9b_corrigir_isolamento_rls.sql`: materializada integralmente sem histórico.
- `20260730194500_escopo9b_policies_explicitas.sql`: materializada integralmente sem histórico.
- `20260730200000_escopo9b_corrigir_recursao_sacado_rls.sql`: materializada integralmente sem histórico.
- Policies substituídas foram tratadas pelo proprietário final, evitando falso desvio da migration anterior.
- Helpers, grants, `search_path`, índices, RLS e acesso cruzado foram validados; gate 50/50 aprovado.

## 14. Validação específica do Escopo 9C

- `20260731140710_escopo9c_storage_autorizacao_multifundo.sql`: materializada integralmente sem histórico.
- Policies de `storage.objects`, helpers privados, grants, índices e isolamento por fundo foram comparados.
- Gate Storage 19/19 aprovado.

Isso prova o estado material atual, não a reprodutibilidade do bootstrap.

## 15. Estratégia para homologação atual

1. Não executar repair agora.
2. Restaurar a infraestrutura clean-room.
3. Versionar, por plano formal, o bootstrap ausente das tabelas/enums-base sem editar migrations aplicadas.
4. Tratar 8 migrations parciais e 2 divergentes com migrations incrementais.
5. Resolver as 45 indeterminadas por comparação manual/automatizada ampliada.
6. Reexecutar base vazia e schema diff.
7. Somente migrations integralmente equivalentes podem ser candidatas a registro retroativo.
8. Capturar backup e histórico imediatamente antes de qualquer reconciliação futura.

## 16. Estratégia para produção vazia

O cenário ainda não é executável. Antes de produção vazia deve existir cadeia canônica que crie schema-base, Auth/Storage necessários, aplique as 73 migrations sem dependência manual, gere dump equivalente, valide RLS/Storage e execute smoke com seed administrativo mínimo.

Não criar baseline/squash automático neste escopo.

## 17. Estratégia para produção existente

1. Inventário read-only do catálogo e histórico do ambiente alvo.
2. Prova de equivalência individual.
3. Registro retroativo somente de migrations integralmente equivalentes.
4. Migrations incrementais para estado parcial/divergente.
5. Aplicação das ausentes em ordem validada.
6. Gates RLS, Storage, Auth, financeiro, integração e rollback.

## 18. Rollback operacional de reconciliação futura

- Backup lógico e export do histórico antes da janela.
- Plano objeto a objeto para cada migration corretiva.
- Sem reaplicação de SQL destrutivo.
- Em falha: interromper imediatamente, não marcar histórico, restaurar somente pelo procedimento aprovado e revalidar RLS/Storage.
- `migration repair` não reverte schema; ele altera apenas o registro de histórico e, por isso, não é mecanismo de rollback.

## 19. Riscos e bloqueadores

1. 16 tabelas e 10 enums-base sem origem local identificada.
2. 45 migrations indeterminadas.
3. 8 migrations parcialmente materializadas.
4. 2 migrations divergentes.
5. 86 objetos remotos candidatos sem origem local.
6. 2 referências futuras no grafo estático.
7. Clean-room bloqueado por infraestrutura Docker local.
8. Schema diff indisponível.
9. Histórico remoto representa apenas 5 de 73 versões locais.

## 20. Recomendação e parecer

**NO-GO PARA RECONCILIAÇÃO.** Não executar `supabase migration repair`, não promover para produção e não tratar o schema atual como reproduzível.

O próximo gate é obter uma base descartável saudável, completar o bootstrap versionado e zerar estados parciais/divergentes/indeterminados. Só depois pode haver plano de reconciliação controlada.

## Comandos e evidências

- `npm run perf9a:status -- --env-file .env.homolog`: massa preservada.
- `npm run perf9b:verify -- --env-file .env.homolog`: 50/50.
- `npm run perf9c:storage -- --env-file .env.homolog`: 19/19.
- `npm run perf9d:audit -- --env-file .env.homolog`: concluído em modo read-only.
- `npx vitest run scripts/perf9d/audit-lib.test.mjs`: 12/12.
- `npx tsc --noEmit`: aprovado.
- `npm test -- --run`: 69 arquivos e 463 testes aprovados.
- `npm run lint`: aprovado com zero erros e 6 avisos preexistentes fora do Escopo 9D.
- `git diff --check`: aprovado; somente avisos de normalização LF/CRLF no Windows.
- `npx next build --webpack`: aprovado; permanecem avisos conhecidos do Handlebars sobre `require.extensions`.
- Secret scan dos artefatos 9D: nenhuma credencial, URL PostgreSQL, token ou service role encontrada.
- Evidência completa: diretório local restrito `%LOCALAPPDATA%/BWAntecipa/perf9d/evidence`.
- SHA-256 da evidência usada: `b8883afe8414153a3db13c5071d2f325482f6a978c5a07b6af002e669f5cbe5a`.

Referências operacionais: [Database migrations](https://supabase.com/docs/guides/deployment/database-migrations), [migration repair](https://supabase.com/docs/reference/cli/supabase-migration-repair) e [db reset](https://supabase.com/docs/reference/cli/supabase-db-reset).

## Atualização — Escopo 9E

A reconstrução do schema-base, os dois ciclos clean-room e o diff final estão documentados em [relatorio-escopo-9e-bootstrap-clean-room.md](./relatorio-escopo-9e-bootstrap-clean-room.md). O resultado 9E é NO-GO para definição de cutover; esta atualização não altera as classificações históricas do 9D.
