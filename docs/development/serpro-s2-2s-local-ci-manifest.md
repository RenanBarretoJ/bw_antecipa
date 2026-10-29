# S2.2S: CI local e manifesto seletivo (sem publicacao)

Escopo autorizado: ajustar somente orquestracao de CI e infraestrutura de teste,
preparar manifesto seletivo e validar localmente. Sem commit, push, rerun remoto,
PR novo, deploy, SQL remoto, recuperacao remota de artefatos ou consultas SERPRO.
As skills de Supabase e Vercel orientaram a separacao entre preparacao, prova
local e futura aplicacao. Nao houve mudanca de regras fiscais, Auth, MFA ou RLS.

## CI preparado

O job `serpro_operational` substitui o job legado **somente** no PR da branch
`feature/s1-serpro-nfe-gestor-20261026`. Os demais caminhos do workflow continuam
intactos. Nao foi acrescentado trigger de push, workflow_dispatch ou deploy.

- Checkout sem credenciais persistidas e permissao `contents: read`.
- Node 22, imagens oficiais com digest imutavel e OpenSSL no runner Linux.
- Proveniencia: SHA realmente executado, tree, head e base; base esperada b1221a0.
  Um merge ref so passa com tree identico ao head. Nao e chamado de CI do SHA
  exato do head. A arvore mudara com este ajuste: o GO anterior nao o publica.
- Nenhuma referencia a secrets no novo job; configuracao sintetica e SERPRO OFF.
- Provisionamento via snapshot versionado somente de schema, rede Docker
  interna exclusiva, sem publicacao de portas e inspecoes antes/depois do start.
- SQL S1, pilotos em clones separados, migrations operacionais sem pilotos,
  recuperacao/concorrencia/outbound, Auth/TOTP/Storage nativos, seis contratos
  EMAIL03/importacao e suite Vitest completa, sem remover testes ou assertions.
- TypeScript, lint e build com `--webpack`; evidencia sanitizada e limpeza.

Na retomada S2.2S-R, um builder Node 22 oficial prepara `npm ci --ignore-scripts`
em volume Linux novo, com apenas package.json/package-lock montados read-only.
Os 871 pacotes do lock sao limitados ao registro publico npm e integridade
sha512. O builder nao recebe repo, npmrc, credenciais, fixtures ou dados fiscais.
Prazo total de 600s (nao aumentado), limite de 2 GiB/100.000 arquivos. O builder
e sua rede de registro sao removidos antes das fixtures. A QA monta o volume
read-only, em rede interna separada, e cria um symlink local em tempo constante.
Nao se usa mais S22_LINUX_DEPS_DIR nem docker cp da arvore Windows de pacotes.
O lock e package.json devem ser identicos antes/depois do npm ci, normalizando
**apenas CRLF para LF**. O volume e removido na limpeza auditada do ensaio.

O build webpack precisa baixar Inter/Geist Mono via next/font. Ele roda em
outro container Linux, com inputs de codigo/dependencias read-only, configuracao
sintetica e rede propria de build, sem Auth/Database/Storage ou tokens de QA.
Nao se libera egress na rede dos testes. A primeira tentativa de build nessa
rede interna falhou por DNS de fonts.googleapis.com e foi preservada, sem
mockar fontes nem ignorar o erro. Esta separacao espelha o build do CI Linux.

Validacao local reproduzivel, com Node 22, Docker local e as dependencias Linux
do mesmo lock ja preparadas:

```powershell
node scripts/qa/serpro/s2-2s-local-validation.mjs --local-only
```

Esse comando recusa arquivos `.env*`, nao usa credenciais reais e apenas
inspeciona imagens preexistentes. Somente o builder de dependencias acessa o
registro publico npm; os testes nao possuem egress para provedores. Relatorios
da retomada: `%LOCALAPPDATA%/bw-antecipa-evidence/s2-2sr-local-20261028/validation-*`.
O comando foi feito para o checkout local de base 461896b; outro HEAD exige
revisao explicita, nao uma alteracao automatica do limite.

## Manifesto seletivo: preparacao, nao aplicador

`scripts/qa/serpro/s2-2s-selective-manifest.json` registra a selecao e os hashes
SHA-256 canonical LF dos arquivos, preservando os originais. O inventario dos
297 arquivos SQL tambem e congelado por hash. Apenas duas migrations entram:

1. `20261028195850_s2_2_serpro_operational_queue_history.sql`.
2. `20261028204436_s2_2r_serpro_outbound_fencing_recovery.sql`.

As migrations `20261028140420` e `20261028173558` dos pilotos ficam excluidas,
mas preservadas e testadas separadamente. O analisador nao conecta a banco,
nao aplica SQL, nao exporta um diretorio executavel, nao altera ledger e nao
possui modo `apply`:

```powershell
node scripts/qa/serpro/s2-2s-manifest.mjs --prepare-only
node --test scripts/qa/serpro/s2-2s-ci.test.mjs
```

Uma preparacao valida retorna exit 0 e `DRAFT_BLOCKED`, **nunca autorizacao de
migration**. O inventario remoto e somente o snapshot historico capturado em
2026-10-28T21:52:30.387Z, com 293 versoes. Nao houve nova consulta remota nesta
etapa; a confirmacao do operador de que os dois automatismos GitHub/Supabase
continuam desligados nao substitui futura verificacao de estado.

Ha dez versoes do ledger sem arquivo de mesmo timestamp no checkout. Somente
um arquivo de timestamp diferente coincide em hash com o SQL registrado;
isso e candidato de proveniencia, nao uma reconciliacao aprovada. Os outros
nove casos continuam sem correspondencia exata neste checkout. Nomes iguais
nao comprovam bytes ou equivalencia semantica. Os demais SQLs da baseline
tambem nao receberam atestacao integral de conteudo remoto.

Para transformar o rascunho em artefato aplicavel: novo GO, refresh autorizado
do ledger, comprovacao dos SQLs historicos e mapeamentos, prova descartavel do
artefato seletivo e revisao de suas dependencias. Nao executar db push/migration
up sobre a pasta inteira; nao renomear originals, fabricar placeholders ou
marcar como aplicada uma migration que nao foi executada.

CI remoto, QA hospedado e qualquer publicacao continuam pendentes de nova
autorizacao. Um resultado local nao certifica o GitHub Actions hospedado.

## Resultado da primeira rodada deste ajuste

- 24 contratos novos de CI/manifesto e dez contratos de infraestrutura nativa
  passaram. O inventario de 297 SQLs manteve o hash original.
- S1 SQL (22 assertions), pilotos em clones isolados e SQL operacional de
  autorizacao, concorrencia e recuperacao passaram na stack descartavel.
- A materializacao de `node_modules` por `docker cp` atingiu o timeout existente
  de 600 segundos **antes** dos contratos Auth/TOTP/Storage e da suite completa.
  Esses testes permanecem pendentes para este ajuste. Nao foi aumentado o
  timeout, relaxada assertion ou classificada a falha como defeito de fixture.
- Uma tentativa de empacotamento local tambem nao concluiu e foi interrompida;
  ela nao comprova a causa raiz do timeout. Seu arquivo parcial nao foi usado.
- A limpeza Docker passou e todos os recursos preexistentes foram preservados.
- Em verificacao independente, TypeScript e build Node 22/webpack passaram;
  lint sem erros, com os dois avisos preexistentes nos testes EMAIL03.

O ajuste esta preparado, mas a validacao integrada e parcial. Concluir a
materializacao em filesystem Linux local e repetir em stack nova antes de
declarar certificacao local integral. Preservar o relatorio desta tentativa.

## Proveniencia e procedimento seletivo proposto (nao executado)

Tabela completa: `scripts/qa/serpro/s2-2sr-migration-provenance.json`, ligada por
hash ao manifesto. Classificacao CONFLITANTE indica bytes diferentes, nao uma
conclusao de divergencia semantica. Objetos extraidos de arquivos candidatos nao
sao evidencia do catalogo remoto. Hash identico do Consultor nao aprova alias de
versao. P16 e excecao historica documentada pelo owner; nao sera recriada nem
renumerada por inferencia. Evidencia remota desta tabela e o snapshot anterior,
nao uma leitura atual. O gate do CI nao depende de encerrar essas equivalencias.

Para futuro GO SQL separado, sem comandos de escrita nesta etapa:

1. Confrontar um snapshot autorizado atual de versoes, owners, assinaturas RPC,
   ACL/RLS/FORCE, cutover, fila e dependencias S1 com as pre-condicoes aprovadas.
2. Resolver cada divergencia essencial ou obter excecao explicita e auditada do
   owner. Nao materializar nem aplicar a pasta inteira de migrations.
3. Revalidar exclusivamente os dois arquivos operacionais e hashes fechados do
   manifesto; provar a transacao seletiva em clone descartavel equivalente,
   sem pilotos e sem qualquer normalizacao do historico.
4. Um aplicador futuro aprovado devera adquirir lock de migration, verificar
   pre-condicoes novamente e tratar SQL, auditoria e registro somente das duas
   versoes realmente executadas na mesma transacao. Falha implica rollback.
   Nao preinserir ou reparar manualmente entradas de ledger.
5. Postflight somente leitura: dois registros novos exatos, catalogo/ACL/RLS,
   invariantes da fila/cutover e hashes, contadores OAuth/GET zero, SERPRO OFF.

Este documento e o manifesto nao sao um aplicador e nao autorizam essa etapa.
