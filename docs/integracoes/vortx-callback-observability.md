# Vortx Preview: diagnostico sanitizado do recebimento

O evento de log `vortx_callback_receipt` mantem `status` e `durationMs` e passa
a incluir o diagnostico terminal do handler. Nao altera o contrato HTTP,
autenticacao, limite, isolamento de Fundo/carteira, persistencia ou captura.
O endpoint continua restrito a Preview explicitamente autorizada.

## Campos permitidos

- `metodo`: `POST` ou `OUTRO`; nenhum metodo arbitrario e reproduzido.
- `tipoConteudo`: `JSON`, `AUSENTE` ou `OUTRO`; nao e o header bruto.
- `endpointQuantidade`, `tokenQuantidade`: 0, 1 ou 2 (2 significa dois ou mais).
- `endpointFormatoValido`, `tokenFormatoValido`: booleanos; `null` se nao avaliados.
- `autorizacao`: nao executada, negada, autorizada, Fundo divergente, limite ou falha.
- `etapa`, `motivo`: enums controlados que identificam a rejeicao ou o commit.

Nao registrar valores de parametros, nomes arbitrarios de query/headers,
URLs, IDs, token/hash, corpo, ciphertext ou mensagens de excecao.
O identificador de request da plataforma permite localizar a chamada sem
adicionar identificadores fornecidos pelo remetente ao log da aplicacao.

## Interpretacao

- `PARAMETROS/ENDPOINT_AUSENTE`: a query nao trouxe o campo `endpoint`.
- `PARAMETROS/TOKEN_AUSENTE`: a query nao trouxe o campo `token`.
- Motivos `*_DUPLICADO` e `*_FORMATO_INVALIDO`: a validacao local rejeitou
  antes de consultar a autorizacao no banco. O retorno continua 401.
- `AUTORIZACAO/AUTORIZACAO_NEGADA`: formato valido, mas a autorizacao recusou.
  Nao atribuir isso especificamente a token errado: endpoint inexistente,
  revogado ou contexto inativo tambem sao recusados pelo contrato existente.
- `AUTORIZACAO/FUNDO_DIVERGENTE`: o binding autorizado nao pertence ao Fundo permitido.
- `AUTORIZACAO/LIMITE_ATINGIDO`: 429; `Retry-After` preservado.
- `HEADERS`, `CORPO` e `CONTRATO`: rejeicao posterior a autenticacao valida.
- `PERSISTENCIA/RECEBIDO`: 200 somente apos a confirmacao duravel.
- `ROTA/FALHA_INESPERADA`: falha antes de obter diagnostico terminal; 503,
  sem mensagem bruta de erro.

Formato valido de token nao comprova autenticacao. Um POST rejeitado nao
comprova identidade Vortx nem correlacao com um protocolo externo.
O JSON rejeitado so pode ser capturado apos autenticacao, dentro da janela
temporaria e demais gates ja existentes; nao ha captura de corpo nao autenticado.

## Operacao

Sem migration, nova env, nova URL ou rotacao. Nao reenviar relatorios
automaticamente para exercitar o log. Primeiro validar um POST sintetico
sem token: deve permanecer 401, sem corpo lido, consulta de autorizacao ou
escrita financeira. Nao usar o segredo real nesse smoke.

Testes: `relatorios-callback-observability.test.ts`, os testes existentes de
callback/captura e `src/app/api/integracoes/vortx/relatorios/callback/route.test.ts`.
Uma falha do observer nao muda o resultado do handler. Nenhum payload antigo
e reconstruido retroativamente por esta instrumentacao.
