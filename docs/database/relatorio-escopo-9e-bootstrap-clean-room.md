# Escopo 9E — reconstrução do schema-base e clean-room

## Parecer executivo

**NO-GO PARA CUTOVER DEFINITION.**

A origem histórica do schema-base foi reconstruída, o candidato foi mantido fora da cadeia ativa e a instalação `bootstrap + 73 migrations` foi concluída com sucesso em **dois bancos descartáveis independentes**. Os dumps e catálogos finais são idênticos entre os ciclos.

O cutover ainda não pode ser definido porque a instalação limpa não reproduz integralmente homologação. O desvio mais crítico é RLS desabilitada em `public.devedores_solidarios` no clean-room, embora esteja habilitada em homologação. Além disso, o stack Supabase completo não pôde ser iniciado no Docker Desktop desta estação; a prova executada cobre PostgreSQL, schema Storage e checks funcionais reduzidos, mas não comprova Auth/Storage API em execução integrada.

## 1. Escopo e garantias

- Nenhuma migration ativa foi editada.
- Nenhum arquivo `001`/`002` foi adicionado a `supabase/migrations`.
- Nenhuma conexão remota foi usada pelo clean-room.
- A evidência de homologação utilizada é somente leitura e vem do Escopo 9D.
- Nenhum `migration repair`, alteração de histórico ou mutation remota foi executado.
- O bootstrap candidato está em `scripts/perf9e/bootstrap/schema-base-candidate.sql`.

## 2. Reconstrução da fonte

O arquivo `supabase/schema.sql` foi localizado no histórico Git. O commit `94e84e618fa0fbc96312441c847a37aa44afc744` removeu a antiga migration `002_contratos.sql`, introduziu `003_storage_buckets_env.sql` e consolidou o estado-base no schema. O blob atual de `supabase/schema.sql` é o mesmo blob histórico `06f6c4f4d1b6c12d1f7afb60f3cd451042503a07`; portanto, a fonte não foi copiada do estado atual de homologação.

O candidato é uma cópia mecânica rastreável dessa fonte, acrescida apenas de cabeçalho de segurança e transação explícita. O manifest completo está em [bootstrap-candidate-manifest.json](./bootstrap-candidate-manifest.json).

### Defaults legados preservados

O schema histórico contém nomes/CPFs default de testemunhas e razão social/CNPJ default de gestora e custodiante. Eles foram preservados para não alterar silenciosamente o baseline. Isso é dívida de dados/privacidade e deve ser saneado por migration incremental específica, inclusive porque migrations posteriores também inserem testemunhas.

## 3. Procedimento clean-room

Cada ciclo:

1. criou um container PostgreSQL novo, sem volume persistente;
2. provisionou o núcleo Storage compatível com a configuração local;
3. criou o helper padrão de plataforma `auth.jwt()` exigido pelo fluxo MFA;
4. aplicou o bootstrap candidato;
5. aplicou as 73 migrations ativas na ordem canônica;
6. registrou o histórico local;
7. executou checks funcionais reduzidos de RLS/multifundo/Storage;
8. gerou dump e catálogo normalizados;
9. destruiu o container.

Comando reproduzível, protegido por confirmação explícita:

`npm run perf9e:clean-room -- --confirm DISPOSABLE_LOCAL_ONLY`

O runner recusa argumentos remotos, arquivos de ambiente, project ref e qualquer número de ciclos diferente de dois.

## 4. Resultado dos ciclos

| Ciclo | Bootstrap + migrations | Checks | Dump SHA-256 | Catálogo SHA-256 | Resultado |
| --- | --- | --- | --- | --- | --- |
| 1 | 74/74 | 9/9 | 275dd14dd799b77fa5b83830f88d2d631f507a890e25039d45a304a9fcf4c8f4 | b77fb9ba4708bce08f8be2c492eccb090ba1da52dd6f9f977840a21922b5d864 | Aprovado |
| 2 | 74/74 | 9/9 | 275dd14dd799b77fa5b83830f88d2d631f507a890e25039d45a304a9fcf4c8f4 | b77fb9ba4708bce08f8be2c492eccb090ba1da52dd6f9f977840a21922b5d864 | Aprovado |

- Dump normalizado reproduzível: **sim**.
- Catálogo reproduzível: **sim**.
- Seed de aplicação executado: **não**.
- Conexão remota: **não**.

### Checks funcionais reduzidos

☑ 9B: RLS habilitado nas tabelas publicas sensiveis
☑ 9B: helpers privados finais existem
☑ 9B: SECURITY DEFINER possui search_path
☑ 9C: storage.objects com RLS
☑ 9C: policy final delega autorizacao ao helper privado
☑ 9C: buckets privados configurados
☑ 9B funcional: gestor acessa somente fundo autorizado
☑ 9B funcional: SELECT com RLS nao vaza outro fundo
☑ 9C funcional reduzido: objeto sem vinculo e negado

Os checks incluem cenário real de dois fundos, bloqueio de acesso cruzado, filtro RLS e recusa de objeto Storage sem autorização.

## 5. Limitação do stack completo

O runner `perf9e:clean-room:full-stack` foi mantido como diagnóstico. O Supabase CLI 2.111.0 não concluiu `supabase start` nesta estação por falhas internas do Docker Desktop/containerd (metadata read-only) e, após reinício, falha no helper de setup do Realtime. Nenhuma migration chegou a ser executada nessa modalidade.

O clean-room de banco usa imagens oficiais Supabase e é evidência válida para DDL, RLS, grants, funções, triggers e schema Storage. Ainda é necessário repetir o stack completo em um host Docker saudável para validar Auth, PostgREST, Realtime e Storage API em conjunto.

## 6. Migrations parciais e divergentes do Escopo 9D

### Oito parcialmente materializadas

| Versão | Nome | Parecer 9E |
| --- | --- | --- |
| 20260721170157 | fase4_roteamento_aceite_sacado | A cadeia limpa aplica integralmente e converge nos dois ciclos; homologação permanece sem histórico/evidência integral e não deve ser reparada automaticamente. |
| 20260723134849 | estabilizacao_operacoes_atomicas_cnab_compensacao | A cadeia limpa aplica integralmente e converge nos dois ciclos; homologação permanece sem histórico/evidência integral e não deve ser reparada automaticamente. |
| 20260723165651 | corrigir_requisitos_pos_cessao_snapshot | A cadeia limpa aplica integralmente e converge nos dois ciclos; homologação permanece sem histórico/evidência integral e não deve ser reparada automaticamente. |
| 20260723195804 | corrigir_validacao_politica_operacao_atomica | A cadeia limpa aplica integralmente e converge nos dois ciclos; homologação permanece sem histórico/evidência integral e não deve ser reparada automaticamente. |
| 20260728123821 | permitir_tipo_cte_catalogado_em_requisito_generico | A cadeia limpa aplica integralmente e converge nos dois ciclos; homologação permanece sem histórico/evidência integral e não deve ser reparada automaticamente. |
| 20260728223000 | corrigir_perfil_evento_reconciliacao | A cadeia limpa aplica integralmente e converge nos dois ciclos; homologação permanece sem histórico/evidência integral e não deve ser reparada automaticamente. |
| 20260729185443 | performance_escopo2_onboarding_paginado | A cadeia limpa aplica integralmente e converge nos dois ciclos; homologação permanece sem histórico/evidência integral e não deve ser reparada automaticamente. |
| 20260730152328 | performance_escopo7_dashboards_relatorios | A cadeia limpa aplica integralmente e converge nos dois ciclos; homologação permanece sem histórico/evidência integral e não deve ser reparada automaticamente. |

### Duas divergentes

| Versão | Nome | Divergência 9D | Parecer 9E |
| --- | --- | --- | --- |
| 20260728213000 | corrigir_trigger_historico_aceite_nf_status | function:public.registrar_evento_aceite_sacado | Clean-room é estável, mas não prova equivalência retroativa com homologação; requer reconciliação explícita e read-only antes de qualquer plano de repair. |
| 20260730170007 | performance_escopo8_hardening_grants_rls | grant:public.public.listar_onboarding_cedentes_paginado(
  uuid, integer, integer, text, text, text, uuid, text, text
), grant:public.public.relatorio_gestor_analitico(
  uuid, text, text, text, uuid, date, date, integer, integer, text, text
), grant:public.public.relatorio_consultor_analitico(
  text, text, text, uuid, date, date, integer, integer, text, text
) | Clean-room é estável, mas não prova equivalência retroativa com homologação; requer reconciliação explícita e read-only antes de qualquer plano de repair. |

A classificação 9D não foi reescrita. O 9E demonstra que a cadeia, quando parte do baseline candidato, alcança um estado determinístico; isso não autoriza inferir que migrations sem histórico foram aplicadas corretamente em homologação.

## 7. Referências futuras na RPC de reset

A migration `20260723182639_reset_operacional_fundo_homolog_rpc.sql` referencia objetos criados posteriormente, incluindo `eventos_dominio` e `cedente_fundo_politicas`. Ela aplica porque PL/pgSQL posterga parte da resolução de relações até a execução da função. No estado intermediário da cadeia, porém, a RPC não é segura para execução. Ao final dos 73 arquivos as referências existem e o schema converge.

Recomendação: em evolução futura, mover a criação/substituição final da RPC para depois das dependências ou adicionar uma migration incremental que a recrie no ponto correto. Não reordenar migrations já aplicadas.

## 8. Schema diff final

O diff completo e classificado está em [schema-diff-homolog-vs-clean-final.md](./schema-diff-homolog-vs-clean-final.md).

Achados centrais:

- `public.devedores_solidarios`: RLS ligada em homologação e desligada no clean-room;
- a constraint de valor bruto, a função `registrar_cte_documento`, a policy de eventos e as policies de auditoria terminam com semântica diferente;
- uma FK de remessa CNAB e o helper `update_updated_at_column()` existem somente no clean-room;
- diferenças exclusivas de `storage` foram separadas por versão de plataforma;
- diferenças de owner e grantability foram registradas como artefatos do executor, não descartadas.

## 9. Segurança e segredos

- Os artefatos não contêm URLs de banco, tokens, JWTs ou senhas.
- Evidências brutas e dumps permanecem fora do repositório, em diretório local restrito.
- O candidato contém PII/defaults de negócio históricos, explicitamente inventariados; não contém credenciais.
- Os runners sanitizam variáveis remotas e exigem confirmação fechada.

## 10. Próximas ações obrigatórias

1. criar migration incremental para habilitar e testar RLS em `public.devedores_solidarios`;
2. reconciliar cada diferença material de aplicação listada no diff, sem editar migrations aplicadas;
3. alinhar/pinar a versão da plataforma Storage usada no teste com a versão de destino;
4. executar o stack Supabase completo em host Docker saudável;
5. repetir dois ciclos e o diff até não existir desvio material;
6. somente então definir estratégia de cutover e eventual reconciliação do histórico 9D.

## 11. Critérios de aceite do 9E

- ☑ origem histórica do baseline comprovada;
- ☑ candidato fora da cadeia ativa;
- ☑ 73 migrations aplicadas duas vezes do zero;
- ☑ dumps e catálogos reproduzíveis;
- ☑ checks reduzidos 9B/9C aprovados;
- ☑ diff homologação versus clean-room concluído;
- ☐ equivalência material com homologação;
- ☐ RLS integralmente reproduzida;
- ☐ stack Supabase completo aprovado;
- ☐ elegibilidade para cutover.

## Conclusão

A cadeia tornou-se **reproduzível a partir do bootstrap candidato**, um avanço material sobre o diagnóstico 9D. Ela ainda não é equivalente ao estado de homologação e não reproduz uma proteção RLS existente. O resultado oficial é **NO-GO PARA CUTOVER DEFINITION**. Nenhuma alteração remota foi realizada.
