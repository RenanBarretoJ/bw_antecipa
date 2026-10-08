# R1.2 — fixture documental e recertificação focada

## Resultado: focused PASS; upgrade completo bloqueado

A fixture incompleta foi corrigida sem relaxar o guard documental. O rehearsal
foi recriado do zero e passou em 38 verificações nomeadas, com PostgreSQL e
Storage reais locais. A matriz TypeScript focada passou em 269 testes.

A revisão da ordem de upgrade encontrou outro bloqueio, independente da
identidade municipal: aplicar a C5 antiga depois da A6 R2 já existente
substituiria os wrappers de dashboard/relatórios e restauraria grants
revogados. Pela regra de parada, os upgrades completos e a retomada do R1
ficam bloqueados. Nenhuma dessas alterações foi aplicada em ambiente remoto.

`R1_2_SQL_COMPAT_READY = NO`

`RECON_R1_READY_FOR_HOMOLOG_ROLLOUT = NO`

## O que passou

- Catálogo mínimo oficial, determinístico e idempotente: somente `nf_xml` e
  `nf_danfe_pdf`. Contrato e fontes em `R1_2_FIXTURE_CONTRACT.md`.
- Controle negativo sem tipo obrigatório: `FISCAL_DOCUMENT_INVALID` permanece.
- NF-e, NFS-e nacional e municipal: reserve/stage/commit/assert com HUMAN e
  SYSTEM; chave municipal nula sem inventar chave nacional.
- Identidades incompletas e troca de identidade rejeitadas; dedupe nos dois
  sentidos HUMAN/SYSTEM, concorrência e uma única NF por identidade.
- Lease/owner token, expiry e bloqueio do proprietário antigo.
- Revisão municipal SYSTEM → HUMAN, proveniência e vencimento manual.
- Regressões SQL HEALTH de frozen facts e líquido explícito/calculado.
- Upload/download real, compensação por API, ausência física do objeto
  compensado, bloqueio de insert tardio e exclusão de rascunho/history.
- Companion XML/PDF: requisitos nenhum/XML/PDF/ambos, versão, replay,
  concorrência, recuperação e preservação da aprovação manual.
- Assinaturas, ACL, SECURITY DEFINER e search_path dos três entrypoints
  preservados pela forward; helpers privados sem acesso das roles da API.
- TypeScript global sem emissão e 269 testes focados, sem falhas ou pendências.

O uso do código documental legado `nf_danfe_pdf` não muda a classificação
fiscal: a NF municipal persiste como NFSE, com estratégia municipal própria.
Os bytes sintéticos de Storage não certificam extração de PDF/XML real; essa
distinção está explícita no contrato da fixture.

## Novo bloqueio — revisão estática, não falha SQL executada

O histórico auditado de produção contém a A6 R2 `20260929215557` e não contém
a C5 `20260928130825`. O snapshot schema-only conferido por hash mantém:

- `public.dashboard_consultor_resumo()` →
  `private.dashboard_consultor_resumo_a6()`;
- `public.relatorio_consultor_analitico(...)` →
  `private.relatorio_consultor_analitico_a6(...)`.

A composição R1 exige incorporar as migrations C5 ausentes. A migration
`20260928130825_c5_r2_reader_dashboard_reports.sql` define novamente ambas as
funções públicas com corpos antigos. Esses corpos não usam os helpers A6 nem
o opt-in `comissao_habilitada` por fundo; também concedem EXECUTE a
`service_role`, revogado pela A6 R2. Nenhuma migration posterior da lista
candidata C5 + RLX/DOC + forward R1.1 restaura os wrappers ou revoga o grant.

Referências de código:

- C5: funções nas linhas 15 e 110; comissão sem opt-in nas linhas 76, 100,
  251 e 276; grants no fim da migration.
- A6 R2: escopo por cedente/fundo na linha 67; condição de comissão nas
  projeções; wrappers e grants nas linhas finais da migration.

O preflight reproduzível só lê fontes locais e grava evidência:

```text
node scripts/qa/reconciliation/r1-2-upgrade-preflight.mjs --local-only
```

Resultado esperado neste checkpoint: exit 1, dois wrappers substituídos e
dois grants restaurados. Isso não é um manifest autorizado de execução, nem
um teste SQL de produção/homolog. A evidência remota de catálogo/history é a
captura anterior de 06/10; não foi consultado novamente o banco remoto.

Necessário antes de retomar: compatibilidade forward C5/A6 revisada, preservando
os endpoints analíticos, opt-in por fundo, LEITOR somente leitura e ACL;
depois os dois upgrades completos. Não editar migrations históricas, não
reaplicar A6 original e não falsificar history para resolver a divergência.

## Limites da certificação

O focused usa snapshot anterior às quatro migrations de Notificações, mais
20 migrations RLX/DOC e a forward R1.1. Portanto não equivale a uma baseline
atual completa de produção ou homolog. Os gates de upgrade não receberam PASS.

Não executados após a parada: upgrades production-like/homolog-like,
manifests A–E completos, recuperação final P16/short-circuit, clean-room
canônico completo, full SQL, full suite, lint, Linux build e CI remoto.

`R1_2_SQL_SECURITY = PASS` refere-se à forward fiscal testada, não à ordem
C5/A6 reprovada pelo preflight. Os FAIL dos gates não executados significam
ausência de certificação, não testes SQL executados e falhos.

## Evidências e preservação

- `rehearsal/reports/R1_2_WORKTREE_BEFORE.json`
- `rehearsal/reports/R1_2_FOCUSED_SQL.json`
- `rehearsal/reports/R1_2_TYPESCRIPT_FOCUSED.json`
- `rehearsal/reports/R1_2_UPGRADE_PREFLIGHT.json`
- `rehearsal/reports/R1_2_STATUS.json` — gates e hashes finais.

Todos os 227 arquivos do checkpoint R1 permaneceram byte a byte iguais.
Somente os dois runners R1.1 foram ampliados, além das novas fixtures,
documentação e evidências R1.2. A migration forward segue com SHA-256:

`74ba5ff87d70ffd16a1aac4ac0be8d3c4c032454c1d0bec360567ee18f27cc0b`

Nenhuma migration histórica editada. Nenhum commit, push, deploy, alteração
de ambiente, scheduler, Graph ou SQL remoto. Refs main/homolog/PR87/PR96
conferidas novamente e iguais ao checkpoint. Produção e homolog intactos.

Todos os recursos Docker criados pelo R1.2 foram removidos, com inventário de
ownership. `supabase_db_nfse-submit-20261005` e os demais recursos anteriores
foram preservados. Cache/config temporário pode permanecer; nenhuma tentativa
de contornar a remoção bloqueada da pasta R1.1 foi feita.

As skills Supabase e Postgres orientaram a separação dos testes locais, a
conferência de privilégios e a decisão de não certificar a ordem insegura.
