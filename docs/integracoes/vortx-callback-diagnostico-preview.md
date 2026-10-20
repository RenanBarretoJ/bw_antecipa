# Captura temporária do JSON rejeitado — Preview Vórtx

Esta captura diagnostica os HTTP 400 sem mudar o contrato de recebimento.
Não baixa relatórios, não importa estoque e não confirma aceite de solicitações.

## Ativação e limites

- Desligada por padrão. Exige todos os gates existentes da Preview e
  `VORTX_REPORT_CALLBACK_CAPTURE_UNTIL` em ISO UTC, no futuro e a no máximo 24h.
- Publicar somente na branch `feature/vortx-real-data-preview`, após ensaio SQL.
  Não aplicar a migration de estoque nativo nem replay de migrations.
- Somente callbacks autenticados, depois do rate limit e da checagem de Fundo.
- JSON malformado ou incompatível com o schema: corpo UTF-8 de até 16 KiB.
- Não captura 401/403/413/415/429 nem corpos de outra carteira identificável.
  Uma carteira ausente/ilegível permanece apenas em quarentena diagnóstica,
  associada ao endpoint autenticado; nunca comprova pertencimento do relatório.
- Máximo de 20 corpos distintos por endpoint, inclusive os ainda não limpos.
  Repetições não ampliam armazenamento. Revisão entra na identidade da amostra.

## Persistência e segurança

`private.vortx_callback_diagnosticos` tem RLS, sem grants diretos para anon,
authenticated ou service_role, sem leitura via UI/Data API. A RPC de escrita
é exclusiva do worker já utilizado pelo receptor e revalida segredo, revisão,
endpoint ativo, Fundo e integração. Não altera funções ou grants anteriores.

Somente o corpo é criptografado com o keyring existente, junto do contexto.
Request, URL do callback e headers não são capturados. O token atual é removido
se aparecer literalmente no corpo. A URL assinada do relatório pode constar
no corpo, mas apenas dentro do ciphertext. Não há fallback em texto puro.

O registro não substitui `vortx_relatorio_eventos`. A resposta continua 400,
mesmo se a captura falhar. Logs contêm somente falha genérica, nunca o corpo.
O sucesso da captura exige conferência da linha privada, não apenas do log 400.
As chamadas anteriores à publicação não podem ser recuperadas por este ajuste.

## Expiração e encerramento

Cada amostra tem `expira_em = recebido_em + 24h`. Não existe cron de limpeza
automática neste ajuste: o operador deve executar, com tooling interno
autorizado, `vortx_limpar_callback_diagnosticos_expirados()` após a expiração.
Essa RPC remove somente diagnósticos vencidos, nunca eventos válidos.
A janela de captura expira automaticamente; retirar também a variável ao fechar
o diagnóstico. Não declarar exclusão física realizada apenas por expirar o prazo.

Para analisar uma amostra, utilizar acesso administrativo explicitamente
autorizado, conferir contexto e descriptografar de forma privada. Nunca
imprimir ciphertext/keyring, copiar corpos reais para Git ou expor links
assinados em relatórios de diagnóstico.

## Validação reproduzível

```powershell
npx vitest run src/lib/integracoes/vortx
npx tsc --noEmit
node scripts/qa/vortx/callback-sql-rehearsal.mjs
```

O ensaio SQL cria duas stacks descartáveis com credenciais sintéticas, testa
permissões usando roles não-owner, preserva recursos Docker anteriores e
registra hashes de migrations, resultados e limpeza fora do repositório.
Esse ensaio não comprova callback real da Vórtx nem implantação na Preview.
