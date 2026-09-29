# GUIBOR — rótulo impresso sem valor no contrato visual

## Escopo e causa

Continuação autorizada após o STOP do R2 em `NFSE_VISUAL_LABEL_WITHOUT_VALUE`.
O validador rejeitava um campo com `value=null` e rótulo não nulo, embora um
formulário possa conter o título impresso com a célula de valor vazia.
O erro do smoke anterior não identifica qual campo específico estava vazio.

## Correção

`src/lib/nfse/visual-contract.ts` agora valida o rótulo contra a lista exata de
rótulos admitidos antes de tratar o valor ausente. Um rótulo reconhecido com
`value=null` não entra no texto canônico, não consome valores vizinhos e não
produz proveniência ou confiança de um fato inexistente. O objeto recebido não
é modificado. Campos obrigatórios ausentes continuam reprovados pelo gate fiscal.

Não há cálculo/inferência de líquido ou vencimento, cópia do bruto, mudança no
modelo/provedor, credenciais, prompt, schema JSON, parser NF-e/XML, migrations,
RLS, histórico, política financeira ou dados de produção.

Referência consultada com a skill OpenAI Docs: a saída estruturada permite
valores opcionais via `null`, mas o domínio precisa validar o conteúdo retornado.
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
A skill Supabase orienta o smoke com Auth/MFA real, segregação de ambiente,
sign-out e cleanup QA exato, sem expor credenciais.

## Testes locais (Node 22.23.3)

- Reprodução antes da correção: 21 novos casos falharam no validador antigo.
- Após correção: 103 testes focados aprovados, incluindo os 21 novos casos.
- Suíte completa: 2.444 testes aprovados; 12 ignorados, em 283 arquivos aprovados
  e três ignorados.
- TypeScript: PASS.
- Lint: PASS, zero erros; um aviso preexistente em `src/lib/actions/liquidacao.ts`
  (`notificarGestores` não utilizado).
- `git diff --check`: PASS.
- Build/CI e repetição do PDF B real: em andamento; não certificados ainda.

Os novos casos cobrem campos opcionais vazios, ausência de proveniência, campos
obrigatórios ausentes, rótulos conflitantes mesmo com valor nulo, líquido ausente
sem fallback e revisão de vencimento após o retorno visual.

Homolog e produção não serão promovidos como parte desta correção isolada.
Os demais gates R2 continuam pendentes até execução própria e evidência real.
