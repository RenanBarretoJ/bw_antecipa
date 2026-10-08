# R1.3 — diagnóstico do delta C5/A6 antes da implementação

Fonte: três migrations C5, A6 original e A6 R2 lidas integralmente;
catálogos auditados de 06/10 e snapshot schema-only de produção usado no R1.2.
Não houve consulta ou alteração de dados remotos nesta análise.

## R1_3_C5_OBJECTS_REQUIRED

Efeito líquido das migrations `20260925212843` e `20260928143646`:

- Seis helpers privados `consultor_usuario_pode_visualizar_`:
  `cedente_fundo`, `cedente`, `fundo`, `operacao`, `nota_fiscal`, `entrega`.
- RPCs `consultor_pode_visualizar_cedente`, `consultor_pode_visualizar_operacao`,
  `consultor_listar_cedente_ids_visiveis`, `listar_fundos_visiveis_consultor`,
  `buscar_cedentes_visiveis_consultor`, `consultor_pode_visualizar_nota_fiscal`.
- Par privado/público `listar_cedentes_visiveis_consultor(text,integer,integer)`.
- Composição do ramo Consultor de `logistica_usuario_pode_ler_entrega(uuid)`:
  predicado exato de operação, organização e vínculo cedente/fundo ativos.
- Onze policies SELECT consultor e três índices de ordenação de operações.

Os 14 helpers/RPCs novos e os três índices estão ausentes no catálogo produtivo
auditado; homolog já possui os objetos C5. A forward deve convergir ambos.

## R1_3_C5_OBJECTS_ALREADY_PRESENT

Produção já possui `logistica_usuario_pode_ler_entrega`, sete policies SELECT
consultor e os dois endpoints analíticos. A6 R2 já implementa leitura para
OWNER/ADMIN/OPERADOR/LEITOR sem depender da C5, com helpers privados,
`consultor_escopo_analitico`, flag por vínculo e configuração auditada.
Não há delta analítico a importar de `20260928130825`.

## R1_3_C5_OBJECTS_CONFLICTING_A6

`20260928130825` redefine `public.dashboard_consultor_resumo()` e
`public.relatorio_consultor_analitico(...)` com corpos pré-A6. Deve ser excluída
do upgrade produtivo, assim como as outras duas C5 históricas: o efeito líquido
será entregue somente pela forward. Nenhum wrapper/helper A6 será redefinido.

## R1_3_C5_ACL_DELTA

| Objeto | C5 antiga | A6 R2 / alvo |
| --- | --- | --- |
| Dashboard e relatório públicos | authenticated + service_role | authenticated; postgres/owner preservado; PUBLIC/anon/service_role negados |
| Helpers analíticos privados A6 | não existiam na C5 | authenticated apenas nos dois agregadores; helper de escopo interno sem grant API |
| Novos predicados de leitura C5 | authenticated + service_role | contrato existente C5, sem grant anon/PUBLIC; nenhum grant de escrita |
| Carteira paginada e gate de NF | authenticated | authenticated; sem ampliação |

Validar antes/depois: assinatura, owner, volatility, linguagem, SECURITY
DEFINER/INVOKER, search_path e ACL. A forward exigirá A6 R2 segura como
pré-condição e não tentará corrigir silenciosamente um endpoint divergente.

## R1_3_C5_POLICY_DELTA

Sete policies existentes a compor **somente para SELECT/consultor**:
`cedentes_consultor_select`, `fundos_consultor_vinculado_select`,
`cedente_fundos_consultor_select`, `operacoes_consultor_select`,
`operacoes_nfs_consultor_select`, `notas_fiscais_consultor_select`,
`eventos_dominio_consultor_select`.

Quatro policies adicionais:
`nota_fiscal_parcelas_consultor_select_c5`,
`operacoes_nf_parcelas_consultor_select_c5`,
`operacao_calculo_nfs_consultor_select_c5`,
`documento_requisito_consultor_select_c5`.

Nenhuma policy INSERT/UPDATE/DELETE, de Sacado, de Notificações ou de Storage
será alterada. Timeline continua limitada a visibilidade `cedente`/`ambos` e
operação autorizada. Documento mantém os contextos operação/NF/entrega.
O primeiro rehearsal revelou um conflito C1 adicional: a policy C5 exigia
`operacao_id` e ocultava eventos de NF pré-operação do OWNER. A forward compõe
um ramo sem operação apenas para OWNER/OPERADOR autorizados a operar o cedente,
com vínculo cedente/fundo ativo e `fundo_id` exato. LEITOR não herda esse ramo.
O teste C1 original é preservado como regressão, sem relaxar sua expectativa.

No helper logístico, os ramos Gestor/Cedente permanecem equivalentes ao
snapshot produtivo; só o ramo Consultor passa a validar a operação exata.

## Plano de prova

1. Nova forward: efeito líquido C5 de leitura, sem a migration analítica antiga;
   pré-condições de A6 R2 e nenhuma dependência de A6 original.
2. Controle negativo R1.2 preservado: C5 antiga após A6 R2 continua FAIL.
3. PostgreSQL local: produção sem C5 → forward; história C5/A6/A6 R2 →
   forward; reaplicação controlada; comparar catálogo crítico final.
4. Testes reais de comissão ON/OFF, escopo por fundo, OWNER/OPERADOR/LEITOR,
   negações de mutação, documentos, ACL e regressões Sacado/Notificações.
5. Manifests distintos. Nenhum history será fabricado; nenhum resultado
   focado será apresentado como upgrade completo de produção/homolog.

Testes revisados: `guibor_a6_comissao.test.sql`,
`guibor_a6_r2_analytics_scope.test.sql`, fixture `guibor_a5_a6.sql`,
`scripts/homologacao/c5/rls-smoke.sql`, testes TypeScript C5 e A6 R2.
O smoke C5 legado desativa triggers apenas no seed sintético; a nova matriz
de autorização manterá triggers ligados para não esconder regressões.
