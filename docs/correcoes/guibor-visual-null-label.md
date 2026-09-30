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
- CI remoto (Node 22): PASS, incluindo TypeScript, suíte completa, lint e build.
  https://github.com/RenanBarretoJ/bw_antecipa/actions/runs/36601545154

Os novos casos cobrem campos opcionais vazios, ausência de proveniência, campos
obrigatórios ausentes, rótulos conflitantes mesmo com valor nulo, líquido ausente
sem fallback e revisão de vencimento após o retorno visual.

Homolog e produção não serão promovidos como parte desta correção isolada.
Os demais gates R2 continuam pendentes até execução própria e evidência real.

## Publicação e smoke real — novo STOP

Commit publicado: `0470e8e495027d052a6f51bfa4515027ea831766`, na branch
`feature/guibor-nfse-base-valor-comissao`, PR #71 ainda draft.
Preview pronto: https://bw-antecipa-jhomgfg3o-renanbarretoj.vercel.app .
Supabase isolado: `prnudoydwiramsxjnxzn`. Nenhuma variável/credencial foi alterada
nesta rodada; nenhuma migration foi executada.

O PDF B real `232- HOSPITAL VIDA.pdf` foi enviado por um cedente QA com login
real e MFA/AAL2. O CSP da aplicação confirmou o banco Preview correto.
O erro de rótulo sem valor não voltou nesse teste; a resposta alcançou a
validação fiscal posterior, que a rejeitou com **`NFSE_VISUAL_FISCAL_CONFLICT`**.
A tela retornou falha segura, zero importados, sem formulário de revisão.

Essa condição agrupa falha no gate de extração (campos críticos/formato/confiança/
consistência), competência ausente ou líquido inválido. A telemetria atual não
identifica qual campo/motivo específico disparou a rejeição. Portanto, não se
afirma que a extração dos valores ou a importação do B estejam corrigidas.
Nenhum valor foi inferido ou validador fiscal relaxado para forçar o PASS.

Aplicado o STOP obrigatório após a falha real. Não houve nova tentativa para
selecionar apenas um resultado favorável, promoção para homolog, nem repetição
do A nesta rodada. A evidência anterior do A continua histórica, não um novo PASS.
Próximo escopo necessário: diagnóstico estruturado por identificadores de campos
e motivos permitidos (sem conteúdo fiscal, documento ou resposta bruta do provedor),
identificação da divergência e nova correção fundamentada.

Evidências locais ignoradas:

- `rehearsal/reports/GUIBOR_NULL_FIX_B.json`
- `rehearsal/reports/GUIBOR_NULL_FIX_B_UI_ERROR.txt`
- `rehearsal/reports/GUIBOR_NULL_FIX_B_ERROR.png`
- `rehearsal/reports/GUIBOR_NULL_FIX_CLEANUP.json`

## Resultado do escopo

Cleanup QA: PASS. Removidos somente quatro usuários, um cedente, um fundo e a
consultoria/políticas/vínculos do manifesto desta rodada. Sign-out realizado
antes da exclusão Auth. Verificação posterior: zero resíduos desses alvos,
sessões, MFA e auditoria QA. NFs, operações e Storage permaneceram em zero;
nenhum arquivo precisou ser removido. Fixtures são recriáveis pelos scripts;
identidades/senhas removidas não são mantidas. A revisão final deste relatório
está local, posterior ao commit de código certificado acima.

```text
GUIBOR_VISUAL_NULL_LABEL_FIX = PASS
GUIBOR_VISUAL_NULL_LABEL_UNIT_REGRESSION = PASS
GUIBOR_VISUAL_NULL_LABEL_FULL_TESTS = PASS
GUIBOR_VISUAL_NULL_LABEL_CI = PASS
GUIBOR_VISUAL_NULL_LABEL_PREVIEW = PASS
GUIBOR_NFSE_FILE_B_REAL = FAIL
GUIBOR_A3_A4_HOMOLOG_READY = NO
GUIBOR_PRODUCTION_CHANGED = NO
P17_CHANGED = NO
RLX_VORTX_CHANGED = NO
CERC_CHANGED = NO
RLX_EMAIL_CHANGED = NO
```

O PASS da correção identifica o comportamento pontual coberto pelos testes,
não a conclusão da importação real. Os demais gates funcionais do R2 não foram
executados após esse STOP.
