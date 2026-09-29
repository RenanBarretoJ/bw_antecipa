# GUIBOR A5/A6 — implementação e certificação

## Estado em 29/09/2026

Implementação local em `feature/guibor-a5-a6-base-comissao`, baseada em homolog
`af96ff4a3e20b3e6922f63fcedc1e93e511001af`. Baseline C5/P16 do Preview
alinhada após autorização explícita; A5/A6 aplicados no Preview e homolog.
Commit de implementação `d152d30`, PR dedicado
[#73](https://github.com/RenanBarretoJ/bw_antecipa/pull/73) integrado somente em
`homolog` (`d6eec5c`). Ajuste visual e harness integrados pelo
[#74](https://github.com/RenanBarretoJ/bw_antecipa/pull/74), merge homolog
`6a9fd98c3512d764986369da17c8149896af5fc2`. Smoke autenticado final PASS.

`GUIBOR_A5_A6_HOMOLOG_READY = YES`

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

Migrations novas, aplicadas e certificadas no Preview e homolog:

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
| Vitest completo após ajuste dos rótulos | 2499 PASS, 12 skipped; 290 arquivos PASS, 3 skipped |
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

## Histórico da promoção e dos gates intermediários

- Homolog: somente A5/A6, smoke real em contexto QA, preservação integral de
  MEDVALE, vínculos e políticas reais, cleanup apenas QA.

Dry-run homolog identificou somente A5/A6. Aplicação concluída com os dois
hashes exatos acima; fingerprints de NFs, operações, vínculos e histórico
anterior permaneceram iguais. Ainda não certifica a aplicação homolog.

PR #73 integrado somente em homolog (`d6eec5c`), CI completo PASS; deploy
`bw-antecipa-hhpm0oepy-renanbarretoj.vercel.app` com alvo customizado homolog.
Smoke adicional do formulário encontrou o seletor exibindo `BRUTO`/`LIQUIDO`
em vez das descrições. A implementação instalada do Base UI requer `items`
para resolver os rótulos; dois testes reais de renderização reproduziram a
falha. Correção limitada a fornecer esse mapa de rótulos, sem alterar valores,
RPCs, regras ou migrations. Nova certificação visual pendente.

As tentativas interrompidas em homolog removeram seus fixtures QA e
confirmaram o hash integral da configuração MEDVALE inalterado. O PDF real
ainda não foi extraído nessas tentativas, evitando chamadas repetidas ao
provedor visual. Timeout inicial de CLI ocorreu antes de criar QA.

### Robustez do smoke de configuração

O teste de gravação deve aguardar a requisição exata da ação (argumentos do
vínculo e base), não qualquer POST da página: a tela também executa ações de
fundo e acessos. Deve aguardar o término da resposta e conferir o banco. Na
comissão, deve aguardar o botão sair do estado disabled antes do próximo clique.
Esses ajustes são do harness, não de regras financeiras ou de autorização.

Execução `a4a15eab` confirmou LIQUIDO e BRUTO gravados e relidos pelo formulário;
foi interrompida no teste do toggle e seus dados QA foram removidos. Não é PASS
do smoke completo. A tentativa anterior `beabb95b` teve timeout da CLI durante
cleanup: recuperação transacional limitada ao manifesto removeu 4 usuários,
2 cedentes, 2 fundos, 2 operações e 4 notas QA. Consulta posterior no Preview
confirmou zero usuários, cedentes, operações, notas e objetos Storage. Evidência
separada em `GUIBOR_A5_A6_AUTH_beabb95b_CLEANUP_RECOVERY.json`; o resultado
original malsucedido foi preservado, sem transformá-lo em sucesso.

Nova execução completa `d72e57cf`: PASS, cleanup PASS, no Preview
`bw-antecipa-lhfnbzmkg-renanbarretoj.vercel.app` (código de aplicação `6e8ce57`).
Inclui gravação UI LIQUIDO/BRUTO e comissão ON/OFF; quatro sessões Auth/MFA,
governança negativa, snapshots, múltiplas NFs, taxa livre e Cedente direto;
comissão OFF/ON/OFF, LEITOR, multifundo, cinco larguras light/dark e leitura
do snapshot nos três portais. Inspeção visual mobile OFF light e relatório
desktop ON dark confirmou reflow e apenas R$ 900,00 de comissão do fundo ON.
Consulta independente pós-cleanup confirmou zero usuários, operações, notas,
cedentes e objetos Storage no Preview. O harness aguarda a UI estabilizar em
vez de ler o corpo RSC, que pode ser descartado pelo Chrome após refresh.

Os itens pendentes e as tentativas interrompidas acima descrevem etapas
intermediárias. O fechamento remoto abaixo as sucede; não foram promovidos
a PASS retroativamente nem substituídos por resultados da suíte local.

## Certificação final homolog — PASS

Deploy `https://bw-antecipa-r6a3ho2lw-renanbarretoj.vercel.app`, ID
`dpl_FTRUXkPBgzdRED58Np3jw6fCthVo`, target Vercel **homolog** e Supabase
`fhgkmggthxikfpogrvaa`, verificados antes do smoke. CI do PR #74 e CI do merge
homolog PASS (run `36633807775`). Nenhuma promoção para main/produção.

Execução real: `rehearsal/reports/GUIBOR_A5_A6_AUTH_dbcaaf97.json`:

- Quatro usuários temporários autenticados com TOTP/AAL2: Gestor, Cedente,
  Consultor OPERADOR e LEITOR. Não foi reutilizada senha de usuário real.
- Gestor gravou e releu BRUTO/LIQUIDO pelo formulário, com rótulos corretos;
  ativou/desativou comissão pela UI e a flag persistida foi conferida.
- PDF B original `232- HOSPITAL VIDA.pdf` importado pelo portal Cedente:
  bruto R$ 112.710,81, líquido R$ 105.779,10,
  `DOCUMENTO_EXPLICITO`, strategy `danfse_v2_visual`, vencimento manual
  `2026-11-13`. Extração e reextração do fluxo de revisão, sem loop de retries.
  A elegibilidade/aprovação dessa NF foi preparada como fixture SQL QA:
  **não** se afirma aprovação autenticada da NF nesse smoke.
- Operação BRUTO R$ 100.000,00; operação LIQUIDO multi-NF R$ 143.008,80
  (R$ 37.229,70 da fixture A + R$ 105.779,10 do PDF B real), taxa livre 2,4%.
  A fixture A reproduz os valores fiscais previamente certificados; seu PDF
  não foi reimportado nem houve alteração do cadastro MEDVALE.
- Alterar BRUTO→LIQUIDO→BRUTO não modificou operações anteriores. Nova
  operação direta Cedente BRUTO usou R$ 900,00 do servidor, rejeitando o
  total forjado de R$ 1,00 como fonte de cálculo.
- LIQUIDO sem origem explícita negado. Configurações por Consultor, LEITOR,
  Cedente e Gestor de outro fundo negadas.
- OFF→ON→OFF em dashboard/relatórios; DOM sem comissão OFF; ON R$ 900,00
  somente do fundo habilitado, sem incluir o fundo OFF. LEITOR com leitura
  preservada. Larguras 390/430/820/1440/1920, light/dark, sem overflow global.
- Snapshot LIQUIDO e base R$ 143.008,80 lidos nos três portais. Inspeção de
  capturas confirmou relatório OFF mobile dark e operação no Gestor.
- Cleanup PASS: 4 usuários, 2 cedentes, 2 fundos, 5 operações, 5 notas e
  1 objeto Storage temporários removidos. Fixtures podem ser recriadas e o
  PDF original local foi preservado. Sessões revogadas antes da exclusão.
- Hashes antes/depois dos cadastros, estabelecimentos, acessos, fundos,
  vínculos, políticas/versões, escrow e taxas reais da MEDVALE idênticos.
  Consulta independente final: zero usuários, cedentes, fundos, notas,
  operações, eventos, organizações, review intents e Storage **do manifesto QA**;
  MEDVALE real continua presente. Não se afirma que homolog inteiro está vazio.

Hashes das duas migrations novamente conferidos em homolog, iguais aos
registrados acima. Advisors homolog: avisos de RPC SECURITY DEFINER concedida
a authenticated exigem autorização por fundo/MFA (negativas verificadas);
17 INFO sem policy, 5 WARN search_path e aviso preexistente de proteção de
senhas vazadas não foram corrigidos neste ticket. Não se declara linter zerado.

## Status obrigatório / hold point

PASS de regras e regressões usa testes locais/SQL e Auth remoto conforme a
evidência identificada acima. As linhas HOMOLOG referem-se ao smoke remoto
`dbcaaf97`, à migration verificada e ao cleanup independente, não apenas ao CI.

```text
GUIBOR_A5_POLICY_LOCATION = CEDENTE_FUNDO
GUIBOR_A5_DEFAULT_GROSS = PASS
GUIBOR_A5_GROSS = PASS
GUIBOR_A5_NET = PASS
GUIBOR_A5_NET_PROVENANCE_GATE = PASS
GUIBOR_A5_NET_MISSING_FAIL_CLOSED = PASS
GUIBOR_A5_SNAPSHOT = PASS
GUIBOR_A5_POLICY_CHANGE_NO_HISTORY_REPRICE = PASS
GUIBOR_A5_MULTI_NF = PASS
GUIBOR_A5_P17_ENGINE = PASS
GUIBOR_A5_C2_1 = PASS
GUIBOR_A5_CEDENTE_DIRECT = PASS
GUIBOR_A5_P14_P16 = PASS

GUIBOR_A6_FLAG_LOCATION = CONSULTOR_FUNDO
GUIBOR_A6_DEFAULT_OFF = PASS
GUIBOR_A6_GOVERNANCE = PASS
GUIBOR_A6_AUDIT = PASS
GUIBOR_A6_OFF_ZERO_REFERENCES = PASS
GUIBOR_A6_OFF_LAYOUT_REFLOW = PASS
GUIBOR_A6_ON_REGRESSION = PASS
GUIBOR_A6_MULTIFUNDO = PASS
GUIBOR_A6_BACKEND_PROJECTION = PASS
GUIBOR_A6_RESPONSIVE = PASS
GUIBOR_A6_LIGHT_DARK = PASS

GUIBOR_A5_A6_RLS = PASS
GUIBOR_A5_A6_FEATURE_TESTS = PASS
GUIBOR_A5_A6_CI = PASS
GUIBOR_A5_A6_PREVIEW = PASS
GUIBOR_A5_A6_HOMOLOG_MIGRATION = PASS
GUIBOR_A5_A6_HOMOLOG_GROSS = PASS
GUIBOR_A5_A6_HOMOLOG_NET = PASS
GUIBOR_A5_A6_HOMOLOG_SNAPSHOT = PASS
GUIBOR_A5_A6_HOMOLOG_COMMISSION_OFF = PASS
GUIBOR_A5_A6_HOMOLOG_COMMISSION_ON = PASS
GUIBOR_A5_A6_HOMOLOG_RLS = PASS
GUIBOR_A5_A6_HOMOLOG_CLEANUP = PASS
GUIBOR_A5_A6_HOMOLOG_READY = YES

GUIBOR_PRODUCTION_CHANGED = NO
P17_CHANGED = NO
RLX_VORTX_CHANGED = NO
CERC_CHANGED = NO
RLX_EMAIL_CHANGED = NO
```

Parada no hold point de homolog. Produção continua proibida; nenhuma ação de
rollout de produção está implícita nesta certificação.
