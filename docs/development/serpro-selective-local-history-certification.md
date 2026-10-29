# S2.2 — certificação LOCAL do transporte seletivo e histórico

`SQL_GO=false`. Não é executor remoto nem autorização de implantação.

## Método e origem

O projeto já usa a composição `atomicLedgerPayload` em
`scripts/qa/serpro/s1-browser-local.mjs`. O novo módulo puro
`s2-2s-local-history-envelope.mjs` limita essa composição aos hashes dos arquivos
`20261028195850` e `20261028204436`, nessa ordem. Não possui driver, conexão,
credencial, comando de publicação ou modo remoto. Recusa databases sem prefixo
local `r42_` e atores fora do formato sintético do ensaio.

Não se altera a migration original. O transporte insere uma guarda depois do
`BEGIN` original e um INSERT simples no histórico nativo antes do `COMMIT`
original. As demais instruções de negócio não são reescritas. O array
`statements` contém o SQL original completo, incluindo seus próprios limites
transacionais, não o transporte gerado. Os hashes bruto, canônico LF e do
transporte são distintos e registrados separadamente.

O INSERT pertence à execução efetiva da mesma transação, nunca a um repair,
pré-registro ou simulação de aplicação. Não há upsert, registro retroativo nem
replay de fontes históricas recuperadas. O schema do histórico no ensaio é uma
fixture vazia com as seis colunas observadas; não são inventadas as 293 linhas
do ledger remoto. Sua contagem local inicial zero é declarada explicitamente.

Este método usa a tabela nativa `supabase_migrations.schema_migrations`, mas
**não é execução do CLI/MCP Supabase**. O CLI oficial revisado divide e remove
espaços de statements e acrescenta seu INSERT; não se alega equivalência de
bytes, transporte, tratamento de transações ou certificação daquele mecanismo.
Nenhum comando `db push`, `include-all` ou `migration repair` integra o ensaio.

## Limites e confirmação

- Cada arquivo e seu histórico são atômicos. O par não é uma única transação.
- A segunda aplicação exige o nome/hash canônico da primeira no histórico.
- Advisory lock transacional impede aplicação concorrente durante cada arquivo.
- Versão já registrada causa STOP, mesmo com o mesmo hash; não há replay.
- O provider deve permanecer OFF, circuito OPEN, capability UNVERIFIED e budget
  zero. Na primeira migration o campo `consumption_mode` ainda não existe;
  os controles S1 já existentes são verificados e o novo campo nasce OFF.
- Uma conexão independente confirma a versão, nome, hash bruto/canônico,
  quantidade de statements, ator declarado e estado dos objetos após o commit.
- `created_by` registra o ator sintético declarado, não uma identidade humana
  autenticada pelo banco. `session_user` e `current_user` são capturados à parte.
- O ledger observado não possui `applied_at`. Início/fim, relógio do banco e
  transaction ID ficam na evidência externa; não são apresentados como coluna
  nativa ou horário exato de commit.
- Resposta perdida não significa rollback nem autoriza retry. O observer decide
  se houve commit. Se inconclusivo, STOP e permanência OFF.
- Falha da segunda após commit da primeira preserva a primeira e seu histórico;
  o par permanece incompleto, sem rollback destrutivo ou retomada automática.

## Reconciliação sem apagar a fotografia histórica

`s2-2sr-migration-provenance.json` permanece inalterado. A nova reconciliação
anexa evidência datada R41, com dez correspondências de conteúdo e ressalvas
dos registros locais não assinados, nomes de arquivos inline desconhecidos,
exceção P16 e arquivamento Git posterior do SACADO. Não autoriza equivalência
por timestamp, recriação de arquivos históricos ou alterações no ledger.

A saída `--prepare-only` continua bloqueada para SQL remoto. Os hashes do pacote
R41, catálogo e fontes recuperadas permitem conferir o material privado, sem
publicar SQL histórico sensível ou arquivos DPAPI. A fidelidade de catálogo
abrange 24 relações, 25 funções e 4 schemas, não a produção inteira.

## Evidência exigida antes de concluir este escopo

Duas stacks independentes, com rede interna, nenhum host port ou volume de
dados persistente, devem reproduzir o baseline e executar os casos de:
ausência de dispatch, database incorreto, ordem incorreta, falha antes de commit,
falha ao inserir histórico, commit parcial do par, replay, perda real da conexão
antes/depois do commit, concorrência e sucesso das duas versões. Os testes
verificam RLS/FORCE, ACL dos seis workers e estado OFF. Não substituem testes
funcionais completos ou E2E autenticado hospedado.

Limpar somente os recursos Docker identificados como próprios e comprovar a
preservação dos recursos preexistentes e das evidências R41/R4. Este novo diff
local não está coberto pelo CI remoto anterior. Commit, push, CI remoto, GO SQL,
staged e ativação continuam gates separados, não autorizados por esta etapa.
