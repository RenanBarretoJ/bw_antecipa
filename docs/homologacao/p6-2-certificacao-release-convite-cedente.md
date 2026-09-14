# P6.2 — Certificação do release de convite de Cedente

Data da certificação: 14/09/2026

Escopo certificado: P6.1 + saneamento dos gates P6.2

Produção: não alterada durante esta certificação

## Parecer executivo

O release bloqueia, de forma fail-closed e antes da criação do convite, o uso de um e-mail que já exista no Supabase Auth. O lifecycle de convites expirados foi corrigido sem reutilizar contas, criar Cedentes parciais ou afetar os fluxos de Gestor e Super Admin.

Os bloqueios herdados do P6.1 foram encerrados: os 17 testes globais originalmente quebrados foram classificados e corrigidos sem alteração das regras correspondentes; as cinco vulnerabilidades de runtime foram eliminadas com atualizações patch; o E2E de homologação passou com 43 verificações e limpeza integral; e a migration P6.1 passou duas vezes, do zero, sobre clone atualizado de produção com o mesmo hash determinístico.

## Implementação P6.1 certificada

- lookup paginado e server-only em `auth.admin.listUsers`, com normalização `trim/lowercase`;
- resultados fechados `AVAILABLE`, `ALREADY_EXISTS` e `LOOKUP_ERROR`;
- bloqueio anterior à RPC, ao `generateLink` e a qualquer criação parcial;
- compensação do convite pendente quando a corrida é detectada por `generateLink(email_exists)`;
- expiração auditada do convite `PENDENTE` vencido antes da nova tentativa;
- preservação dos fluxos independentes de Gestor e Super Admin;
- nenhuma exposição de `auth.users` ao cliente ou ao papel `authenticated`.

## Inventário das 17 falhas originais

| # | Teste/arquivo | Área | Classificação | Causa comprovada | Relação com P6.1 | Correção |
|---:|---|---|---|---|---|---|
| 1 | `golden-dataset.test.mjs` — fixtures sincronizadas | Golden RLX V1 | `OUTDATED_GOLDEN_FILE` | Comparação byte a byte tratava CRLF do checkout como mudança em 36 fixtures LF canônicas | Nenhuma | Canonicalização CRLF→LF antes da comparação; conteúdo semântico e IDs preservados |
| 2 | `golden-v2.test.ts` — 37 artefatos V1 congelados | Golden RLX V2 | `OUTDATED_GOLDEN_FILE` | Digest dependia do final de linha do sistema operacional | Nenhuma | Digest calculado sobre LF canônico; hash esperado original voltou a conferir |
| 3 | `vortx-vrs2-auth-mtls.migration.test.ts` — índice parcial | Migration/integração | `OUTDATED_TEST_EXPECTATION` | Assert textual sensível a CRLF | Nenhuma | Normalização do texto antes do assert |
| 4 | `cadastro-cnpj-cep-bancos-migration-architecture.test.ts` — catálogo | Migration/cadastro | `OUTDATED_TEST_EXPECTATION` | Assert multiline sensível a CRLF | Nenhuma | Normalização do texto |
| 5 | Mesmo arquivo — estabelecimento | Migration/cadastro | `OUTDATED_TEST_EXPECTATION` | Assert multiline sensível a CRLF | Nenhuma | Normalização do texto |
| 6 | Mesmo arquivo — conta bancária | Migration/cadastro | `OUTDATED_TEST_EXPECTATION` | Assert multiline sensível a CRLF | Nenhuma | Normalização do texto |
| 7 | `nf-remessa-aprovacao-documental.migration.test.ts` — bloco de função | Migration/documentos | `OUTDATED_TEST_EXPECTATION` | Extração não encontrava delimitador CRLF | Nenhuma | Normalização do texto antes da extração |
| 8 | `nf-remessa-atualizar-mesma-chave.migration.test.ts` — branch update | Migration/documentos | `OUTDATED_TEST_EXPECTATION` | Recorte textual incorreto em CRLF | Nenhuma | Normalização do texto |
| 9 | Mesmo arquivo — branch insert | Migration/documentos | `OUTDATED_TEST_EXPECTATION` | Recorte textual incorreto em CRLF | Nenhuma | Normalização do texto |
| 10 | `webhook-comprovante-transportadora-fechar-gaps.migration.test.ts` — revoke | Migration/integração | `OUTDATED_TEST_EXPECTATION` | Assert multiline sensível a CRLF | Nenhuma | Normalização do texto |
| 11 | `webhook-comprovante-transportadora.migration.test.ts` — grants | Migration/integração | `OUTDATED_TEST_EXPECTATION` | Assert multiline sensível a CRLF | Nenhuma | Normalização do texto |
| 12 | Mesmo arquivo — policy `FOR UPDATE` | Migration/integração | `OUTDATED_TEST_EXPECTATION` | Assert multiline sensível a CRLF | Nenhuma | Normalização do texto |
| 13 | Mesmo arquivo — `created_by` | Migration/integração | `OUTDATED_TEST_EXPECTATION` | Assert multiline sensível a CRLF | Nenhuma | Normalização do texto |
| 14 | `ajustes-finais-nf-remessa.migration.test.ts` — função logística | Migration/logística | `OUTDATED_TEST_EXPECTATION` | Bloco extraído vazio em CRLF | Nenhuma | Normalização do texto |
| 15 | `canhoto-requisito-checklist.migration.test.ts` — função logística | Migration/logística | `OUTDATED_TEST_EXPECTATION` | Bloco extraído vazio em CRLF | Nenhuma | Normalização do texto |
| 16 | `testemunhas-runtime.test.ts` — action source | Runtime/testemunhas | `OUTDATED_TEST_EXPECTATION` | Assert multiline sensível a CRLF | Nenhuma | Normalização do source |
| 17 | `bootstrap-fundo-virgem.test.ts` — chamada RPC | Financeiro/bootstrap | `OUTDATED_TEST_EXPECTATION` | Janela fixa de 120 caracteres truncava o fechamento da chamada | Nenhuma | Janela ampliada para 180, mantendo a asserção completa |

Validação direcionada das falhas: 12 arquivos e 124 testes aprovados. Validação global final: 234 arquivos aprovados, 2 ignorados; 1.966 testes aprovados, 11 ignorados; zero falhas.

## Matriz do `npm audit`

| Pacote | Severidade inicial | Relação | Runtime alcançável | Correção | Decisão final |
|---|---|---|---|---|---|
| `next` 16.3.1 | critical | direta | Sim: servidor Next e Image Optimization | 16.3.3 | `PATCH_AVAILABLE_LOW_RISK`; aplicado e validado |
| `nodemailer` 9.0.5 | high | direta | Sim: SMTP operacional | 9.1.1 | `PATCH_AVAILABLE_LOW_RISK`; aplicado e validado |
| `csv-parse` 7.0.1 | moderate | direta | Sim: ingestões financeiras CSV | 7.0.2 | `PATCH_AVAILABLE_LOW_RISK`; aplicado e validado |
| `sharp` 0.35.3 | high | transitiva por Next | Sim: processamento de imagens | 0.35.4 | `PATCH_AVAILABLE_LOW_RISK`; aplicado e validado |
| `baseline-browser-mapping` anterior a 2.11.0 | moderate | transitiva/build | Não no request path, mas atualizável sem ruptura | 2.11.23 | `PATCH_AVAILABLE_LOW_RISK`; aplicado e validado |

Resultado final de `npm audit --omit=dev`: 0 vulnerabilidades (`info=0`, `low=0`, `moderate=0`, `high=0`, `critical=0`). Não houve upgrade major.

## Rehearsal da migration P6.1

Origem: export read-only atualizado do projeto de produção em 14/09/2026. O clone contém 117 tabelas públicas, 27 usuários Auth sanitizados e 2.701 metadados de Storage; senhas, tokens, sessões, MFA, binários, Vault e dados de tabelas sensíveis foram excluídos.

O restore foi endurecido para incluir o schema `private` sem dados, necessário porque triggers atuais de `public` dependem de funções privadas. Nenhuma definição ou dado foi enviado ao repositório a partir do snapshot, que permanece ignorado pelo Git.

Baseline observado no clone atualizado:

| Entidade | Quantidade |
|---|---:|
| Fundos | 4 |
| Cedentes | 13 |
| Perfis/Auth users | 27/27 |
| Gestores | 4 |
| Operações | 49 |
| Notas fiscais | 934 |
| Documentos | 126 |
| Objetos de Storage (metadados) | 2.701 |
| `cedente_fundos` | 13 |
| `usuario_fundos` | 12 |

As divergências em relação ao baseline histórico de 29/08/2026 (12/46/910/123/1.644) são evolução real do ambiente entre snapshots, não efeito da P6.1. Os hashes e contagens usados no rehearsal foram capturados novamente antes de cada ciclo.

Resultados:

| Ciclo | Restore do zero | Migration isolada | Lifecycle expirado | Auditoria | Dados/acessos/FKs preservados | Hash determinístico |
|---|---|---|---|---|---|---|
| 1 | PASS | PASS | PASS | PASS | PASS | `029b8775491c7ad4b5b4834929a2c62452076efc6885eef3e909732bbc3b7cab` |
| 2 | PASS | PASS | PASS | PASS | PASS | `029b8775491c7ad4b5b4834929a2c62452076efc6885eef3e909732bbc3b7cab` |

O teste funcional foi executado dentro de transação local e revertido. O snapshot original não foi alterado. A migration P6.1 não constava no histórico de produção exportado.

## Matriz de regressão P6.1

O E2E de homologação concluiu 43 verificações. Foram validados: e-mail novo; e-mail Auth existente sem organização; corrida `generateLink=email_exists`; compensação; convite pendente válido; expirado; cancelado; aceite; criação atômica 1:1:1:1; replay; CNPJ existente; fundo não autorizado; onboarding; aprovação; auditoria; divergência de e-mail; zero criação parcial; e limpeza final de zero usuários, convites ou Cedentes sintéticos residuais.

Os testes direcionados de Auth, convites, autorização organizacional, Gestor e Super Admin concluíram 86/86. Os três testes diretamente adicionados/evoluídos pela P6.1 concluíram 30/30.

## Classificação das mudanças adicionais P6.2

- `TEST_ONLY`: normalização multiplataforma e correção da janela de source;
- `GOLDEN_ONLY`: comparação canônica de final de linha, sem alteração semântica de golden;
- `MIGRATION_TEST_ONLY`: expectativas textuais portáveis e manifesto atualizado para 177 migrations;
- `RUNTIME_MATERIAL`: patches de segurança em Next, Nodemailer, csv-parse, Sharp e dependência transitiva de browser mapping;
- `MIGRATION_MATERIAL`: somente a migration P6.1 original; nenhuma migration aplicada foi editada.

Por existir mudança material de dependências de runtime, foram obrigatórios e concluídos build de produção, suíte global e E2E completo.

## Qualidade e hashes

- TypeScript: PASS;
- lint: PASS, zero erros e cinco warnings preexistentes;
- build Next 16.3.3 com webpack: PASS, 85 páginas geradas;
- suíte Vitest: PASS, 1.966 testes;
- suíte de rehearsal: PASS, 31/31;
- E2E invite-first homolog: PASS, 43/43;
- `npm audit --omit=dev`: PASS, zero vulnerabilidades;
- secret scan dos 30 arquivos alterados: PASS, zero achados;
- privacy scan dos 30 arquivos alterados: PASS; os dois matches encontrados são fixtures sintéticas preexistentes (`responsavel@empresa.com.br`), sem dado pessoal real;
- `git diff --check`: PASS;
- release candidate: `4d1043f30eb8d595195270225fe8f007b3c840f18b4b756ab53f5bc59b7595f5` (992 arquivos cobertos);
- manifesto canônico de migrations: `b0c710be730f1d9b08e1244e558f0fa78984821099b5c4d4d6014dfaadc677d5`;
- migration P6.1 SHA-256: `8719450ea90b038b7e430150140c11e4f802aa0593550e139042641529e96cfb`;
- lockfile SHA-256: `1f57dd49f9c7223aad0e8a57ab8aa6ab3f72f9a1d20a7dfc7d1b7c155596c26d`.

O SHA do commit é registrado no handoff porque um commit não pode conter o próprio hash de forma imutável.

## Arquivos alterados

Além da implementação P6.1 em `src/lib/actions/convite-novo-cedente.ts`, `src/lib/auth/novo-cedente-invite*.ts`, E2E, testes e migration, a P6.2 altera:

- `package.json` e `package-lock.json` — patches de segurança;
- testes de golden/migration/runtime listados no inventário — portabilidade CRLF/LF;
- `rehearsal/scripts/export-production.mjs` e `restore-local.mjs` — dependências de `private` sem dados;
- `rehearsal/scripts/p6-2-migration-rehearsal.mjs` — execução reproduzível e invariantes;
- `rehearsal/manifests/production-migrations.json` — 177ª migration certificada;
- `rehearsal/manifests/dlz-production-config.json` e `dlz-production-config.mjs` — reancoragem ao manifesto de migrations;
- `rehearsal/scripts/production-manifest.test.mjs` — contagem atualizada;
- este relatório.

## Hold point e produção

`GLOBAL_TEST_SUITE = PASS`

`NPM_AUDIT_GATE = PASS`

`P6_1_REGRESSION_MATRIX = PASS`

`P6_1_MIGRATION_REHEARSAL = DETERMINISTIC`

`P6_2_QUALITY_GATE = PASS`

O hold point pré-commit está aprovado. A aplicação manual em produção, o deploy e os dois smokes reais permanecem fora desta certificação até existirem e-mails de teste explicitamente autorizados e a janela de produção ser executada conforme o runbook. Não usar `supabase db push`; auto-migration de produção deve permanecer desligada.

`P6_2_RELEASE_CONVITE_CEDENTE = PASS`

`P6_2_PRODUCTION_ROLLOUT = NOT_EXECUTED`

`PRODUCTION_READY_FOR_P6_1 = YES`
