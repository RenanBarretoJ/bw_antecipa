# Vortx Preview: transporte de solicitacao de relatorios

## Correcao

O login VRS usava `postJsonMtls`, mas o POST de relatorios usava `fetch`
sem certificado cliente. A action agora passa ao POST o mesmo certificado e
chave do contexto de Fundo/ambiente validado para o login. Nao existe fallback
sem mTLS. Os endpoints e o contrato do pedido/protocolo nao mudaram.

Arquivos de implementacao:

- `src/app/admin/fundos/relatorios-vortx-actions.ts`
- `src/lib/integracoes/vortx/relatorios-http.server.ts`
- `src/lib/integracoes/vortx/mtls-http-client.server.ts`

## Controles preservados

- Autorizacao, MFA, nonce transacional, reserva e escopo de Fundo/versao.
- Um POST por nova reserva; sem retry, redirect ou limpeza de idempotencia.
- Host e caminho fixos; verificacao TLS do servidor ativa.
- Bearer e certificado cliente utilizados juntos na solicitacao.
- Prazo total de 20 segundos e corpo de resposta limitado a 64 KiB.
- Resposta truncada, excesso de tamanho e protocolo invalido nao sao sucesso.
- Recusas HTTP explicitas continuam recusas; falha de transporte/5xx/redirect
  continuam indeterminados. O HTTP e preservado se os headers chegaram.
- Log `vortx_report_transport` contem somente estado, HTTP, etapa, categoria,
  codigo allowlisted e duracao. Sem erro bruto, URL, corpo ou credenciais.
- Nenhum download, importacao de estoque ou envio de remessa e adicionado.

## Regressao reproduzivel

`npx vitest run src/lib/integracoes/vortx/mtls-http-client.server.test.ts src/lib/integracoes/vortx/mtls-http-client.integration.test.ts src/lib/integracoes/vortx/relatorios-http.server.test.ts src/lib/integracoes/vortx/vortx-vrs-client.server.test.ts src/app/admin/fundos/relatorios-vortx-actions.test.ts`

A prova funcional gera CA, certificado servidor e cliente sinteticos com
OpenSSL 3, em diretorio temporario exclusivo. O servidor escuta somente
`127.0.0.1`. Exige certificado cliente confiavel e comprova certificado +
Bearer + corpo em um unico POST. Os controles negativos negam ausencia de
certificado cliente e servidor nao confiavel, sem HTTP recebido. As chaves,
conexoes e o diretorio criados pelo teste sao removidos ao final.

Esses testes nao chamam a Vortx e nao comprovam a aceitacao hosted.

## Smoke depois da publicacao somente na Preview

1. Operador abre a tela de relatorios do Fundo RLX e escolhe um pedido novo,
   nao identico a uma reserva indeterminada anterior, com datas validas.
2. Confirma uma unica vez via MFA. Nao repetir automaticamente em caso de erro.
3. Conferir estado, HTTP e protocolo no historico e diagnostico sanitizado.
4. Aguardar callback autenticado e conferir evento/captura privada, sem
   divulgar URL assinada ou segredo. Protocolo aceito nao significa arquivo
   disponivel, importado ou reconciliado.

A URL de callback e seu segredo nao mudam por esta correcao. Nao e necessario
recadastrar o destino na Vortx. Nao ha migration nem alteracao de env.
Producao e homolog ficam fora deste rollout.
