# Solicitação de relatórios Vórtx — piloto na Preview

## Caminho do operador

Administração → Fundos → RLX QA → Integrações → **Solicitar e acompanhar relatórios**.
Rota: `/admin/fundos/[id]/relatorios-vortx`.

1. Escolher a integração publicada e o relatório.
2. Conferir período, data da posição (quando aplicável) e CSV/Excel.
3. Revisar o resumo e confirmar com o autenticador (MFA real).
4. Conferir situação e protocolo no histórico. Atualizar a lista não consulta a Vórtx.

| Nome na tela | Tipo enviado | Funcionalidade exigida |
| --- | --- | --- |
| Estoque em aberto | `PosicaoParcela` | ESTOQUE |
| Estoque consolidado | `PosicaoAtivo` | ESTOQUE |
| Cessões realizadas | `Inclusao` | AQUISICOES |
| Liquidações e exclusões | `Exclusao` | LIQUIDACOES |

Solicitar Inclusão não envia uma cessão. Solicitar Exclusão não baixa títulos.
Não somar os dois níveis de posição. O layout de Exclusão continua sem amostra.
Os parsers CSV/composição previamente preparados permanecem fora deste fluxo.

## Contrato e limites

Fonte: manual fornecido `30099278e0.md` e cliente mTLS existente.
Um login VRS V2 e um `POST /v1/vrs/externo/solicitar` em host fixo por ambiente.
Sem retry, redirect, polling, remessa, download ou importação financeira.
Datas ISO civis, sem futuro, fim posterior ao início. CSV=2; Excel=1.
Para posições, referência explícita; demais tipos usam o fim do período na UI.

O retorno exige UUID, status 0 e data válida, direto ou no envelope `data`.
Aceite HTTP sem protocolo válido é inconclusivo, não sucesso.
**Aguardando arquivo** significa pedido aceito, nunca arquivo recebido/importado.
Falhas de rede/5xx/redirect/contrato inesperado ficam indeterminadas, sem reenvio.
Pedido idêntico já registrado só devolve o registro anterior, mesmo inconclusivo.
Não há botão para contornar deduplicação; nova tentativa exige conferência operacional.

## Persistência e autorização

Migration nova: `20261019180624_vortx_report_requests_preview.sql`.
Aplicada somente na Preview pelo conector Supabase; o arquivo local foi nomeado
com a versão efetivamente registrada pelo provedor, preservando os bytes ensaiados.
SHA-256 local e de `statements[1]` no histórico: `f5313bbbde4adc0fc0022238628ebee05611e0b7412fa6e7dd9967f42e97a3ad`.
Nenhum histórico remoto foi editado para reconciliar nomes/versões antigos.
Tabela `vortx_relatorio_solicitacoes`; reserva única por Fundo/ambiente/versão/hash
do payload canônico. Nonce consumido na mesma transação da reserva e auditoria.
Uma reserva ganha a concorrência; somente seu lease server-only pode registrar
início/conclusão, no mesmo ator e sessão. Segredo de lease e sessão não são lidos
pelo cliente; o DTO também remove hash e ator.

Super Admin + perfil ativo + vínculo ativo no Fundo + MFA canônico/AAL2.
Confirmação TOTP, rate limiting e nonce reutilizam `testar_conexao_vortx_vrs`;
não se alteram os guards globais de Auth, RLS ou envio de remessas.
SELECT com RLS; sem DML autenticado; wrappers públicos invoker chamam funções
privadas definer estreitas, com `search_path` vazio e grants explícitos.
O resolver existente usa a credencial ativa do Fundo/ambiente somente no servidor.
Token, certificado, chave, senha e corpo arbitrário do provedor não são persistidos
na tabela nem retornados ao navegador.

Feature gate temporário, restrito à branch `feature/vortx-real-data-preview`,
`VERCEL_ENV=preview`, projeto Supabase `phdckowbexkkvuwnzeaf`, e ao Fundo
autorizado por `VORTX_REPORTS_PREVIEW_FUNDO_ID` com
`VORTX_REPORTS_PREVIEW_ENABLED=true`.
Não habilitar em homolog/produção. Remover/substituir o gate só em rollout futuro
aprovado; não mudar a proteção global do runtime para testar este piloto.

## Webhook recebido em 19/10/2026 — ainda não habilitado

O usuário forneceu o contrato `WebhookRelatorio` com `idRelatorio`, `idCarteira`,
`tipoRelatorio`, datas de referência/início/fim, `urlRelatorio`, `dataExpiracao`
e `statusRelatorio` (`Em geração`, `Disponível`, `Expirado`).

Pendências antes de qualquer recepção/download:

- como cadastrar a URL de callback e identificar o ambiente;
- autenticação/verificação de origem, assinatura/headers, replay e retries;
- confirmar equivalência `PosicaoAtivo`/`PosicaoParcela` (pedido) versus
  `PosicaoNivelAtivo`/`PosicaoNivelParcela` (webhook);
- confirmar `idRelatorio` como o protocolo do POST;
- contrato dos hosts de download/expiração para download privado seguro.

Nenhuma URL pública de callback foi inventada. Não aceitar payload apenas porque
o UUID da carteira/protocolo coincide. Não armazenar link pré-assinado em logs
ou devolvê-lo irrestritamente ao navegador. Sem callback autenticado não se pode
certificar arquivo disponível, importação, reconciliação ou dados reais de estoque.

## Verificação reproduzível

- `node scripts/qa/vortx/reports-sql-rehearsal.mjs`: duas stacks Postgres Docker
  novas, porta aleatória publicada somente em `127.0.0.1`, credenciais sintéticas,
  limpeza própria e preservação de recursos anteriores. Usa cópias exatas dos
  cinco helpers canônicos exportados somente leitura da Preview, com hashes.
  Baseline mínimo de dependências; **não substitui Auth/TOTP E2E**.
- `node scripts/qa/vortx/reports-browser.mjs`: componente real, navegador local,
  respostas sintéticas, rede externa bloqueada; desktop/mobile, estados vazios,
  capacidades, datas, resumo, clique duplo e atualização sem novo POST.
- Vitest: contrato, HTTP, isolamento do piloto, DTO, contexto e orquestração.
- TypeScript, lint, build e CI da aplicação completam o gate técnico.

Os relatórios gerados ficam em `%LOCALAPPDATA%/bw-antecipa-evidence/vortx-reports-preview-20261019`.
Execução real contra a Vórtx ainda exige smoke do operador autenticado na Preview.
Essa chamada externa não faz parte dos testes sintéticos nem é disparada ao abrir a tela.
