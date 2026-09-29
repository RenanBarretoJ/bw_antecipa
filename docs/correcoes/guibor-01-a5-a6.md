# GUIBOR A5/A6 — implementação e certificação

## Estado em 29/09/2026

Implementação local em `feature/guibor-a5-a6-base-comissao`, baseada em homolog
`af96ff4a3e20b3e6922f63fcedc1e93e511001af`. Baseline C5/P16 do Preview
alinhada após autorização explícita; A5/A6 aplicados somente no Preview.
Commit de implementação `d152d30`, PR dedicado em rascunho
[#73](https://github.com/RenanBarretoJ/bw_antecipa/pull/73), base `homolog`.

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

Migrations novas, aplicadas no Preview e homolog; smoke homolog ainda pendente:

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
17/13 parâmetros; elas continuam certificadas. O teste 36 verifica a revogação.

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

## A5/A6 no Preview

Aplicação controlada por `scripts/qa/guibor/a5-a6-migration.mjs`, sem push
global e sem alterar dados financeiros anteriores. History contém o SQL
completo normalizado LF e estes SHA256:

- A5 `20260929191004`: `b0ee16a0179012da540956d9df4fb6f456dbf81c85015ea681ff52959148f940`.
- A6 `20260929193129`: `99339e4385d23dd13bd97bf6b5bb864c439a3d9568125de2306058fbdb655bb3`.

`a5-a6-remote-sql.mjs` executou pgTAP no Preview: A5 36 PASS, A6 17 PASS.
Fixtures e extensão temporária foram revertidas ao final de cada transação.
O teste SQL não substitui Auth real nem browser.

O CI do PR passou. O check automático Supabase Preview falhou e não criou
banco para a nova branch; foi reutilizado o Preview explicitamente autorizado
`prnudoydwiramsxjnxzn`, sem excluir outra branch. Sete variáveis Vercel foram
configuradas exclusivamente para `feature/guibor-a5-a6-base-comissao` no alvo
Preview. Credenciais não foram impressas nem gravadas no repositório.

Redeploy de `d152d30`: `bw-antecipa-azqgk00tn-renanbarretoj.vercel.app`.
CSP de runtime confirmou o host Supabase do Preview antes de criar contas QA.
Nenhuma variável global, de homolog ou produção foi alterada.

Advisors pós-A5/A6: 17 INFO RLS sem policy e cinco WARN search_path, ambos
preexistentes; 166 avisos de RPC SECURITY DEFINER executável por authenticated
(164 após C5). A nova superfície tem autorização por fundo e MFA, com
negativas verificadas em SQL e Auth real. A entrada obsoleta sem snapshot
foi revogada. Referência do linter permanece no link acima.

Smoke Auth Preview PASS (`GUIBOR_A5_A6_AUTH_ad5fb67e.json`): quatro papéis com login/MFA reais; governança,
BRUTO/LÍQUIDO, snapshot imutável, taxa livre, Cedente direto e projeção
multifundo verificados. A primeira coleta visual continha carregamento e
foi descartada como certificação; o harness agora aguarda o conteúdo real.
A segunda execução confirmou OFF/ON/OFF, LEITOR, multifundo e as cinco larguras
em light/dark sem overflow da página. Inspeção visual de amostras mobile OFF,
desktop ON e Gestor confirmou o conteúdo; os três portais exibiram o snapshot.
Cleanup verificado no banco: zero usuários, operações, NFs, eventos, vínculos
de operação, cedentes e objetos Storage. As migrations permanecem aplicadas.

## Gates ainda pendentes

- Homolog: somente A5/A6, smoke real em contexto QA, preservação integral de
  MEDVALE, vínculos e políticas reais, cleanup apenas QA.

Dry-run homolog identificou somente A5/A6. Aplicação concluída com os dois
hashes exatos acima; fingerprints de NFs, operações, vínculos e histórico
anterior permaneceram iguais. Ainda não certifica a aplicação homolog.

Não classificar gates remotos como PASS a partir da suíte local. A implementação
e os testes locais não autorizam produção; parar somente no hold point de
homolog quando todas as evidências remotas estiverem concluídas.
