# P2 — Rehearsal do runtime contra clone migrado de produção

## Resultado executivo

`P2_REHEARSAL_RUNTIME_PRODUCAO_MIGRADA = PASS`

O código atual foi exercitado contra um clone real e sanitizado de produção, restaurado e migrado exclusivamente no Supabase/Postgres Docker local. A produção real não recebeu DDL, DML, login, upload ou chamada de runtime durante o P2.

O histórico permaneceu íntegro e carregável. As correções descobertas pelo runtime foram incorporadas à cadeia e o clone foi reconstruído duas vezes, do zero, com o mesmo hash lógico final:

```text
Produção read-only já exportada no P0
  ↓
snapshot local original
  ↓
3 bridges certificadas
  ↓
175 migrations
  ↓
POST_UPGRADE sem falha bloqueante
  ↓
hash fd73b40b2ab55cd0647a328bb6c83dea65f02e837d59c30252607ca8f68c4b9d
```

O runtime histórico está apto, mas o cutover permanece `NO_GO`: os dois fundos do clone ainda não possuem política publicada, templates obrigatórios, CNAB e integração versionada exigidos para novas operações reais.

## Controles de segurança do rehearsal

- banco destrutível restrito a `127.0.0.1:55322`;
- API Supabase restrita a `127.0.0.1:55321`;
- ambiente identificado como `rehearsal/local`;
- service role exclusivamente local;
- SMTP remoto, webhooks, cron e adapters externos removidos do ambiente;
- e-mails capturados somente pelo Mailpit local;
- destinatários sintéticos no domínio reservado `.invalid`;
- nenhuma credencial Sinqia, Vórtx, Fromtis ou transportadora utilizada;
- nenhuma remessa enviada a administrador externo;
- relatórios de execução ignorados pelo Git e sem tokens, senhas ou links de convite.

## Invariantes históricas

| Invariante | Esperado | Resultado | Status |
|---|---:|---:|---|
| Cedentes | 12 | 12 | PASS |
| Cedentes vinculados | 10 | 10 | PASS |
| Cedentes sem fundo | 2 | 2, preservados no fluxo compatível | PASS |
| Operações | 45 | 45 carregáveis | PASS |
| Notas fiscais | 903 | 903 preservadas | PASS |
| Documentos | 123 | 123 preservados | PASS |
| Objetos de Storage | 1.635 | 1.635 preservados | PASS |
| Auth users / profiles | 23 / 23 | 23 / 23 | PASS |
| Operações Fromtis legadas | 26 | 26 com remessa e retorno | PASS |
| Massa sintética final | 0 | 0 | PASS |

Distribuição das 45 operações: 20 liquidadas, 16 em andamento, 6 inadimplentes, 2 canceladas e 1 solicitada. Todos os 45 detalhes foram abertos pelo runtime autenticado sem erro de página ou console.

Uma das 903 NFs possui chave histórica fora do padrão atual. Ela foi reportada explicitamente e continuou visível; nenhuma validação retroativa foi inventada para ocultá-la ou reescrever seu histórico.

## Matriz funcional autenticada

### Gestor e Super Admin

- dashboard, fundos, cedentes, onboarding, operações, NFs, documentos e conciliação: PASS;
- integrações e templates no detalhe do fundo: PASS;
- 45 detalhes históricos de operação: 45/45;
- Gestor limitado enxergou somente o fundo autorizado;
- Super Admin local acessou as rotas administrativas previstas.

`HISTORICO_GESTOR_VISIVEL = PASS`

### Cedente

- owner legado resolveu a associação canônica correta;
- ADMIN canônico permaneceu com escopo cadastral;
- OPERACIONAL permaneceu sem capacidade administrativa;
- dashboard, estabelecimentos, NFs, operações, documentos e detalhes históricos: PASS;
- isolamento confirmou somente o próprio Cedente em cedentes, operações e NFs.

`HISTORICO_CEDENTE_VISIVEL = PASS`

### Sacado

- dashboard, NFs, aprovação e pagamentos: PASS;
- somente a linha de identidade do Sacado autenticado ficou visível;
- as NFs esperadas para o CNPJ desse Sacado permaneceram disponíveis;
- nenhuma linha de outro Sacado foi exposta.

### RLS

`RLS_POS_UPGRADE = PASS`

A matriz confirmou isolamento de Gestor por fundo, Cedente por organização, ADMIN versus OPERACIONAL, Super Admin e Sacado. Policies sem grants efetivos foram tratadas como falha, não como proteção suficiente.

## Storage legado

Os metadados históricos foram preservados:

| Bucket | Metadados | Upload local | URL assinada | Download | Limpeza |
|---|---:|---|---|---|---|
| `contratos` | 251 | PASS | PASS | PASS | PASS |
| `documentos-cedentes` | 134 | PASS | PASS | PASS | PASS |
| `notas-fiscais` | 1.250 | PASS | PASS | PASS | PASS |

Os binários de produção não foram copiados. Fixtures mínimas locais provaram autorização, assinatura, leitura e compensação; todas foram removidas.

`STORAGE_LEGADO_COMPATIVEL = PASS`

## Auth, MFA e convites

- senhas e fatores reais não foram utilizados;
- três identidades históricas receberam senha aleatória e MFA somente no clone;
- usuário sem fator foi direcionado ao setup;
- TOTP elevou a sessão e `/api/auth/session-security` confirmou a sessão operacional;
- Gestor sintético foi convidado pelo fluxo administrativo, capturado no Mailpit, aceitou o link scanner-safe e concluiu MFA;
- Cedente sintético foi convidado pelo onboarding invite-first, capturado no Mailpit, aceitou o convite, nasceu vinculado ao fundo e concluiu MFA;
- fatores verificados dos convidados: 2/2;
- após a certificação, a reconstrução do clone removeu todos os convidados e fatores sintéticos.

`AUTH_MFA_CONVITES = PASS`

## Nova operação controlada

Sem política publicada, a tela de nova solicitação agora apresenta bloqueio explícito e mantém o histórico acessível. No clone local foi criada somente a configuração mínima não sensível necessária para o teste:

```text
Cedente histórico local
  ↓
política sintética publicada
  ↓
NF sintética elegível
  ↓
solicitação criada
  ↓
aprovação local
  ↓
parada obrigatória antes de envio externo
```

A solicitação foi criada e aprovada. Nenhum adapter externo, CNAB remoto, webhook ou SMTP real foi acionado. A reconstrução final removeu a operação, NF e política sintéticas.

`NOVA_OPERACAO_RUNTIME = PASS`

## Fromtis legado

As 26 operações com dados Fromtis mantiveram remessa e retorno históricos. A exibição não passou a exigir retroativamente uma versão no novo modelo de integrações. Novo envio permanece condicionado à configuração técnica publicada do fundo.

`FROMTIS_HISTORICO = PASS`

## Bugs encontrados e correções mínimas

1. **Sacado sem leitura da própria identidade.** A canonicalização havia removido o grant de `sacados`; a policy isolada não bastava. A migration `20260827203000` restaura somente `SELECT` autenticado com own-row RLS.
2. **RPC administrativa referenciando colunas ausentes.** As RPCs SA1 usavam campos estruturais de `fundos` que não haviam sido materializados. A migration `20260827203000` adiciona apenas esses campos opcionais.
3. **Notificações e Realtime sem grant.** `notificacoes.usuario_id` existia, mas `authenticated` não possuía `SELECT`; o Realtime reportava o filtro como coluna inválida. A migration `20260827204000` concede somente `SELECT` e `UPDATE`, protegidos por `auth.uid()`.
4. **Convites sem profile.** `public.handle_new_user()` existia, mas não havia trigger em `auth.users`. A migration `20260827205000` restaura `AFTER INSERT`; a função continua impedindo que `super_admin` nasça de metadata.
5. **WebSocket local bloqueado por CSP.** A origem `ws://`/`wss://` correspondente ao Supabase configurado passou a compor `connect-src`, sem wildcard.
6. **Nova operação sem configuração causava erro de runtime.** O Cedente agora recebe estado operacional explícito, mantendo a consulta histórica.
7. **Auth legado incompatível com GoTrue local.** Campos de token nulos são normalizados apenas no clone, antes do runtime, com hash de negócio inalterado.
8. **SMTP local incompatível com STARTTLS.** A exceção sem TLS exige simultaneamente ambiente `rehearsal/local`, host loopback e flag explícita; hosts remotos continuam exigindo TLS.
9. **Origem local divergente nos convites.** Runtime, Auth e links foram unificados em `localhost:3001`, preservando a validação CSRF exata.

## Pré-condições exatas para o cutover

O inventário encontrou dois fundos e, em ambos, zero configuração operacional versionada. Antes do deploy do runtime novo em produção, cada fundo deve possuir:

1. **Política operacional**
   - política ativa no catálogo do fundo;
   - versão publicada;
   - vínculo explícito com cada `cedente_fundo` ativo;
   - requisitos documentais revisados, sem backfill inventado para operações antigas.
2. **Templates jurídicos**
   - Contrato-mãe publicado;
   - Termo de cessão publicado;
   - demais templates conforme o fluxo escolhido;
   - variáveis e golden files homologados.
3. **CNAB**
   - configuração vinculada ao fundo;
   - versão publicada;
   - layout, banco, agência, conta, carteira e espécie homologados;
   - código originador textual validado e com zeros à esquerda preservados;
   - golden file aprovado pelo administrador.
4. **Integração técnica**
   - provider e adapter corretos;
   - capabilities necessárias publicadas;
   - ambiente e endpoint de produção homologados;
   - versão publicada vinculada ao fundo;
   - referência de credencial ativa, com segredo provisionado fora de JSON comum;
   - teste de conexão e autorização concluído sem fallback legado implícito.
5. **Risco e financeiro, quando habilitados**
   - método de cálculo e parâmetros publicados;
   - PL de referência disponível para a data-base exigida;
   - limites e política de exposição revisados;
   - decisão operacional e concorrência homologadas.
6. **Dados legados pendentes**
   - decisão operacional para os 2 Cedentes sem `cedente_fundos`;
   - nenhuma parcela histórica deve ser inventada sem `nDup`/`vDup` de origem;
   - operações antigas devem continuar sem snapshot artificial.

## Evidências e reprodução

Comandos principais:

```bash
npm run rehearsal:verify-upgrade
npm run rehearsal:runtime:prepare
npm run rehearsal:runtime:start
npm run rehearsal:runtime:audit
npm run rehearsal:runtime:browser
npm run rehearsal:runtime:invites
npm run rehearsal:runtime:configure-operation
npm run rehearsal:runtime:browser -- --controlled-operation
npm run rehearsal:runtime:approve-operation
```

Os relatórios JSON de execução ficam em `rehearsal/reports/`, são locais/ignorados e não devem ser versionados. Os scripts de reprodução ficam em `rehearsal/scripts/`.

## Gate de qualidade do código

| Validação | Resultado |
|---|---|
| `npx tsc --noEmit` | PASS |
| `npm test -- --run` | PASS — 231 arquivos aprovados, 1 ignorado; 1.951 testes aprovados, 3 ignorados |
| testes direcionados do P2 | PASS — 16 testes Vitest e 7 testes dos scripts de rehearsal |
| `npm run lint` | PASS — zero erros; cinco avisos preexistentes fora do escopo |
| `git diff --check` | PASS |
| `npx next build --webpack` | PASS |
| varredura de credenciais versionáveis | PASS — nenhuma chave JWT ou credencial real encontrada nos artefatos do P2 |

O capturador SMTP local utiliza a configuração atual `local_smtp`. A exceção de transporte sem TLS permanece restrita ao ambiente `rehearsal/local`, host loopback e opt-in explícito; ela não é aplicável a homologação ou produção.

## Parecer final

```text
RUNTIME_HISTORICO_COMPATIVEL = CONFIRMADO
OPERACOES_EXISTENTES_VISIVEIS = CONFIRMADO
NFS_EXISTENTES_VISIVEIS = CONFIRMADO
USUARIOS_EXISTENTES_COMPATIVEIS = CONFIRMADO
RLS_POS_UPGRADE = CONFIRMADO
STORAGE_LEGADO = CONFIRMADO
NOVAS_OPERACOES_APOS_CONFIG = CONFIRMADO
CUTOVER_PRODUCAO = NO_GO
```

O `NO_GO` não decorre de perda histórica ou incompatibilidade do runtime. Ele permanece até que as três migrations corretivas sejam revisadas/aplicadas no processo formal e as configurações de política, templates, CNAB, integração e risco sejam preparadas e homologadas por fundo. Produção real permaneceu intocada durante todo o P2.
