# GUIBOR A5/A6 — implementação e certificação

## Estado em 29/09/2026

Implementação local em `feature/guibor-a5-a6-base-comissao`, baseada em homolog
`af96ff4a3e20b3e6922f63fcedc1e93e511001af`. Baseline C5/P16 do Preview
alinhada após autorização explícita; A5/A6 ainda não promovidos.

`GUIBOR_A5_A6_HOMOLOG_READY = NO`

`GUIBOR_PRODUCTION_CHANGED = NO`

O usuário confirmou o bloqueio de LIQUIDO para qualquer NF parcelada. BRUTO
mantém a seleção individual de parcelas. Não há rateio líquido nem fallback.

## Implementação

- `cedente_fundos.base_valor_antecipacao`: BRUTO por default; configuração
  autorizada por fundo, MFA e auditoria. LIQUIDO exige documento explícito,
  valor positivo e ausência de parcelas.
- `operacoes.base_antecipacao_snapshot`: entrada fiscal imutável por operação,
  NF e parcela. Operações anteriores permanecem com snapshot NULL (legado),
  sem backfill financeiro. A memória financeira recalculável permanece separada.
- As RPCs de solicitação recalculam os totais no servidor usando a engine P17
  existente. Aprovação, simulação e remoção usam a base congelada; nenhuma
  alteração de day-count ou nova fórmula foi introduzida.
- Nova solicitação exibe a base; detalhes do Gestor/Cedente/Consultor exibem
  bruto fiscal, líquido fiscal e base congelada.
- `consultor_fundos.comissao_habilitada`: default OFF, configuração por
  organização/fundo, MFA e auditoria. Dashboard e relatório não projetam valores
  ou percentuais OFF; agregados excluem operações de fundos OFF. LEITOR conserva
  a leitura organizacional C5. A fórmula de comissão existente não mudou.
- Configuração da comissão no contexto do fundo e no detalhe administrativo da
  Consultoria; OFF remove as referências e recompõe a grade do Consultor.

Migrations novas, ainda não promovidas:

- `20260929191004_guibor_a5_base_antecipacao.sql`
- `20260929193129_guibor_a6_comissao_por_fundo.sql`

## Evidência local

Node 22.23.3; banco Docker isolado `guibor_a5_a6_20260929` no container local
`supabase_db_fhgkmggthxikfpogrvaa`. O nome do container não representa conexão
com homolog remoto. A cópia de esquema local precisou receber as migrations
C5 `20260925212843` e P16 `20260928185439` já existentes no repositório para
representar os pré-requisitos; seus arquivos não foram alterados.

| Verificação | Resultado local |
| --- | --- |
| TypeScript `tsc --noEmit` | PASS |
| ESLint | Sem erros; aviso preexistente em `liquidacao.ts` |
| `next build --webpack` | PASS |
| Vitest completo | 2497 PASS, 12 skipped; 289 arquivos PASS, 3 skipped |
| SQL A5 | 36 PASS |
| SQL A6 | 17 PASS |
| SQL C2.1 | 28 PASS |
| `git diff --check` | PASS |

A5 cobre valores reais A/B, múltiplas NFs, política alterada sem modificar
snapshot antigo, aprovação com taxa livre, Cedente direto, totais forjados,
provenance inválida/ausente, bloqueio líquido parcelado, remoção de NF,
taxa pendente, reutilização após cancelamento e reprovação, privilégios e
imutabilidade. A regra de parcelas vencidas continua protegida pelo teste de
arquitetura, ajustado à leitura de todas as parcelas antes do filtro em memória.

A revisão final identificou a sobrecarga obsoleta de 16 parâmetros da antiga
solicitação genérica, ainda concedida a authenticated e capaz de omitir o
snapshot. A5 revoga execução direta dessa entrada, preservando o objeto e suas
dependências. As actions atuais usam as RPCs específicas Cedente/Consultor com
17/14 parâmetros; elas continuam certificadas. O teste 36 verifica a revogação.

A6 cobre OFF→ON→OFF, auditoria, bloqueio de alteração por Consultor/LEITOR e
Gestor de outro fundo, projeção sem comissão OFF, multifundo, leitura LEITOR
e hash financeiro inalterado. Há testes de renderização real das páginas para
ausência de referências OFF e regressão ON/multifundo; eles não substituem
o smoke autenticado nem a inspeção responsiva no navegador.

Os testes SQL usam transação com rollback. Consulta final local confirmou
`operacoes=0`, `notas_fiscais=0`, `auth.users=0` no banco isolado.

## Alinhamento autorizado do Preview — PASS

A inspeção inicial somente leitura encontrou A3/A4 nos dois ambientes e A5/A6
ausentes. O Preview `prnudoydwiramsxjnxzn` estava sem quatro migrations
presentes em homolog `fhgkmggthxikfpogrvaa`:

- `20260925212843_c5_r2_organizational_operations_view.sql`
- `20260928130825_c5_r2_reader_dashboard_reports.sql`
- `20260928143646_c5_r2_reader_portfolio_surfaces.sql`
- `20260928185439_p16_liberar_nf_de_operacao_cancelada.sql`

O usuário autorizou: "Sim, alinhar o Preview com homolog". São pré-requisitos
de leitura organizacional e reutilização de NF cancelada. Os arquivos C5/P16
existentes não foram editados; nenhuma branch foi excluída/recriada.

O script `scripts/qa/guibor/align-a5-preview.mjs` fixa o único alvo permitido,
valida hashes locais, executa dry-run e aplica as quatro migrations em uma
transação com timeouts. O registro de cada migration contém o arquivo exato
normalizado para LF, junto da versão e nome originais. Não usa push global.

Os históricos C5 de homolog armazenavam os comandos sem o COMMIT final ou
separados em vários itens. Foi comprovada equivalência SQL após normalizar
esses separadores; por isso seus hashes de armazenamento diferem dos hashes
dos arquivos completos registrados agora no Preview. P16 já tinha o mesmo hash.

| Versão aplicada no Preview | SHA256 do SQL completo normalizado LF |
| --- | --- |
| 20260925212843 | `1afaab9b6cc02d108a731fe0668917b929ab6849eb85a77383884c04a477c68c` |
| 20260928130825 | `a4fe4578494635a0ffca2fda2ae75526474319f3001ffd6b82ead3a1e7ee8625` |
| 20260928143646 | `580913686e5ff9e53c14ea098b0456ae2fdeb5a88efd7d881c4bac2aae015add` |
| 20260928185439 | `6390f43842e82d7d980acfb6ae61e66cd551676e17c21a01a6e8ca237ce3efa1` |

Verificações após aplicação:

- Histórico com as quatro versões e hashes exatos: PASS.
- Fingerprints de NFs, operações e vínculos Cedente/Fundo inalterados: PASS.
- Funções C5 de leitura e carteira presentes: PASS.
- P16: cancelada/reprovada não reservam NF; aprovada reserva: PASS.
- `scripts/homologacao/c5/rls-smoke.sql` executado no Preview em transação
  revertida: `C5_R2_RLS_SMOKE_OK`. OWNER/ADMIN/OPERADOR/LEITOR leem somente seu
  escopo; LEITOR não altera operação; membro/organização inativos e fundo
  revogado não mantêm acesso; isolamento entre organizações preservado.
- Advisors comparados antes/depois: 17 informativos de RLS sem policy e cinco
  avisos de search_path preexistentes, sem acréscimos nessas categorias. Seis
  avisos adicionais correspondem às RPCs C5 SECURITY DEFINER deliberadamente
  concedidas a authenticated, com predicados organizacionais e acesso anon
  revogado, verificados pelo smoke acima. Referência:
  [aviso de RPC privilegiada](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Evidência local: `rehearsal/reports/GUIBOR_A5_PREVIEW_BASELINE_ALIGNMENT.json`.
Homolog foi apenas consultado; produção não foi modificada. O smoke SQL de RLS
não substitui o futuro smoke de aplicação com sessão Auth real.

## Gates ainda pendentes

- Revisão final de A5/A6, commit/push e PR dedicado.
- Aplicação exata das migrations com verificação de hash/history e advisors.
- Smoke autenticado Preview (BRUTO/LIQUIDO, snapshots, roles, multifundo,
  configuração de comissão e regressão ON/OFF).
- Inspeção visual 390/430/820/1440/1920, light/dark, incluindo ausência de gaps
  e overflow; testes de markup não certificam esses itens.
- Homolog: somente A5/A6, smoke real em contexto QA, preservação integral de
  MEDVALE, vínculos e políticas reais, cleanup apenas QA.

Não classificar gates remotos como PASS a partir da suíte local. A implementação
e os testes locais não autorizam produção; parar somente no hold point de
homolog quando todas as evidências remotas estiverem concluídas.
