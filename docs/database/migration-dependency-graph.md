# Escopo 9D — grafo de dependências das migrations

Gerado a partir do inventário local associado à evidência `b8883afe8414153a3db13c5071d2f325482f6a978c5a07b6af002e669f5cbe5a`.

## Resultado

- Ordem canônica: lexicográfica por nome de arquivo, 73 migrations.
- Arestas locais detectadas: 234.
- Referências locais para objeto criado somente em migration posterior: 2.
- Referências externas detectadas: 14 ocorrências, 4 objetos.
- Referências não resolvidas estaticamente: 815 ocorrências, 285 objetos.
- Ciclos comprovados: nenhum pelo grafo estático; a prova executável está bloqueada antes da aplicação das migrations.

> A extração é conservadora. SQL dinâmico, CTEs e identificadores montados em PL/pgSQL podem gerar referências não resolvidas. Uma referência não resolvida não é automaticamente um defeito, mas impede prova automática de ordem.

## Referências futuras críticas

| Migration consumidora | Objeto | Migration criadora posterior |
| --- | --- | --- |
| 20260723182639 | `public.cedente_fundo_politicas` | 20260727151731 |
| 20260723182639 | `public.eventos_dominio` | 20260728130438 |

As duas referências acima partem da RPC de reset de homologação. Elas demonstram que a ordem atual só é segura se a migration consumidora proteger a resolução dinâmica; isso precisa ser confirmado em clean-room.

## Dependências-base sem origem local comprovada

As seguintes relações remotas existem em homologação, mas nenhuma migration local declara sua criação:

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

Os enums-base também não têm origem local identificada:

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

## Dependências externas

- `auth.users` — usada por 008, 010, 011
- `information_schema.columns` — usada por 20260727202747, 20260727204346, 20260730190000
- `storage.buckets` — usada por 003, 20260721132903, 20260721194546, 20260722090000
- `storage.objects` — usada por 003, 012, 20260721132903, 20260731140710

## Referências não resolvidas — amostra revisável

- `att.attrelid` — usada por 20260727202747
- `c.cedente_fundo_id` — usada por 20260730152328
- `c.cedente_id` — usada por 20260730152328
- `c.fundo_id` — usada por 20260727192402
- `c.id` — usada por 20260721170157, 20260721183540, 20260721190904, 20260721194546, 20260722090000, 20260727142150, 20260730152328
- `cc.cedente_id` — usada por 20260721183540, 20260721190904, 20260721194546, 20260722090000, 20260722192500, 20260728181152, 20260730143000
- `ce.id` — usada por 20260729203749
- `cf.cedente_id` — usada por 20260730143000
- `cf.fundo_id` — usada por 20260727202747, 20260728181152
- `cf.id` — usada por 20260721132903, 20260722191000, 20260722193500, 20260723182639, 20260727202747, 20260728153646, 20260730190000, 20260731140710
- `cf.status` — usada por 20260729185443
- `cfp.cedente_fundo_id` — usada por 20260727202747, 20260728181152
- `cfp.politica_operacional_id` — usada por 20260727151731, 20260727205426, 20260727212053, 20260727212953
- `cls.oid` — usada por 20260727202747
- `cv.politica_operacional_id` — usada por 20260727151731
- `d.original_id` — usada por 20260727151731
- `document_type.id` — usada por 20260727212053, 20260728122849, 20260728220000, 20260728223000
- `dr.id` — usada por 20260721132903, 20260723143749, 20260727212053, 20260728122849, 20260728130438, 20260728220000, 20260728223000
- `dt.codigo` — usada por 20260721183540, 20260722193500, 20260723143749, 20260723165651, 20260727212953
- `dt.id` — usada por 20260722193500, 20260727212953, 20260728130438
- `dv.documento_id` — usada por 20260727212053, 20260728122849
- `dv.status` — usada por 20260728220000, 20260728223000
- `e.enumtypid` — usada por 20260723182639, 20260728153646
- `entrega.id` — usada por 20260728130438
- `f.id` — usada por 20260722191000, 20260727192402, 20260729185443, 20260730152328, 20260730190000
- `l.id` — usada por 20260730152328
- `n.id` — usada por 20260721183540, 20260723134849, 20260723143749, 20260723165651, 20260728123821
- `new.status` — usada por 20260728200000, 20260728213000
- `nf_entrega.id` — usada por 20260728130438
- `nf.id` — usada por 20260721170157, 20260728130438, 20260728182000, 20260728190000, 20260730152328, 20260730190000, 20260730200000, 20260731140710
- `nfe.id` — usada por 20260727142150
- `nfe.nota_fiscal_id` — usada por 20260721183540, 20260727142150
- `nfo.id` — usada por 20260728130438
- `ns.oid` — usada por 20260722170510
- `nsp.oid` — usada por 20260727202747
- `o.cedente_id` — usada por 20260730152328
- `o.id` — usada por 20260721194546, 20260722090000
- `old.aceite_sacado_exigido` — usada por 20260721123935
- `old.aceite_sacado_obrigatorio` — usada por 20260721123935
- `old.agencia` — usada por 20260721194546
- `old.ambiente` — usada por 20260721194546
- `old.banco` — usada por 20260721194546
- `old.bucket` — usada por 20260721132903
- `old.carteira` — usada por 20260721194546
- `old.cedente_fundo_id` — usada por 20260721123935
- `old.cessao_no_desembolso` — usada por 20260721123935
- `old.codigo_banco` — usada por 20260721194546
- `old.codigo_empresa` — usada por 20260721194546
- `old.codigo_originador` — usada por 20260721194546
- `old.configuracao` — usada por 20260721123935, 20260721194546
- `old.configuracao_cnab_id` — usada por 20260721194546
- `old.configuracao_nao_sensivel` — usada por 20260721194546
- `old.conta` — usada por 20260721194546
- `old.conteudo_hash` — usada por 20260721123935, 20260721194546
- `old.conteudo_html` — usada por 20260721190904
- `old.contexto_capturado_em` — usada por 20260721123935
- `old.contexto_configuracao_status` — usada por 20260721123935
- `old.convenio` — usada por 20260721194546
- `old.credential_ref` — usada por 20260721194546
- `old.cria_acompanhamento_entrega` — usada por 20260721123935
- `old.digito_conta` — usada por 20260721194546
- `old.documento_id` — usada por 20260721132903, 20260728220000
- `old.endpoint_base` — usada por 20260721194546
- `old.enviado_em` — usada por 20260721132903
- `old.enviado_por` — usada por 20260721132903
- `old.especie_titulo` — usada por 20260721194546
- `old.identificador_cliente` — usada por 20260721194546
- `old.integracao_fundo_id` — usada por 20260721194546
- `old.layout` — usada por 20260721194546
- `old.mime_type` — usada por 20260721132903
- `old.nome_original` — usada por 20260721132903
- `old.numero_inscricao` — usada por 20260721194546
- `old.numero_versao` — usada por 20260721132903
- `old.path` — usada por 20260721132903
- `old.politica_operacional_id` — usada por 20260721123935
- `old.politica_operacional_versao_id` — usada por 20260721123935
- `old.politica_snapshot` — usada por 20260721123935
- `old.politica_snapshot_hash` — usada por 20260721123935
- `old.politica_versao` — usada por 20260721123935
- `old.publicada_em` — usada por 20260721123935, 20260721190904, 20260721194546

A lista foi limitada a 80 de 285 objetos para manter o documento revisável. O manifest contém as dependências brutas por migration.

## Ordem canônica

1. `003_storage_buckets_env.sql`
2. `004_aceite_sacado_em.sql`
3. `005_testemunhas.sql`
4. `006_documentos_assinados.sql`
5. `007_rename_aceite_sacado_em.sql`
6. `008_document_update_request.sql`
7. `009_habilitar_escrow_cedente.sql`
8. `010_solicitacoes_alteracao_cedente.sql`
9. `011_cedente_acessos.sql`
10. `012_storage_policies_acesso_vinculado.sql`
11. `013_nf_solicitar_ajuste.sql`
12. `014_coobrigacao_notificacao.sql`
13. `015_remessa_fromtis.sql`
14. `016_termo_quitacao.sql`
15. `20260720203009_fase1_auditoria_atores_origem.sql`
16. `20260721123935_fase2_nucleo_multifundo_politicas_snapshot.sql`
17. `20260721132903_fase3_repositorio_documental_nf.sql`
18. `20260721170157_fase4_roteamento_aceite_sacado.sql`
19. `20260721183540_fase5_logistica_pos_cessao.sql`
20. `20260721190904_fase6_templates_juridicos_fundo.sql`
21. `20260721194546_fase7_cnab_configuravel_rastreavel.sql`
22. `20260722090000_fase8_portal_fidc_fundo.sql`
23. `20260722132525_fase9_mfa_totp_hardening.sql`
24. `20260722143728_fase10_reset_administrativo_mfa.sql`
25. `20260722145820_complemento_credenciais_portal_fidc_banco.sql`
26. `20260722170510_corrigir_templates_juridicos_multifundo.sql`
27. `20260722183107_ampliar_catalogo_requisitos_politica_operacional.sql`
28. `20260722191000_corrigir_contexto_multifundo_upload_nf.sql`
29. `20260722192500_corrigir_rls_fundos_cedente_vinculado.sql`
30. `20260722193500_corrigir_catalogo_documental_requisitos_nf.sql`
31. `20260723124410_corrigir_constraints_desembolso_logistica.sql`
32. `20260723124929_corrigir_contexto_requisito_logistico_nullable.sql`
33. `20260723125851_corrigir_fluxo_status_entrega_pos_cessao.sql`
34. `20260723134849_estabilizacao_operacoes_atomicas_cnab_compensacao.sql`
35. `20260723143749_evoluir_documentos_pos_cessao_nf_cedente.sql`
36. `20260723165651_corrigir_requisitos_pos_cessao_snapshot.sql`
37. `20260723182639_reset_operacional_fundo_homolog_rpc.sql`
38. `20260723195804_corrigir_validacao_politica_operacao_atomica.sql`
39. `20260727130046_fundo_ativo_usuario_fundos.sql`
40. `20260727142150_validacao_cte_nfe.sql`
41. `20260727151731_politicas_catalogo_fundo.sql`
42. `20260727192402_onboarding_cedentes_sem_fundo_fallback.sql`
43. `20260727202747_desacoplar_politicas_operacionais_cedente_fundo.sql`
44. `20260727204346_relaxar_cedente_fundo_versoes_politica.sql`
45. `20260727205426_corrigir_instanciacao_checklist_nf_sem_colunas_contexto.sql`
46. `20260727212053_reconciliar_documentos_base_nf_checklist.sql`
47. `20260727212953_corrigir_documento_tipo_requisitos_nf.sql`
48. `20260728122849_corrigir_status_documentos_upload_aguardando_aprovacao.sql`
49. `20260728123821_permitir_tipo_cte_catalogado_em_requisito_generico.sql`
50. `20260728130438_historico_operacional_eventos_dominio.sql`
51. `20260728145033_password_recovery_flow.sql`
52. `20260728153646_reset_operacional_eventos_dominio.sql`
53. `20260728155942_password_recovery_security_hardening.sql`
54. `20260728172000_password_reauth_nonce_event.sql`
55. `20260728181152_corrigir_rls_politica_versionada_cedente.sql`
56. `20260728182000_rls_historico_portal_sacado.sql`
57. `20260728190000_auditoria_portal_sacado_contexto.sql`
58. `20260728200000_historico_aceite_sacado_operacao.sql`
59. `20260728210000_permitir_evento_documento_entrega.sql`
60. `20260728213000_corrigir_trigger_historico_aceite_nf_status.sql`
61. `20260728220000_reconciliar_documentos_base_nf_checklist_v2.sql`
62. `20260728223000_corrigir_perfil_evento_reconciliacao.sql`
63. `20260729133826_nf_submissao_manual.sql`
64. `20260729180000_simplificar_requisitos_documentais_politica.sql`
65. `20260729185443_performance_escopo2_onboarding_paginado.sql`
66. `20260729203749_performance_portal_sacado_dashboard.sql`
67. `20260730143000_performance_escopo6_escrow_rls.sql`
68. `20260730152328_performance_escopo7_dashboards_relatorios.sql`
69. `20260730170007_performance_escopo8_hardening_grants_rls.sql`
70. `20260730190000_escopo9b_corrigir_isolamento_rls.sql`
71. `20260730194500_escopo9b_policies_explicitas.sql`
72. `20260730200000_escopo9b_corrigir_recursao_sacado_rls.sql`
73. `20260731140710_escopo9c_storage_autorizacao_multifundo.sql`
