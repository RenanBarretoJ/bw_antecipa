# P2.6.5 — Validação funcional E2E do clean-room

## 1. Objetivo

Validar, em ambiente Supabase local recriado do zero, que migrations, domínio financeiro P2.2–P2.6, Auth, Data API, RLS, Storage e aplicação funcionam de forma reproduzível e isolada entre fundos. O gate terminou em **FAIL**, sem ressalvas, após detectar leitura cross-fund real pela Data API.

## 2. Estado inicial

- Branch: `homolog`.
- Repositório inicialmente sem alterações pendentes.
- Homologação foi usada somente como fonte read-only de histórico e schema.
- Produção não foi acessada nem alterada.
- O runner foi limitado a URLs locais para Auth, REST, Storage e banco do clean-room.

## 3. Migrations

O inventário canônico possui 120 migrations. O clean-room aplicou 120/120, além da base estrutural `001_schema_base_candidate.sql`. Homologação também apresentou 120/120 migrations canônicas. Não houve migration ausente, extra ou duplicada no gate executado.

## 4. Correção da evidência 119/120

A evidência anterior de 119 migrations ficou obsoleta após a migration canônica mais recente. O P2.6.5 comprovou 120/120 local e 120/120 em homologação. O checklist P2.6.1 não foi atualizado porque o gate final falhou em segurança; atualizar apenas a contagem isoladamente poderia sugerir readiness inexistente.

## 5. Node

Execução feita com Node `v22.23.2`, compatível com `package.json` (`22.x`). Um runtime portátil oficial foi usado exclusivamente para o gate, sem alterar o Node global da máquina.

## 6. Docker

- Contexto: `desktop-linux`.
- Sistema do daemon: `linux`.
- Docker Server: `29.7.2`.
- O stack local foi encerrado ao final e o workspace temporário foi removido.

## 7. Supabase

O Supabase local respondeu corretamente nos health checks de Auth, REST e Storage. As chaves locais foram obtidas do próprio stack e mantidas apenas em memória/processo. Nenhum JWT, senha ou service-role foi gravado nos artefatos.

## 8. Schema parity

O schema material do clean-room ficou equivalente ao de homologação: zero diferenças materiais. Foram classificadas 49 diferenças ambientais permitidas, restritas a objetos internos do Supabase Storage local, principalmente Iceberg e detalhes da função `storage.filename`.

## 9. Clean-room

O ambiente foi criado em diretório efêmero fora do repositório, recebeu a base estrutural, aplicou todas as migrations e executou os datasets do zero. O status global é **FAIL** exclusivamente porque o gate de autorização encontrou exposição cross-fund. Bootstrap, migrations, parity e Golden concluíram antes da interrupção.

## 10. Auth local

Foram criados usuários reais pela Admin Auth API local e autenticados pela Auth API com `signInWithPassword`. As senhas eram sintéticas, derivadas de seed efêmero e descartadas após o login. Os artefatos registram somente ator, recebimento de token e expiração, nunca o token.

## 11. Atores QA

O bootstrap criou `GESTOR_A`, `GESTOR_B`, `CEDENTE_A`, `CEDENTE_B`, `CONSULTOR_A`, `SACADO_A`, `SUPER_ADMIN_PURO` e `SUPER_ADMIN_GESTOR_A`. Cada ator recebeu sessão real e vínculos controlados com os fundos A ou B.

## 12. Bootstrap

O bootstrap estrutural, Auth, perfis, vínculos de fundo, cedentes, consultor, sacado e devedores solidários concluiu. O artefato `bootstrap-e2e-p2-6-5.json` está em **PASS**.

## 13. Fundos

Foram usados dois fundos determinísticos e independentes do Golden V2: principal e adversarial. A matriz comprovou isolamento correto em NFs, operações consultadas, devedores solidários e parte das superfícies financeiras, mas falhou em três recursos documentais/logísticos.

## 14. Golden V1

O Golden V1 passou: 37 fixtures verificadas, 123 NFs, 10 operações D0 e 111 boletos documentais. O seed transacional e a verificação read-only concluíram sem divergência.

## 15. Golden V2

O Golden V2 passou com 384/384 verificações e cobertura esperada de 100%. O fluxo incluiu ingestão, retificação, matching e conciliação para fundo principal e fundo adversarial.

## 16. Golden Security

As cinco verificações transacionais de segurança do Golden V2 passaram. Esse resultado não substitui a matriz Data API: o vazamento foi encontrado justamente no teste com JWT real e PostgREST.

## 17. P2.2

A ingestão versionada foi exercitada pelo Golden V2 em cenários D-1 a D-4, duplicidade, vazio completo e retificação. O estágio passou no clean-room.

## 18. P2.3

Matching e conciliação passaram nas fases A e B. A fase A produziu 24 matches no fundo principal, um no adversarial e 18 resultados de conciliação; a retificação foi incorporada e reprocessada.

## 19. P2.4

O motor logístico passou: 13 verificações funcionais read-only e 26 verificações transacionais de segurança, com mutações revertidas.

## 20. CT-e

O Golden criou e relacionou CT-e com NF, mas a matriz Data API mostrou que `GESTOR_B` conseguiu ler um CT-e do fundo A. A policy `ctes_select` e a policy `ctes_gestor_all` aceitam qualquer role global `gestor`, sem escopo por fundo.

## 21. P2.5

Configuração, execução, 19 verificações funcionais e 16 verificações de segurança passaram. A exposição do Golden foi calculada como `ABAIXO_LIMITE`.

## 22. P2.6

Configuração, execução, oito verificações read-only e 25 verificações de segurança passaram. O fundo adversarial foi classificado como bloqueado por indisponibilidade de PL D-2, conforme massa.

## 23. Auth API

A autenticação real dos oito atores funcionou. A matriz consolidada executou 58 checks antes da interrupção e registrou 13 divergências funcionais ou de autorização. Nenhuma credencial foi persistida.

## 24. RLS API

O resultado é **FAIL crítico**. Um gestor do fundo B leu `documento_requisito_instancias`, `ctes` e `canhotos` pertencentes ao fundo A. São leituras reais via Data API, com HTTP 200 e uma linha visível em cada recurso.

## 25. Anon

O ator anônimo não leu nem inseriu fundos. Os checks executados ficaram conforme o esperado.

## 26. Authenticated

Usuários autenticados não foram tratados como automaticamente confiáveis. O teste comprovou que a role global `gestor`, isoladamente, ainda abre superfícies legadas e precisa ser substituída por autorização contextual por fundo.

## 27. Service role

O service-role foi usado apenas no backend do worker local para bootstrap, fixtures e leituras de controle. Uma checagem de `cte_notas_fiscais` falhou porque o runner selecionou uma coluna `id` inexistente na tabela de chave composta; isso é bug do runner, não evidência de bloqueio do service-role.

## 28. Gestor A/B

`GESTOR_A` e `GESTOR_B` ficaram isolados em NFs, operações, devedores e resultados financeiros testados no sentido cross-fund. O isolamento falhou em checklist documental, CT-e e comprovante de entrega. Além disso, leituras legítimas do `GESTOR_A` em várias tabelas e views financeiras retornaram zero linhas, indicando uma incompatibilidade funcional de policy/bootstrap a investigar após o P0 de segurança.

## 29. Cedente A/B

As NFs ficaram isoladas entre os cedentes. `CEDENTE_A` não conseguiu ler a operação do próprio vínculo na matriz, apesar de o acesso ser esperado; trata-se de divergência funcional adicional, sem exposição de terceiro.

## 30. Consultor

`CONSULTOR_A` leu apenas o cedente e a NF autorizados do fundo A e não leu o cedente/NF do fundo B. Os checks executados passaram.

## 31. Sacado

`SACADO_A` leu a própria NF e foi impedido de ler a NF do fundo adversarial. A tentativa de inserir evento para NF de outro sacado retornou `403/42501`.

## 32. Super admin

O super admin puro não recebeu acesso operacional implícito a NFs ou operações. A leitura do próprio papel administrativo funcionou.

## 33. Híbrido

O super admin com vínculo explícito ao fundo A leu recursos do fundo A e não leu NF do fundo B, conforme esperado.

## 34. Cross-fund

A matriz executou 30 checks cross-fund. Vinte e sete passaram e três falharam: checklist documental, CT-e e canhoto. Como houve linhas visíveis, o resultado é vazamento real, não apenas erro de status HTTP.

## 35. Storage

Os 15 checks de Storage executados não apresentaram divergência. O arquivo de Storage está marcado globalmente como **FAIL** porque o worker abortou por vazamento RLS, mas sua lista interna contém 15/15 checks aprovados. Não houve evidência de leak no Storage antes da parada.

## 36. Approval bypass

A tentativa de `UPDATE` direto repetindo o mesmo status de uma operação foi aceita. Esse teste não prova transição indevida, porque não alterou efetivamente o status e o trigger canônico bloqueia especificamente a entrada em `aprovada`. O check precisa ser corrigido para tentar uma transição real controlada. RPCs antigas e chamadas anônimas foram negadas nos checks concluídos.

## 37. Auditoria

Inserção própria de auditoria foi permitida e update/delete foram negados. Não foi encontrada exposição cross-fund nessa superfície antes da interrupção.

## 38. Eventos de domínio

O sacado inseriu evento no próprio contexto e foi impedido de inserir evento para NF de outro sacado. O resultado executado passou.

## 39. Cron

Não executado. A regra de parada imediata por exposição crítica impediu a inicialização da aplicação e os testes HTTP dos cron jobs.

## 40. Build

Não executado nesta rodada final. O gate parou antes de TypeScript completo, suíte global, lint e build. Somente sintaxe dos runners, teste específico de isolamento clean-room e `git diff --check` foram executados previamente e passaram.

## 41. Deployment dry-run

O `supabase db push --dry-run --local` passou e informou o banco local atualizado. Isso valida a sequência local, não autoriza produção enquanto o RLS estiver vulnerável.

## 42. Cleanup

O stack Supabase local foi parado e o workspace efêmero foi removido. Não houve mutação em produção ou homologação.

## 43. P2.6.1 atualizado

Não atualizado. O artefato P2.6.1 permanece com recomendação anterior e contagem 119; deve ser regenerado somente depois da correção das policies e de uma nova execução integral P2.6.5 em PASS.

## 44. Blockers restantes

1. Substituir policies globais baseadas apenas em `get_user_role() = 'gestor'` por autorização contextual de fundo em `documento_requisito_instancias`, `ctes`, `canhotos` e superfícies relacionadas.
2. Investigar por que o gestor autorizado não lê tabelas/views financeiras e por que o cedente não lê a própria operação.
3. Corrigir o check de chave composta em `cte_notas_fiscais` e o teste de alteração direta de status.
4. Reexecutar todo o clean-room; não basta reexecutar somente os checks que falharam.
5. Somente após zero leak executar cron, suíte global, lint, dependency audit, performance e build.

## 45. Riscos

- **Crítico:** um gestor de outro fundo pode ler requisitos documentais, CT-es e comprovantes de entrega.
- **Alto:** autorizações funcionais legítimas do domínio financeiro retornaram zero linhas, podendo quebrar telas e rotinas.
- **Médio:** parte dos checks de bypass e service-role precisa de ajuste de fixture antes de produzir conclusão definitiva.
- **Controlado:** Storage não apresentou leak nos checks executados.

## 46. Parecer

**P2.6.5 = FAIL. Não há PASS com ressalvas e o sistema não deve ser promovido com o schema atual.** A reconstrução clean-room, o histórico de 120 migrations, o schema parity e os motores Golden P2.2–P2.6 estão reproduzíveis. Porém, a autorização Data API revelou exposição cross-fund concreta. A próxima ação correta é uma fase separada de correção RLS, seguida de nova execução integral do P2.6.5 desde banco vazio.

## Evidências produzidas

- `bootstrap-e2e-p2-6-5.json`: PASS de bootstrap, migrations, parity e health.
- `golden-clean-room-p2-6-5.json`: PASS de Golden V1, V2 e P2.4–P2.6.
- `api-auth-matrix-p2-6-5.json`: FAIL, 58 checks e divergências funcionais/de segurança.
- `cross-fund-api-p2-6-5.json`: FAIL, 30 checks, três leituras cross-fund indevidas.
- `storage-api-p2-6-5.json`: status global FAIL por abort; 15/15 checks internos sem divergência.
- `clean-room-e2e-p2-6-5.json`: resultado agregado, runtime, migrations, parity e cleanup.

## Causa técnica confirmada

- `20260721132903_fase3_repositorio_documental_nf.sql`: `documento_requisito_gestor_all` concede `FOR ALL` a qualquer role global `gestor`.
- `20260721183540_fase5_logistica_pos_cessao.sql`: `ctes_select`, `ctes_gestor_all`, `canhotos_select`, `canhotos_gestor_all` e `logistica_usuario_pode_ler_entrega` tratam qualquer gestor como autorizado, sem validar o fundo do registro.

Essas policies são permissivas e combinadas por `OR`; portanto, policies mais restritas existentes não anulam a abertura global.
