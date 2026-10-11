# PoC E2.8 — referências XML

Uso exclusivo em desenvolvimento. O dispatcher não importa estes módulos.
`sax-tree.mjs` compõe a validação nova com o bridge E2.7 congelado; nenhuma biblioteca
ou mapeamento fiscal foi copiado ou substituído. Dependências: `sax@1.6.1` e tipos
fixados em `../e27/package-lock.json`, ferramentas do projeto, Node 22.x, Python e
`psutil`. Nenhum `npm install` foi necessário nesta etapa.

## Reprodução

Execute do diretório raiz, utilizando o executável Node 22 explicitamente. Os caminhos
privados precisam ser diretórios autorizados; não grave saídas canônicas públicas no Git.
O corpus E2.5 original deve existir e passar na verificação de hashes. Não substitua
documentos ausentes por sintéticos.

1. Leia as regras do repositório e `docs/development/nfse-national-certification.txt`.
   Trabalhe exclusivamente na branch de desenvolvimento aprovada, descendente de
   `364c5ad2`. O snapshot histórico E2.8 e seu helper permanecem privados: não
   execute esse helper na branch `homolog` nem o repita para gerar evidência nova.
   Antes de novos ensaios, crie um diretório privado novo e preserve os hashes atuais.
2. Configure `BW_NFSE_E28_OUTPUT` para o diretório privado E2.8,
   `BW_NFSE_E25_PRIVATE` para o corpus privado E2.5 e `BW_NFSE_E28_PARSER` como
   `saxes` e depois `sax`. Execute com Node 22:
   `node_modules/vitest/vitest.mjs run --config scripts/qa/nfse-national/e28/vitest.config.mjs`.
   São 536 testes por engine. O JSON detalhado é escrito no diretório privado configurado.
3. Execute `node22 --import tsx scripts/qa/nfse-national/e28/reproduction.mjs <private>/reproduction.json`.
   O probe testa a biblioteca nativa configurada e os três bridges, registrando o hash do vendor.
4. Execute `python scripts/qa/nfse-national/e28/resources.py --node <node22> --output <private>/resources.json`
   **sem testes, build, lint ou outro benchmark concorrente**. O watchdog mantém os
   budgets anteriores e mata subprocessos que excedem CPU, RSS ou tempo.
5. Execute `python scripts/qa/nfse-national/e28/verify.py --node <node22> --output <private> --lf-checkout <checkout-lf>`.
   O controle `sax-e27` deve falhar nos cenários antes da correção; os outros checks devem passar.
   O checkout LF é o previamente preservado, no mesmo commit; não altere migrations para executar a suíte.
6. Execute `python scripts/qa/nfse-national/e28/certify.py --private <private>`.
   O relatório e a classificação são derivados das observações, hashes e checks.

## Limites da conclusão

O resultado certifica apenas o corpus e os cenários executados. Não comprova emissão,
assinatura, situação fiscal, precisão fiscal universal nem equivalência XML universal.
O candidato é a composição SAX + guardas E2.7/E2.8. O SAX nativo permanece inadequado
para substituição direta. Não há liberação de produção nem de integração operacional.
