# E2.7 — PoC isolada de parsers

Nenhum módulo deste diretório é importado pela aplicação. Adaptador, dispatcher,
persistência, migrations, schemas e evidências E2.5 permanecem intactos.
Use Node **22.x** explicitamente; o Node padrão desta estação é diferente.

Instale somente neste pacote: `npm ci --ignore-scripts --prefix scripts/qa/nfse-national/e27`.
Não atualize as dependências da raiz. As versões estão fixadas no lock.

Para cada engine `saxes`, `sax` e `fast`, configure no processo de QA:

- `BW_NFSE_E27_PARSER`: engine escolhido.
- `BW_NFSE_E27_OUTPUT`: diretório privado NOVO de E2.7, para logs/resultados.
- `BW_NFSE_E25_PRIVATE`: diretório privado existente de E2.5, exclusivamente leitura.

Da raiz do checkout, com o executável Node 22:

```text
node node_modules/vitest/vitest.mjs run --config scripts/qa/nfse-national/e27/vitest.config.mjs
node node_modules/typescript/bin/tsc -p scripts/qa/nfse-national/e27/tsconfig.json
node node_modules/eslint/bin/eslint.js "scripts/qa/nfse-national/e27/*.mjs" --max-warnings=0
```

As assertions de rejeição realmente falham. Não transforme o exit code 1 dos
candidatos reprovados em PASS. A engine `sax-e25`, apenas com `security.test.mjs`,
é controle de sensibilidade da suite, não candidato à liberação.

`comparison.test.mjs` reutiliza o adaptador original por mock exclusivo do teste.
Compara os mesmos 26 documentos e resultados completos preservados da E2.5.
Objetos têm hash com chaves ordenadas; arrays conservam ordem. Valores, estados,
originais, evidências e derivações são comparados sem publicar dados fiscais reais.
O corpus privado deve existir; ausência, mudança de hash ou referência causa falha.

`resources.py` requer Python com `psutil` (versão executada registrada no JSON).
Executa workers Node 22 sequenciais com watchdog e heap limitado; a investigação
nativa FXP separa parser de validator/bridge. Não execute benchmarks ao mesmo tempo
que build, lint ou outra carga local.

```text
python scripts/qa/nfse-national/e27/resources.py --node CAMINHO_NODE22 --output DIRETORIO_PRIVADO_E27/resources.json
python scripts/qa/nfse-national/e27/certify.py --private DIRETORIO_PRIVADO_E27 --report docs/analises/nfse-e27-2026-10-11
```

Os scripts de certificação precisam também das evidências de qualidade e do snapshot
inicial privado. Não use caminhos de E2.5 como destino de saída. O relatório registra
BLOCKED quando nenhum candidato mantido passa em todos os gates. Aprovação estrutural
e matching com o baseline não certificam emissão ou precisão fiscal.

As três barreiras corretivas não tornam `sax` um validador XML completo. A suite
é finita; a falha de case sensitivity de entidades permanece explícita. FXP ainda
tem aceitações indevidas e limitação de memória. Não integrar nem substituir parser
sem nova autorização e nova certificação.
