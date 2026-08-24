# Manual de Integração — Envio de Comprovante de Entrega

## 1. Endpoint

**Método:** `POST`

**Endpoint:** `/api/integracoes/transportadoras/{provider}/comprovantes-entrega`

A URL completa será fornecida pelo BW Antecipa.

## 2. Autenticação

Headers obrigatórios:

```http
Authorization: Bearer <TOKEN>
Content-Type: application/json
```

O token será fornecido pelo BW Antecipa e não deve ser enviado na querystring. Em caso de rotação ou revogação, o token antigo deixa de funcionar.

## 3. Payload

```json
{
  "external_event_id": "ID-UNICO-DO-EVENTO",
  "chave_cte": "44_DIGITOS_OPCIONAL",
  "chave_nfe": "44_DIGITOS",
  "cnpj_cliente": "14_DIGITOS",
  "content_type": "image/jpeg",
  "data_emissao_nfe": "2026-08-24T10:00:00-03:00",
  "cnpj_emitente": "14_DIGITOS",
  "data_entrega_nfe": "2026-08-24T14:30:00-03:00",
  "cnpj_transportadora": "14_DIGITOS",
  "imagem_base64": "BASE64_DO_COMPROVANTE"
}
```

| Campo | Descrição |
|---|---|
| `external_event_id` | Identificador único do evento; recomendado. |
| `chave_cte` | Chave de 44 dígitos; opcional. |
| `chave_nfe` | Chave da NF-e de venda ou da NF-e de remessa; obrigatória. |
| `cnpj_cliente` | CNPJ do destinatário/cliente. |
| `content_type` | `image/jpeg`, `image/png` ou `application/pdf`. |
| `data_emissao_nfe` | Data e hora no padrão ISO-8601. |
| `cnpj_emitente` | CNPJ do emitente da NF informada. |
| `data_entrega_nfe` | Data e hora da entrega no padrão ISO-8601. |
| `cnpj_transportadora` | CNPJ da transportadora. |
| `imagem_base64` | Arquivo completo convertido para Base64. |

## 4. Regras importantes

> - Envie a chave da NF-e exatamente com 44 dígitos.
> - Para operação com NF de Remessa, pode ser enviada a chave da NF de Remessa.
> - O comprovante deve ser JPEG, PNG ou PDF.
> - O limite do arquivo decodificado é 15 MB.
> - Não reutilize o mesmo `external_event_id` para eventos diferentes.
> - Em caso de timeout ou HTTP `503`, reenvie exatamente o mesmo evento.
> - O BW Antecipa trata o reenvio de forma idempotente e não duplica o comprovante.

## 5. Respostas

| HTTP | Significado |
|---|---|
| `200` | Evento recebido/processado ou registrado para análise. |
| `400` | Payload inválido. |
| `401` | Token inválido, expirado/revogado ou provider incorreto. |
| `413` | Payload ou arquivo acima do limite. |
| `422` | Erro definitivo no conteúdo. |
| `503` | Erro temporário; reenvie o mesmo evento. |

O JSON de resposta contém `success`, `status`, `webhook_evento_id`, `canhoto_id` e `detalhe`.

## 6. Exemplo de resposta

```json
{
  "success": true,
  "status": "PROCESSADO",
  "webhook_evento_id": "uuid",
  "canhoto_id": "uuid",
  "detalhe": "Comprovante recebido com sucesso"
}
```

## 7. Orientação final

Em caso de dúvida sobre endpoint, token ou provider, contate o responsável técnico do BW Antecipa.
