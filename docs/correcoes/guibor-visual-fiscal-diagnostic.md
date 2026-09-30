# GUIBOR — diagnóstico fiscal visual seguro

Continuação autorizada do bloqueio `NFSE_VISUAL_FISCAL_CONFLICT` no PDF B.
O primeiro delta acrescenta somente diagnóstico por campos/motivos enumerados,
sem mudar validações, prompt, modelo, cálculos, autenticação ou persistência.

`visual-diagnostics.ts` guarda apenas identificadores estáticos e os filtra
novamente na fronteira de log. Não retém payload, valores fiscais, documento,
resposta do provedor ou `cause`. O cliente continua recebendo mensagem de domínio.

Validação local inicial (Node 22.23.3): 90 testes NFS-e PASS, TypeScript PASS,
lint dos arquivos alterados PASS, diff check PASS. Os nove novos testes cobrem
motivos específicos e descarte de valores/propriedades não autorizados.

Próximo passo: CI e execução única do PDF B no Preview isolado, para identificar
o campo antes de corrigir. Não se considera o fluxo real aprovado neste ponto.
Nenhuma promoção para homolog/produção, migration ou alteração de segredo.

As skills OpenAI Docs e Supabase orientam a separação entre schema e validação
de domínio, uso do runtime seguro e QA autenticado com cleanup exato. Referência:
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Evidência remota do diagnóstico

- Commit: `96d988c05a5b098ce91e94d08a33bbaed098b19b`.
- CI PASS: https://github.com/RenanBarretoJ/bw_antecipa/actions/runs/36603804195 .
- Preview Ready: https://bw-antecipa-8oo433d19-renanbarretoj.vercel.app .
- PDF B real, Auth/MFA AAL2, alvo isolado `prnudoydwiramsxjnxzn` confirmado pelo CSP.
- Rejeição reproduzida uma vez: `NFSE_VISUAL_FISCAL_CONFLICT`, motivo
  `nfse_chave_acesso_invalid`. Não se obteve nem registrou a resposta bruta.
- Sem NF, operação ou objeto de Storage criado. Cleanup dos quatro usuários,
  cedente/fundo/organização/vínculos QA: PASS, zero resíduos verificados.
- Suíte local completa: 2.453 PASS / 12 skipped; 284 arquivos PASS / 3 skipped.

## Correção fundamentada da transcrição da chave

O diagnóstico isolou o campo da chave, mas não identifica qual caractere ou
comprimento foi retornado. Não se afirma perda de zeros como fato observado.
Leitura local independente do QR Code do PDF B (render 4x + jsQR 1.4.0, somente
em pasta ignorada) encontrou parâmetro `chave` numérico de 50 caracteres no
endereço de consulta nacional. Nenhuma URL foi acessada, chave impressa em log,
resposta do provedor exportada ou valor fiscal alterado. Isso não autentica a NF.

Mantida a validação fiscal local de 50 dígitos. A correção limita também o schema
do provedor a string de 50 dígitos ou null e explicita no prompt a preservação
de zeros, leitura em blocos e comparação com a repetição impressa do mesmo
documento. Proíbe completar/cortar/reconstruir dígitos; leitura incerta deve
retornar null e ambiguous=true. Modelo, timeout, token budget e demais campos
não mudaram. Não se incluiu QR decoder nem dependência nova na aplicação.

Referência do formato: [DANFSe, especificação técnica, seção 2.1.1](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nt-008-se-cgnfse-danfse-20260505.pdf).
Referência de prompting consultada: [GPT-5.4, validação explícita e saída estruturada](https://developers.openai.com/api/docs/guides/latest-model?model=gpt-5.4).

Cinco novos testes verificam o schema enviado, prompt sem reparo inferido,
preservação exata de sequência longa de zeros sintéticos e rejeição local de
44/49/51 dígitos. Total focado: 95 PASS. O smoke real da correção ainda deve
ser executado após CI. Não declarar homolog pronta nem importação B concluída.

## Resultado da correção — Preview autenticado

Código certificado: `e0a0a0435a88854dd31a36444a655b7894a5326c`, publicado na
branch GUIBOR, PR #71 permanece draft. CI remoto (Node 22): PASS, incluindo
TypeScript, testes, lint e build:
https://github.com/RenanBarretoJ/bw_antecipa/actions/runs/36604917485 .

Preview Ready: https://bw-antecipa-ozdarspsi-renanbarretoj.vercel.app .
Deployment `dpl_E2bw8VN3VyLJw7ehV8SumCAkpBTX`, alvo Supabase
`prnudoydwiramsxjnxzn` validado novamente pelo CSP nos dois testes.

Cada PDF foi submetido uma vez no código corrigido, por usuário QA autenticado
com senha/MFA AAL2, via browser e action reais. Não houve repetição para escolher
uma resposta favorável. Inspeção visual dos screenshots confirma:

| Verificação | PDF A | PDF B |
| --- | --- | --- |
| Número | 49 | 232 |
| Bruto fiscal | 39.521,98 | 112.710,81 |
| Líquido fiscal | 37.229,70 | 105.779,10 |
| Estado | REQUIRES_REVIEW | REQUIRES_REVIEW |
| Vencimento | vazio e obrigatório | vazio e obrigatório |
| NFs antes/depois | 0 / 0 | 0 / 0 |
| Storage antes/depois | 0 / 0 | 0 / 0 |

Os logs do deployment foram lidos somente em memória e comparados contra os
hashes conhecidos das estratégias. Confirmados `danfse_v2_labels` /
`pdf_text_native` no A e `danfse_v2_visual` / `pdf_ai_fallback` no B. Não houve
código `NFSE_VISUAL_*` de falha nesta rodada. Isso certifica a chegada à revisão,
não autenticidade fiscal da chave nem conclusão da persistência.

Testes locais finais: 95 focados PASS; suíte completa 2.458 PASS / 12 skipped,
284 arquivos PASS / 3 skipped. TypeScript, lint focado e diff check PASS;
lint completo e build certificados no CI acima.

Cleanup final: PASS, removidos somente oito usuários QA, dois cedentes, dois
fundos e suas organizações/políticas/vínculos identificados pelos manifestos.
Sign-out antes da remoção Auth; zero resíduos verificados de usuários, cedentes,
fundos, MFA, sessões e auditoria QA. NFs e operações continuaram em zero;
nenhum objeto Storage removido. As fixtures são recriáveis pelos scripts;
credenciais das identidades removidas não foram mantidas.

Evidências locais ignoradas (nenhum PDF real versionado):

- `rehearsal/reports/GUIBOR_DIAG_B.json`
- `rehearsal/reports/GUIBOR_DIAG_CLEANUP.json`
- `rehearsal/reports/GUIBOR_FISCAL_FIX_A.json`
- `rehearsal/reports/GUIBOR_FISCAL_FIX_B.json`
- `rehearsal/reports/GUIBOR_FISCAL_FIX_A_REVIEW.png`
- `rehearsal/reports/GUIBOR_FISCAL_FIX_B_REVIEW.png`
- `rehearsal/reports/GUIBOR_FISCAL_FIX_CLEANUP.json`

```text
GUIBOR_VISUAL_FISCAL_DIAGNOSTIC = PASS
GUIBOR_VISUAL_KEY_TRANSCRIPTION_PREVIEW = PASS
GUIBOR_NFSE_FILE_A_REAL_REVIEW = PASS
GUIBOR_NFSE_FILE_B_REAL_REVIEW = PASS
GUIBOR_NO_PREMATURE_PERSISTENCE = PASS
GUIBOR_VISUAL_FIX_CI = PASS
GUIBOR_VISUAL_FIX_CLEANUP = PASS
GUIBOR_A3_A4_HOMOLOG_READY = NO
GUIBOR_PRODUCTION_CHANGED = NO
P17_CHANGED = NO
RLX_VORTX_CHANGED = NO
CERC_CHANGED = NO
RLX_EMAIL_CHANGED = NO
```

Pendentes do R2 maior: preencher vencimento e certificar reextração/persistência/
audit reais, duplicidade, integridade Storage, matriz RLS remota e promoção/smokes
em homolog. Não executados nem declarados PASS nesta correção pequena. Nenhuma
migration, variável, segredo, flag ou política financeira foi alterada.
