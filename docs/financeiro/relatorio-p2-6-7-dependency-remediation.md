# P2.6.7 — Dependency Remediation & Runtime Security Hardening

Data da execução: 17/08/2026

Ambiente autorizado: homologação (`fhgkmggthxikfpogrvaa`)

Resultado da fase: **PASS**
Readiness geral: **NO-GO**

## 1. Objetivo

Eliminar os achados de segurança do lockfile e endurecer os pontos de runtime afetados, sem alterar regras de negócio, schema, migrations ou produção. O gate `DEPENDENCY_AUDIT` pode passar de `FAIL` para `PASS`; os demais blockers continuam independentes.

## 2. Estado de entrada

A branch `homolog` iniciou limpa no commit `6f38de577a7cb0cdcf3500b24e0879d2347d3b31`. Havia 125 migrations locais e remotas. O baseline funcional do P2.6.6 estava aprovado, mas o audit apresentava 23 vulnerabilidades.

## 3. Readiness inicial

O estado inicial era `NO-GO`, com `DEPENDENCY_AUDIT` e `PERFORMANCE_FULL_PIPELINE` em `FAIL`, além de smokes autenticados e de concorrência pendentes. O snapshot read-only regenerado também detectou a rotina residual `private.rlx_gestor_tem_acesso_fundo`.

## 4. Node

Toda a execução foi feita com Node `v22.23.2` e npm `10.9.8`, usando distribuição oficial descartável. Compatibilidade foi comprovada em desenvolvimento Windows e clean-room Linux.

## 5. Package hashes

| Arquivo | Antes | Depois |
|---|---|---|
| `package.json` | `094789DA3E558BCC68537E99BC65BEA2025F954650BF44340F643BCFBBBEDAA2` | `34492062FE2FB5E10B8CEF8F32889481BFE373C02374BA3B9F1FB9D83BA27E0A` |
| `package-lock.json` | `CFFE2CA57D96FC0B2366FB135AB414CBEDD8062AA6F6D87BC9A600B9F5F6111B` | `9CC0848ED2DA4B66DB401DDB4F03FDED9C55013283A6F6ED46D673AEC9386E50` |

## 6. Audit inicial

`npm audit --omit=dev --json` e `npm audit --json` reportaram a mesma distribuição: 1 critical, 16 high, 4 moderate e 2 low, totalizando 23. O inventário integral está em `dependency-audit-before-p2-6-7.json`.

## 7. Findings

Os grupos relevantes eram Handlebars, Next.js e sua árvore de imagem/CSS, Puppeteer e seu resolvedor de browsers, além de transitivos como `ws`, `nanoid`, Babel, Hono, `qs`, `brace-expansion`, `js-yaml`, `picomatch` e `path-to-regexp`.

## 8. Classificação

Handlebars, Next.js, Puppeteer Core, Chromium, PostCSS, Sharp, Nanoid e WS foram classificados como runtime direto ou transitivo alcançável. A árvore do CLI `shadcn` foi classificada como tooling/dev: não há importação pela aplicação e o pacote foi movido para `devDependencies`. Nenhum finding foi descartado como falso positivo.

## 9. Reachability

Os consumidores reais são:

- `src/lib/templates/resolver-template.ts`: Handlebars e validação de templates;
- `src/lib/pdf/gerarContrato.ts`: Chromium/Puppeteer e geração de contratos/PDF;
- `scripts/perf9a/*.mjs`: Puppeteer Core em smokes e perfis controlados;
- Next.js: App Router, Route Handlers, Server Actions, proxy e build da aplicação.

## 10. Handlebars

Atualizado de `4.7.8` para `4.7.9`, a menor versão segura razoável encontrada. O fallback de compilação direta em `gerarContrato.ts` foi removido; toda renderização jurídica agora atravessa o resolvedor controlado existente.

## 11. Templates

O resolvedor mantém helpers permitidos limitados a `if` e `each`, bloqueia helpers desconhecidos, propriedades de prototype e templates malformados. A validação AST foi corrigida para distinguir variáveis locais de `#each` das variáveis de raiz, sem ampliar o conjunto autorizado.

## 12. PDF

Foram gerados PDFs sintéticos reais de contrato, termo de cessão e termo de quitação. Os três iniciaram com `%PDF`, tiveram tamanho maior que 100 bytes e não lançaram exceção. Nenhum documento real foi utilizado.

## 13. Next

Atualizado de `16.2.6` para `16.3.1`. A correção exigiu minor seguro porque a alternativa de patch avaliada ainda preservava transitivo vulnerável. App Router, Route Handlers, Server Actions, cookies/headers/redirects, proxy e build webpack passaram sem regressão.

## 14. Puppeteer

`puppeteer-core` foi atualizado isoladamente de `24.40.0` para `25.8.0`; `@sparticuz/chromium` passou de `143.0.4` para `149.0.0`. O desenho com browser externo foi preservado: não foi adicionado `puppeteer`. O fluxo suporta `CHROME_PATH` em desenvolvimento e Chromium externo/configurável no servidor.

## 15. Outras dependências

O lockfile atualizou somente transitivos necessários ou compatíveis para remover os advisories. Entre os principais: PostCSS `8.5.23`, Sharp `0.35.3`, Nanoid `3.3.18`, WS `8.21.3`, Babel `7.29.7`, Hono `4.13.2`, `qs` `6.15.3` e `picomatch` corrigido.

## 16. Dependências removidas

Nenhum pacote direto foi removido. Os transitivos vulneráveis `extract-zip` e `basic-ftp` deixaram a árvore com a atualização de Puppeteer; um caminho obsoleto de `follow-redirects` também foi eliminado.

## 17. Overrides

Nenhum `override` foi adicionado. Não foi usado `npm audit fix --force`. O `npm dedupe --dry-run` passou, mas o dedupe não foi aplicado porque introduziria churn não relacionado.

## 18. package.json

Mudanças diretas: Handlebars `^4.7.9`, Next `^16.3.1`, Puppeteer Core `^25.8.0`, Chromium `^149.0.0`, `eslint-config-next` alinhado em `^16.3.1` e `shadcn` movido para desenvolvimento. Não houve pacote direto novo.

## 19. Lockfile

O lockfile foi regenerado pelo npm, sem edição manual, credencial, URL privada autenticada ou token. `npm ls --all` encerrou com código zero.

## 20. Clean install

`npm ci` foi executado em workspace descartável com Node 22: 752 pacotes instalados em 48,3 s, zero vulnerabilidades e status `PASS`. O teste não dependeu do `node_modules` existente no repositório.

## 21. Audit final

Tanto `npm audit --omit=dev --json` quanto `npm audit --json` retornaram zero findings. Evidência em `dependency-audit-after-p2-6-7.json` e `dependency-security-summary-p2-6-7.json`.

## 22. Critical

Antes: 1. Depois: 0. Gate obrigatório atendido.

## 23. High

Antes: 16. Depois: 0. Gate obrigatório atendido.

## 24. Moderate

Antes: 4. Depois: 0. Não foi necessária aceitação formal de risco.

## 25. Low

Antes: 2. Depois: 0. Não há backlog low originado por esta fase.

## 26. Dev-only

A árvore completa, incluindo desenvolvimento, terminou em zero. O CLI `shadcn` permanece disponível apenas em `devDependencies`, reduzindo alcance de produção sem perda funcional.

## 27. Targeted tests

Os testes direcionados finalizaram com 2 arquivos e 14 testes aprovados: segurança/semântica de templates e três gerações reais de PDF. A incompatibilidade da API `waitForNetworkIdle` do Puppeteer 25 foi detectada e corrigida antes da suíte final.

## 28. Template security

Foram cobertos template simples, variáveis, condicionais, loops, missing variables, escaping HTML, helper desconhecido, entrada malformada e propriedades semelhantes a prototype. Não foi identificada execução de código ou acesso arbitrário.

## 29. PDF smoke

Contrato, termo de cessão e termo de quitação: `PASS`. A seleção de browser, o carregamento da página e a espera de rede foram exercitados com Chrome real.

## 30. HTTP smoke

No clean-room, `/login` retornou 200, cron sem autenticação retornou 401, `/api/cron/financeiro` retornou 200 e o alias RLX retornou 200. Nenhum provider externo foi chamado. Smokes de browser autenticado continuam no gate independente.

## 31. TypeScript

`npx tsc --noEmit`: `PASS`.

## 32. Tests

`npm test -- --run`: 143 arquivos aprovados e 1 skipped; 1028 testes aprovados e 3 skipped. O baseline de 141/1019 foi superado e nenhum teste foi removido.

## 33. Lint

`npm run lint`: `PASS`, zero erros e os mesmos seis warnings preexistentes.

## 34. Build

`npx next build --webpack`: `PASS` com Next `16.3.1` e 78 rotas. O build clean-room compilou em aproximadamente 32,2 s; o warning `require.extensions is not supported by webpack` foi eliminado ao externalizar Handlebars no servidor.

## 35. Clean-room

O runner P2.6.7 recriou stack descartável, aplicou 125/125 migrations, executou bootstrap, matrizes, Golden, build e dry-run, e removeu a stack ao final. Status geral: `PASS` em cerca de 273 s.

## 36. Golden

Golden V1: `PASS`; Golden V2: 384/384; security: 5/5; P2.2, P2.3, P2.4, P2.5 e P2.6: `PASS`.

## 37. Data API

86/86 verificações aprovadas no clean-room com atores e JWTs novos.

## 38. Cross-fund

39/39 verificações aprovadas; `zero_leak=true`.

## 39. Storage

15/15 verificações aprovadas, sem exposição pública ou cruzada entre fundos.

## 40. Approval bypass

Estado anterior `solicitada`; tentativa de forçar `aprovada`; resultado `DENY`; estado final permaneceu `solicitada`.

## 41. Cron

Rota canônica e alias passaram; chamada sem segredo retornou 401. Nenhum envio a provider externo foi realizado.

## 42. Secret scan

1024 arquivos de texto analisados, zero achados. A rotação da credencial de homologação continua obrigatória (`credential_rotation_required=true`) e nenhum segredo foi persistido.

## 43. Supply chain

Zero pacote direto novo, zero override, zero finding de desenvolvimento e instalação reproduzível. Não há `.npmrc` versionado com token. O `npm ci` completo, incluindo o ciclo normal de instalação, passou no workspace descartável.

## 44. P2.6.1 atualizado

`production-readiness-p2-6-1.json` foi atualizado com 125/125 migrations, suíte atual, secret scan atual, clean-room P2.6.7 e `DEPENDENCY_AUDIT=PASS`. A recomendação permanece `NO-GO`.

## 45. Blockers restantes

- `PERFORMANCE_FULL_PIPELINE=FAIL`;
- `ZERO_RLX_STRUCTURAL=FAIL` pela rotina residual `private.rlx_gestor_tem_acesso_fundo`;
- smokes autenticados de login/MFA, central visual e cenários operacionais;
- concorrência E2E de aprovação, TOCTOU e stale review;
- rotação da credencial de homologação.

## 46. Riscos

Puppeteer/Chromium receberam upgrade major isolado, mitigado por testes reais de PDF, TypeScript e build. Compatibilidade de browser externo depende de configuração correta no ambiente de execução. Os blockers de performance/schema/autenticação não foram alterados por estarem fora do escopo. Produção não foi acessada ou modificada.

## 47. Parecer

**P2.6.7 = PASS.** O gate `DEPENDENCY_AUDIT` pode mudar de `FAIL` para `PASS` porque audits de produção e árvore completa retornam zero critical, high, moderate e low; clean install, runtime afetado, suíte completa e clean-room passaram. O BW Antecipa permanece **NO-GO para produção** até a resolução dos blockers independentes listados acima.

## Arquivos da fase

Código e dependências:

- `package.json`
- `package-lock.json`
- `next.config.ts`
- `src/lib/templates/resolver-template.ts`
- `src/lib/templates/resolver-template.test.ts`
- `src/lib/pdf/gerarContrato.ts`
- `src/lib/pdf/gerarContrato.runtime.test.ts`

Evidências e readiness:

- `docs/financeiro/dependency-audit-before-p2-6-7.json`
- `docs/financeiro/dependency-audit-after-p2-6-7.json`
- `docs/financeiro/dependency-security-summary-p2-6-7.json`
- `docs/financeiro/dependency-changes-p2-6-7.json`
- `docs/financeiro/runtime-security-p2-6-7.json`
- `docs/financeiro/clean-room-e2e-p2-6-7.json`
- `docs/financeiro/bootstrap-e2e-p2-6-7.json`
- `docs/financeiro/golden-clean-room-p2-6-7.json`
- `docs/financeiro/api-auth-matrix-p2-6-7.json`
- `docs/financeiro/cross-fund-api-p2-6-7.json`
- `docs/financeiro/storage-api-p2-6-7.json`
- `docs/financeiro/migration-inventory-p2-6-1.json`
- `docs/financeiro/production-readiness-p2-6-1-read-only.json`
- `docs/financeiro/production-readiness-p2-6-1.json`
- `docs/financeiro/secret-scan-p2-6-1.json`

Nenhum commit ou push foi executado.
