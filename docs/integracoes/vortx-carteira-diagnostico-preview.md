# Diagnostico temporario: token VRS na Carteira JSON

Escopo autorizado em 19/10/2026: verificar, sem presumir compatibilidade, se o
token retornado pelo login VRS V2 e aceito pela API de Carteira JSON.
Nao e um conector financeiro nem uma certificacao das bases.

## Acesso e execucao

Pagina: `/admin/fundos/[id]/diagnostico-carteira-vrs`.

- Super Admin, sessao MFA valida e nova confirmacao TOTP.
- Reutiliza a acao sensivel `testar_conexao_vortx_vrs`, com o rate limit,
  autorizacao curta e consumo de nonce existentes; nenhuma migration.
- O Fundo ativo e seu CNPJ sao consultados no servidor com o cliente autenticado.
- A credencial ativa e resolvida pelo mecanismo server-side existente, sem
  exportar a chave de criptografia ou as credenciais da Preview.
- Um login em `https://api.vortx.com.br/v2/auth/login`; depois um unico GET em
  `https://apis.vortx.com.br/carteira-liberada/buscarCarteiraJSON`, com
  `cnpjFundos[]` do cadastro e `dataCarteira` explicitamente escolhida.
- Apenas o access token VRS e enviado no Bearer da Carteira. Key/Secret,
  certificado e chave privada nao sao enviados a esse segundo host.
- Sem retries, refresh token, redirects, importacao financeira ou remessas.

## Restricao temporaria de ambiente

O gate e reavaliado na pagina e na action. Exige simultaneamente:

- `VERCEL_ENV=preview`;
- branch `feature/vortx-real-data-preview`;
- `NEXT_PUBLIC_SUPABASE_URL=https://phdckowbexkkvuwnzeaf.supabase.co`;
- `VORTX_CARTEIRA_DIAGNOSTIC_ENABLED=true`;
- Fundo igual a `VORTX_CARTEIRA_DIAGNOSTIC_FUNDO_ID` nao vazio.

Essas duas variaveis de diagnostico devem existir somente na branch Preview.
Os identificadores de ambiente sao deliberadamente fixos por se tratar de uma
excecao operacional limitada, nao de uma regra por nome/CNPJ de Fundo.

TODO apos o ensaio: desligar a flag e remover esta pagina/action e seus modulos
de diagnostico em mudanca especifica, preservando as evidencias.

## Resultados e limites

- Exibe status HTTP, endpoint sem token, data, horario e JSON sanitizado.
- Limite de recebimento: 256 KiB; exibicao: 64 Ki caracteres com aviso de corte.
- Omite respostas nao JSON; remove campos sensiveis e ecos dos segredos conhecidos.
- Em HTTP 2xx, exige o formato documentado e CNPJ do Fundo solicitado em todas
  as carteiras antes de devolver dados financeiros. Array vazio e exibido como
  vazio, sem inventar disponibilidade ou conciliacao.
- HTTP 401/403 e evidencia de rejeicao da consulta, nao prova de senha VRS errada.
- Erros de rede, resposta excessiva ou escopo inesperado nao recebem PASS.
- Auditoria usa `CREDENCIAL_USADA` nas duas etapas, com contexto
  `diagnostico=TOKEN_VRS_EM_CARTEIRA_JSON`, etapa e correlation ID. O evento de
  conclusao registra o status recebido, inclusive 401/403; nao significa sucesso
  de autenticacao. Preserva a semantica de `CREDENCIAL_TESTADA` do login existente.
  Nenhum token nem corpo financeiro e gravado na auditoria.
- Nao existe execucao automatica ao abrir a pagina. Cada consulta exige TOTP.

O retorno pode ser baixado como JSON sanitizado pelo proprio Super Admin.
O ensaio real permanece pendente ate a execucao autenticada; testes sinteticos
e deployment READY nao substituem esse resultado.
