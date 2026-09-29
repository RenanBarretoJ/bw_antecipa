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
