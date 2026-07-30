# Padrão de notificações do BW Antecipa

O BW Antecipa utiliza um sistema global de notificações temporárias para feedback operacional de sucesso, erro, aviso e informação.

## Objetivo

Mensagens como operação criada, documento enviado, política publicada, CNAB gerado, integração salva ou credencial criada devem aparecer como toast no canto superior direito. Isso evita banners fixos no topo de páginas longas, onde o usuário pode estar trabalhando no meio ou no fim da tela.

## Componentes

- `src/components/notifications/notification-provider.tsx`
  - Provider global.
  - Hook `useNotifications()`.
  - Viewport fixo no canto superior direito.
  - Acessibilidade com `aria-live`, `role="status"` e `role="alert"` para erros.
  - Botão de fechar.
  - Expansão opcional de detalhes técnicos.

- `src/lib/notifications.ts`
  - Tipos compartilhados.
  - Duração padrão por tipo.
  - Conversão de retorno de Server Action para notificação.
  - Regra simples de agrupamento/deduplicação.

## Uso recomendado no frontend

```tsx
const notifications = useNotifications()

notifications.success('Documento enviado.')
notifications.error('Não foi possível gerar o CNAB.', {
  details: 'Mensagem técnica opcional.',
})
notifications.warning('Existem pendências documentais.')
notifications.info('Processamento iniciado.')
```

Para Server Actions:

```tsx
const result = await salvarAlgo(input)
notifications.fromActionResult(result, 'Não foi possível salvar.')
```

## Contrato recomendado para Server Actions

As actions devem retornar, no mínimo:

```ts
{
  success: boolean
  message: string
}
```

Quando houver detalhes técnicos opcionais:

```ts
{
  success: false,
  message: 'Não foi possível gerar o CNAB.',
  notification: {
    type: 'error',
    message: 'Não foi possível gerar o CNAB.',
    details: 'Detalhe técnico sem stacktrace exposto diretamente.'
  }
}
```

## O que deve usar toast

- Resultado de ações operacionais.
- Salvar, publicar, aprovar, reprovar, enviar, baixar, gerar, revogar, rotacionar, testar conexão.
- Erros de processamento não associados a um campo específico.

## O que não deve ser substituído por toast

- Validação de formulário junto ao campo.
- Estados vazios estruturais.
- Alertas permanentes que explicam uma condição da página.
- Confirmações críticas que exigem decisão antes de continuar.

## Duração padrão

- `success`: 3 segundos.
- `info`: 4 segundos.
- `warning`: 6 segundos.
- `error`: 10 segundos e botão de fechar.

## Agrupamento

O provider limita a pilha a 4 notificações. Mensagens repetidas com o mesmo tipo e texto, ou com o mesmo `dedupeKey`, são agrupadas e exibem contador.

## Regra de UX

Não criar banners locais para feedback operacional novo. Se uma tela precisar exibir resultado de uma ação, use `useNotifications()` ou `fromActionResult()`.
