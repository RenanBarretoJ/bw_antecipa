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
