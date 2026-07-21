# BW Antecipa — documentação técnica do estado atual

**Data da análise:** 20/07/2026<br>
**Escopo:** código versionado no diretório do projeto, incluindo `src`, `supabase`, `scripts`, configuração e documentação existente.<br>
**Critério:** esta documentação descreve o que está implementado ou declarado nos arquivos. Quando o comportamento de produção não pode ser verificado apenas pelo repositório, isso é indicado explicitamente.

## 1. Objetivo do projeto

O BW Antecipa é um portal web para antecipação de recebíveis representados por notas fiscais. O cedente cadastra a empresa, envia documentos de compliance e notas fiscais, solicita a antecipação e acompanha o desembolso e a liquidação. O gestor analisa cadastros, documentos, notas e operações. O sacado confirma ou contesta a cessão e acompanha os valores a pagar. O consultor possui visão de carteira, operações, escrow e comissões.

Essa finalidade é apresentada na landing page e refletida nos módulos de autenticação, cedente, gestor, sacado e consultor: `src/app/page.tsx`, `src/app/(auth)/login/page.tsx`, `src/app/cedente`, `src/app/gestor`, `src/app/sacado` e `src/app/consultor`.

### Fluxo principal do usuário

1. O usuário cria uma conta ou entra em uma conta existente.
2. Um cedente preenche seus dados empresariais, representantes e dados bancários.
3. O cedente envia documentos obrigatórios; o gestor analisa cada documento e aprova ou reprova.
4. Com o cadastro aprovado, o sistema cria uma conta escrow para o cedente.
5. O cedente envia NFs em XML, PDF ou imagem. XML é processado automaticamente; PDF textual pode ser parcialmente extraído; imagem e PDF não extraídos ficam como rascunho.
6. O gestor aprova, reprova ou devolve a NF para ajuste.
7. O cedente seleciona NFs aprovadas e solicita uma operação de antecipação.
8. As NFs passam para `em_antecipacao`; o sacado aprova ou contesta a cessão.
9. Quando todas as NFs da operação são aceitas, o gestor define taxa e valor líquido, aprova a operação, gera documentos, anexa documentos assinados e comprovante TED e desembolsa.
10. O desembolso é lançado na conta escrow. Depois do vencimento, o gestor confirma a liquidação ou a operação pode ser marcada como inadimplente.

As transições são implementadas principalmente em `src/lib/actions/cedente.ts`, `src/lib/actions/gestor.ts`, `src/lib/actions/nota-fiscal.ts`, `src/lib/actions/operacao.ts`, `src/lib/actions/sacado.ts` e `src/lib/actions/liquidacao.ts`.

## 2. Arquitetura

### Stack

| Camada | Implementação encontrada |
|---|---|
| Runtime | Node.js 22.x, declarado em `package.json` |
| Framework | Next.js 16.2.6, App Router, React Server Actions e Route Handlers |
| UI | React 19.2.4, Tailwind CSS 4, `tw-animate-css`, componentes no estilo shadcn/base-nova |
| Componentes | Componentes próprios em `src/components/ui`, ícones `lucide-react` |
| Formulários | React Hook Form está instalado; as páginas também usam estado React diretamente |
| Validação | Zod em `src/lib/validations` |
| Backend/DB | Supabase: Auth, PostgreSQL, Storage e Realtime |
| Sessão | `@supabase/ssr`, cookies e proxy do Next.js |
| PDF | Handlebars + Puppeteer Core; Chromium local ou `@sparticuz/chromium` em servidor |
| NF em XML | Parser próprio baseado em regex em `src/lib/nf-parser.ts` |
| NF em PDF | `pdf-parse` + regex em `src/lib/pdf-nf-parser.ts` |
| Arquivo bancário | Gerador CNAB 444 em `src/lib/cnab/gerarCnab444.ts` |
| Integração financeira | API externa de escrow por API key e integração SOAP Fromtis |
| Deploy | Vercel, com dois crons declarados em `vercel.json` |

Fontes: `package.json`, `components.json`, `src/app/globals.css`, `next.config.ts`, `src/lib/supabase`, `src/lib/pdf`, `src/lib/cnab`, `src/lib/fromtis` e `vercel.json`.

### Estrutura de pastas

```text
src/
├── app/                    Rotas, layouts, páginas e Server Actions de autenticação
│   ├── (auth)/             Login e cadastro
│   ├── api/                Route Handlers HTTP, crons e APIs de integração
│   ├── cedente/            Portal do cedente
│   ├── consultor/          Portal do consultor
│   ├── gestor/             Portal do gestor
│   └── sacado/             Portal do sacado
├── components/             Layouts de portal, contratos e componentes de UI
├── hooks/                  Hooks client-side de autenticação e perfil
├── lib/
│   ├── actions/            Regras de negócio como Server Actions
│   ├── cnab/               Geração de CNAB 444
│   ├── fromtis/            Envio de remessa via SOAP
│   ├── pdf/                Geração de PDFs
│   ├── supabase/           Clientes browser, server, admin e atualização de sessão
│   ├── validations/        Schemas Zod
│   └── *.ts                Parsers, e-mail, storage, documentos e utilitários
├── templates/contratos/    Templates HTML dos contratos e termos
├── types/                  Tipos TypeScript do banco
└── proxy.ts                Proxy de sessão e autorização por portal
supabase/
├── schema.sql              Schema base, funções, RLS e trigger de perfil
├── migrations/             Alterações incrementais 003 a 016
├── storage.sql             Buckets e policies de Storage da configuração base
├── homolog_setup.sql       Cópia de setup inicial para homologação
└── config.toml             Configuração local do Supabase
docs/                       Manuais funcionais por perfil
scripts/                    Script manual de teste do parser de PDF
```

### Relação entre os componentes

- As páginas são majoritariamente Client Components e consultam o Supabase Browser Client diretamente para leitura e algumas atualizações simples.
- Ações sensíveis são Server Actions em `src/lib/actions`; elas recuperam o usuário pela sessão server-side, consultam o Supabase e registram auditoria/notificações.
- Os Route Handlers em `src/app/api` concentram geração de PDFs, download de arquivos privados, CNAB, Fromtis, crons e sincronização de escrow.
- `PortalLayout` carrega o perfil e impede a renderização do portal quando a role não coincide; `src/proxy.ts` aplica a proteção antes da página.
- O banco aplica RLS nas tabelas base. O Storage usa buckets privados e policies por role/pasta, com correção posterior para usuários convidados em `supabase/migrations/012_storage_policies_acesso_vinculado.sql`.

Arquivos centrais: `src/components/auth/portal-layout.tsx`, `src/components/auth/sidebar.tsx`, `src/proxy.ts`, `src/lib/supabase/middleware.ts`, `src/lib/supabase/server.ts` e `src/lib/supabase/client.ts`.

## 3. Fluxos de negócio

### 3.1 Cadastro e onboarding do cedente

O signup cria usuário no Supabase Auth com metadados `nome_completo` e `role: 'cedente'`. O trigger `handle_new_user` cria o registro correspondente em `profiles`. Depois, o cedente preenche empresa, ao menos um representante e conta bancária. `cadastrarCedente` grava `cedentes`, grava `representantes`, registra auditoria e notifica gestores.

O gestor só consegue ativar o cedente quando os documentos empresariais e, quando há representantes, os documentos obrigatórios de cada representante estão aprovados. A ativação altera o status para `ativo` e cria uma conta escrow com identificador `ESC-<CNPJ>-<sequencial>`.

Fontes: `src/app/(auth)/cadastro/page.tsx`, `src/app/actions/auth.ts`, `supabase/schema.sql` (função/trigger de perfil), `src/app/cedente/cadastro/page.tsx`, `src/lib/validations/cedente.ts`, `src/lib/actions/cedente.ts` e `src/lib/actions/gestor.ts`.

### 3.2 Documentos de compliance

Tipos declarados para upload: contrato social, cartão CNPJ, RG/CPF, comprovante de endereço, extrato bancário, balanço patrimonial, DRE e procuração. O schema do banco também declara `comprovante_de_renda`, e `src/lib/documentos.ts` possui validade para ele, mas `documentoUploadSchema` não o aceita.

O upload aceita PDF, JPG e PNG até 20 MB. Os arquivos são versionados por cedente, tipo e representante, e gravados no bucket `documentos-cedentes`. A análise exige motivo quando o status é `reprovado`. O gestor pode solicitar atualização; documentos aprovados têm validade por tipo e o cron diário procura vencidos e documentos a vencer em 30 dias.

Fontes: `src/app/cedente/documentos/page.tsx`, `src/lib/actions/cedente.ts`, `src/lib/actions/gestor.ts`, `src/lib/validations/documento.ts`, `src/lib/documentos.ts` e `src/app/api/cron/documentos-vencidos/route.ts`.

### 3.3 Nota fiscal

Estados usados no código: `rascunho`, `submetida`, `em_analise`, `aprovada`, `em_antecipacao`, `aceita`, `contestada`, `liquidada`, `cancelada` e, pela migration 013, `requer_ajuste`.

- XML: extrai dados da NF-e, exige que o CNPJ emitente coincida com o CNPJ do cedente e rejeita chave de acesso duplicada.
- PDF textual: tenta extrair número, série, chave, datas, destinatário, valores, condição de pagamento e informações complementares. O CNPJ e a razão social do emitente são sempre derivados do cedente autenticado, não do PDF.
- PDF escaneado/imagem ou PDF cuja extração falha: cria rascunho para preenchimento manual.
- Rascunho: o cedente edita dados, salva e submete; a submissão exige número, destinatário e valor bruto positivo.
- Gestão: o gestor aprova, cancela/reprova ou solicita ajuste. O cedente pode editar e resubmeter uma NF em `requer_ajuste`.

Validações de formulário: data de emissão não futura, vencimento não anterior ao dia atual, valor bruto positivo, CNPJ emitente igual ao cedente e chave não duplicada. A action manual, entretanto, faz validações próprias e não reutiliza integralmente o schema Zod.

Fontes: `src/app/cedente/notas-fiscais/page.tsx`, `src/app/cedente/notas-fiscais/[id]/page.tsx`, `src/app/gestor/notas-fiscais/page.tsx`, `src/app/gestor/notas-fiscais/[id]/page.tsx`, `src/lib/actions/nota-fiscal.ts`, `src/lib/nf-parser.ts`, `src/lib/pdf-nf-parser.ts`, `src/lib/validations/nf.ts` e `supabase/migrations/013_nf_solicitar_ajuste.sql`.

### 3.4 Solicitação de antecipação

Somente NFs `aprovada` do próprio cedente podem ser selecionadas. É necessário existir cadastro ativo e conta escrow ativa. Para cada NF, o sistema calcula:

```text
prazoDias = max(1, ceil((vencimento - agora) / 1 dia))
taxa      = primeira taxa configurada cujo prazo esteja no intervalo
fator     = (1 + taxa / 100) ^ (prazoDias / 30)
antecipado = arredondar(valorBruto / fator, 2)
```

A operação recebe soma do valor bruto, taxa média ponderada, prazo médio ponderado, maior vencimento e soma dos valores antecipados. Depois são criados os vínculos em `operacoes_nfs` e as NFs passam a `em_antecipacao`.

Se não existir faixa de taxa para algum prazo, a taxa daquela NF é zero e a interface informa que o gestor definirá a taxa. As faixas são configuradas pelo gestor em `taxas_cedente`.

Fontes: `src/app/cedente/operacoes/nova/page.tsx`, `src/lib/actions/operacao.ts` e `src/lib/validations/operacao.ts`.

### 3.5 Aceite ou contestação pelo sacado

O sacado vê somente NFs cujo `cnpj_destinatario` corresponde ao CNPJ do seu registro `sacados`. Na rota `/sacado/aprovacao`, pode filtrar por cedente, vencimento e valor, aceitar uma NF, aceitar várias em lote ou contestar individualmente com motivo obrigatório.

O aceite só ocorre para `em_antecipacao`, altera a NF para `aceita` e grava `aprovacao_sacado_em`. A contestação altera para `contestada`. Em ambos os casos há notificações para gestores/cedente e log de auditoria.

Fontes: `src/app/sacado/aprovacao/page.tsx`, `src/lib/actions/sacado.ts`, `supabase/schema.sql` (policies `notas_fiscais_sacado_*`) e `supabase/migrations/007_rename_aceite_sacado_em.sql`.

### 3.6 Aprovação, documentação e desembolso

O gestor só aprova uma operação quando todas as NFs vinculadas estão `aceita`. A aprovação grava taxa, prazo médio, valor líquido, usuário/data de aprovação e calcula `taxa_desagio`/`valor_antecipado` por NF. A página dispara a geração assíncrona do Termo de Cessão.

Antes do desembolso, a operação precisa estar `aprovada`, ter `termo_assinado_url` e `comprovante_pagamento_url`. A interface também permite selecionar duas testemunhas, gerar Termo de Cessão, gerar notificação ao sacado, gerar CNAB, enviar CNAB ao Fromtis e anexar documentos assinados.

O desembolso muda a operação para `em_andamento`, soma o valor líquido à conta escrow, registra movimento de crédito e notifica o cedente. A reprovação muda a operação para `reprovada` e devolve as NFs para `aprovada`. O cancelamento pelo cedente só é aceito em `solicitada` ou `em_analise`.

Fontes: `src/app/gestor/operacoes/[id]/page.tsx`, `src/lib/actions/operacao.ts`, `src/components/contratos/BotaoDownloadContrato.tsx`, `src/components/contratos/UploadDocumentoAssinado.tsx` e `src/lib/pdf/gerarContrato.ts`.

### 3.7 Vencimento, inadimplência e liquidação

O cron `vencimentos` procura operações `em_andamento`, notifica no D-5 e D-1 e marca como `inadimplente` quando o vencimento passou. O gestor também pode marcar manualmente a inadimplência.

`liquidarOperacao` aceita operações `em_andamento` ou `inadimplente`, muda para `liquidada`, grava `liquidada_em`, muda todas as NFs para `liquidada`, registra um crédito na escrow e notifica o cedente. Depois da liquidação, o gestor pode gerar e anexar o Termo de Quitação. O sacado pode apenas informar que pagou; essa action gera notificação/log e não liquida diretamente a operação.

Fontes: `src/app/api/cron/vencimentos/route.ts`, `src/app/gestor/operacoes/[id]/page.tsx`, `src/lib/actions/liquidacao.ts`, `src/lib/actions/sacado.ts`, `src/lib/pdf/gerarContrato.ts` e `supabase/migrations/016_termo_quitacao.sql`.

## 4. Backend

### 4.1 APIs HTTP

| Método e rota | Função | Autorização/entrada |
|---|---|---|
| `GET /api/contratos/download?path=...` | Cria signed URL de 1 hora para o bucket `contratos` | Requer sessão; usa service role para Storage |
| `POST /api/contratos/gerar-contrato` | Gera contrato-mãe do cedente | Gestor; `{ cedente_id }` |
| `POST /api/contratos/gerar-termo` | Gera Termo de Cessão | Gestor; `{ operacao_id }` |
| `POST /api/contratos/gerar-notificacao` | Gera notificação de cessão ao sacado | Gestor; `{ operacao_id }` |
| `POST /api/contratos/gerar-quitacao` | Gera Termo de Quitação | Gestor; `{ operacao_id }`, operação deve estar liquidada |
| `POST /api/contratos/gerar-cnab` | Gera arquivo CNAB 444, salva cópia e devolve download | Gestor; `{ operacao_id }` |
| `POST /api/contratos/enviar-remessa` | Envia CNAB ZIP/XML para Fromtis | Gestor; `{ operacao_id }` |
| `GET /api/cron/vencimentos` | Alertas D-5/D-1 e inadimplência | `Authorization: Bearer CRON_SECRET` |
| `GET /api/cron/documentos-vencidos` | Verificação de validade documental | `Authorization: Bearer CRON_SECRET` |
| `POST /api/escrow/sync` | Importa movimentos externos e atualiza saldo | `Authorization: Bearer ESCROW_API_KEY` |
| `GET /api/escrow/sync?identificador=...` | Consulta saldo e últimos 50 movimentos | `Authorization: Bearer ESCROW_API_KEY` |

Arquivos: `src/app/api/contratos/**/route.ts`, `src/app/api/cron/**/route.ts` e `src/app/api/escrow/sync/route.ts`.

### 4.2 Server Actions e serviços

| Módulo | Responsabilidades |
|---|---|
| `src/app/actions/auth.ts` | Login, signup e logout |
| `src/lib/actions/cedente.ts` | Cadastro, upload/reenvio de documentos, solicitação de alteração cadastral e contrato assinado |
| `src/lib/actions/gestor.ts` | Análise documental, aprovação/reprovação de cedente, flags de escrow/coobrigação, alterações cadastrais, acessos convidados e fundos |
| `src/lib/actions/nota-fiscal.ts` | Upload/parsing, rascunho, submissão, aprovação/reprovação/ajuste e operações em lote |
| `src/lib/actions/operacao.ts` | Solicitar, aprovar, desembolsar, reprovar, cancelar, remover NF, taxas, testemunhas e documentos assinados |
| `src/lib/actions/sacado.ts` | Aceite individual/lote, contestação e informação de pagamento |
| `src/lib/actions/liquidacao.ts` | Liquidação e inadimplência |
| `src/lib/actions/escrow.ts` | Movimentos unitários e em lote |
| `src/lib/actions/notificacao.ts` | Notificações para usuário, cedente e gestores; tentativa de e-mail |
| `src/lib/actions/auditoria.ts` | Inserção de logs com service role |
| `src/lib/actions/testemunhas.ts` | Listagem, cadastro e ativação/desativação de testemunhas |

### 4.3 Integrações externas

- Supabase Auth/PostgreSQL/Storage/Realtime: `src/lib/supabase/*.ts` e `supabase/*.sql`.
- Resend: `src/lib/email.ts` chama `https://api.resend.com/emails` quando `RESEND_API_KEY` existe. A dependência `resend` não está instalada; a integração usa `fetch` direto.
- Fromtis: `src/lib/fromtis/remessa.ts` monta ZIP com JSZip, codifica em Base64, envia envelope SOAP e armazena o ID/retorno em `operacoes`.
- Chromium/Puppeteer: `src/lib/pdf/gerarContrato.ts` gera PDF a partir de HTML Handlebars.
- Sistema externo de escrow: `src/app/api/escrow/sync/route.ts` recebe movimentos por API key.
- Vercel Cron: `vercel.json` agenda `/api/cron/vencimentos` às 08:00 e `/api/cron/documentos-vencidos` às 08:30, sem timezone explícito no arquivo.

### 4.4 Banco de dados e modelos

O banco base está descrito em `supabase/schema.sql`; mudanças posteriores estão em `supabase/migrations/003_storage_buckets_env.sql` até `016_termo_quitacao.sql`.

| Tabela | Conteúdo e relacionamentos principais |
|---|---|
| `profiles` | Usuário ligado a `auth.users`; role, nome, e-mail e status |
| `cedentes` | Empresa, dados cadastrais/bancários, status, fundo, coobrigação, escrow e contratos |
| `representantes` | Representantes legais de um cedente; `documentos.representante_id` aponta para este cadastro |
| `documentos` | Versões de documentos do cedente, status, arquivo, análise e solicitação de atualização |
| `contas_escrow` | Uma conta por cedente aprovado, saldo disponível/bloqueado e status |
| `movimentos_escrow` | Ledger de créditos/débitos, saldo após movimento e operação opcional |
| `fundos` | Dados do fundo, administradora, gestora, custodiante e conta vinculada |
| `devedores_solidarios` | Devedores solidários ligados a cedente; há schema, mas não foi encontrada tela/action de uso |
| `notas_fiscais` | Dados fiscais, emitente/destinatário, valores, arquivos, status e dados de antecipação |
| `operacoes` | Agrupa NFs, valores, taxa, prazo, status, escrow, documentos, remessa e liquidação |
| `operacoes_nfs` | Junção N:N entre operações e notas fiscais |
| `taxas_cedente` | Faixas de prazo e taxa por cedente |
| `consultor_cedente` | Vínculo consultor–cedente e comissão percentual |
| `sacados` | Usuário sacado, CNPJ e razão social; usado para restringir NFs por destinatário |
| `logs_auditoria` | Evento, entidade, dados antes/depois e usuário/origem |
| `notificacoes` | Mensagens por usuário, tipo, lida/não lida |
| `testemunhas` | Criada na migration 005; lista global selecionável por operação |
| `solicitacoes_alteracao_cedente` | Snapshot atual/proposto de dados e representantes, com aprovação/reprovação |
| `cedente_acessos` | Usuários convidados vinculados a cedente, perfil administrador/operador e ativo |

Relacionamentos principais:

```text
auth.users 1—1 profiles
profiles 1—N cedentes / sacados
cedentes 1—N documentos, representantes, notas_fiscais, operacoes, taxas_cedente
cedentes 1—N contas_escrow 1—N movimentos_escrow
operacoes N—N notas_fiscais via operacoes_nfs
cedentes N—N profiles via consultor_cedente e cedente_acessos
cedentes N—1 fundos
operacoes N—1 profiles (aprovado_por) e N—1 testemunhas (duas FKs)
```

### 4.5 RLS e Storage

As tabelas base têm RLS habilitado em `supabase/schema.sql`. A regra geral é:

- gestor: acesso amplo às tabelas de negócio;
- cedente: acesso ao próprio cedente, seus documentos, NFs, operações e escrow;
- sacado: NFs destinadas ao seu CNPJ, operações relacionadas e atualização de aceite/contestação;
- consultor: leitura de cedentes, representantes, NFs, operações e escrow;
- usuário: próprio perfil e próprias notificações;
- auditoria: gestores leem tudo; usuários autenticados inserem log com seu próprio `usuario_id`.

As policies de Storage usam três buckets privados: `documentos-cedentes`, `notas-fiscais` e `contratos`, declarados em `src/lib/storage.ts` e criados/configurados em `supabase/storage.sql` e `supabase/migrations/003_storage_buckets_env.sql`. A migration 012 altera a restrição por pasta para usar `get_user_cedente_id()`, permitindo usuários vinculados via `cedente_acessos`.

## 5. Frontend

### Portais e telas

| Portal | Rotas implementadas | Função |
|---|---|---|
| Público/Auth | `/`, `/login`, `/cadastro` | Landing page, login e criação de conta |
| Cedente | `/cedente/dashboard`, `/cadastro`, `/documentos`, `/notas-fiscais`, `/notas-fiscais/[id]`, `/operacoes`, `/operacoes/nova`, `/extrato`, `/notificacoes` | Onboarding, compliance, NFs, antecipação, escrow e notificações |
| Gestor | `/gestor/dashboard`, `/cedentes`, `/cedentes/[id]`, `/documentos`, `/notas-fiscais`, `/notas-fiscais/[id]`, `/operacoes`, `/operacoes/[id]`, `/escrow`, `/escrow/[id]`, `/fundos`, `/relatorios`, `/notificacoes`, `/configuracoes`, `/configuracoes/testemunhas`, `/auditoria` | Administração de todo o ciclo operacional |
| Sacado | `/sacado/dashboard`, `/notas-fiscais`, `/aprovacao`, `/pagamentos`, `/notificacoes` | Obrigações, aceite/contestação e aviso de pagamento |
| Consultor | `/consultor/dashboard`, `/carteira`, `/operacoes`, `/escrow`, `/escrow/[id]`, `/relatorios`, `/notificacoes` | Visibilidade de carteira e comissões |

O mapa acima vem diretamente da árvore `src/app` e foi confirmado pelo resultado de `npm run build`.

### Componentes importantes

- `PortalLayout`: carrega perfil, exibe loading e redireciona para o dashboard da role.
- `Sidebar`: menus separados por role; o menu de Extrato do cedente só aparece quando `cedentes.habilitar_escrow` é verdadeiro.
- `Header`: perfil, role, logout e sino de notificações.
- `NotificationBell`: últimas 10 notificações, Realtime para INSERT e polling de 30 segundos.
- `BotaoDownloadContrato`: gera/regenera documentos e abre signed URL.
- `UploadDocumentoAssinado`: upload/substituição de arquivos assinados no bucket de contratos.
- Componentes `src/components/ui/*`: primitives de card, botão, tabela, select, dialog, tabs, sheet, badge etc.

Fontes: `src/components/auth`, `src/components/contratos`, `src/components/ui` e `src/app/cedente/layout.tsx`.

### Estado e navegação

Não há store global dedicado. O estado é local a cada página via `useState`, com carregamento em `useEffect`. Sessão e perfil são obtidos por Supabase; `useAuth` e `useProfile` existem como hooks reutilizáveis, mas `PortalLayout` também implementa seu próprio carregamento.

A navegação é feita por `next/link`, `useRouter` e redirecionamentos das Server Actions. O caminho do portal é definido pela role em `src/lib/supabase/middleware.ts`, `src/app/actions/auth.ts` e `src/components/auth/portal-layout.tsx`.

## 6. Autenticação e segurança

### Login e cadastro

- Login: `supabase.auth.signInWithPassword`, depois leitura de `profiles.role` e redirect para o dashboard correspondente.
- Cadastro: `supabase.auth.signUp` com e-mail/senha e metadados; o trigger de banco cria `profiles`.
- Logout: `supabase.auth.signOut` e redirect para `/login`.
- Senha: mínimo de 8 caracteres, uma maiúscula, um número e um caractere especial, tanto no login quanto no cadastro.
- Não foi encontrada implementação de recuperação de senha, OAuth ou MFA nas páginas/actions do projeto.

Fontes: `src/app/actions/auth.ts`, `src/lib/validations/auth.ts`, `src/app/(auth)/login/page.tsx`, `src/app/(auth)/cadastro/page.tsx`, `supabase/schema.sql` e `supabase/config.toml`.

### Sessões, roles e middleware

`src/proxy.ts` aplica `updateSession` ao matcher de quase todas as rotas. O middleware:

1. atualiza cookies Supabase;
2. chama `auth.getUser()`;
3. libera apenas `/`, `/login` e `/cadastro` sem autenticação;
4. redireciona usuário não autenticado para `/login`;
5. redireciona usuário autenticado fora do portal da própria role;
6. redireciona usuário autenticado em login/cadastro para o dashboard da role.

O controle é duplicado no client por `PortalLayout`. O banco continua sendo a camada definitiva de isolamento via RLS.

### Tokens e privilégios

- Sessão normal usa cookies Supabase SSR e chave anon.
- APIs de cron usam `CRON_SECRET` em Bearer token.
- API de sincronização escrow usa `ESCROW_API_KEY` em Bearer token.
- Operações server-side de auditoria, Storage, PDF, CNAB e Fromtis usam `SUPABASE_SERVICE_ROLE_KEY`.
- A service role aparece somente em arquivos server-side, mas `/api/contratos/download` gera signed URL para qualquer usuário autenticado que forneça um `path`; o handler não verifica role nem se o caminho pertence ao usuário.

### Pontos de segurança observados

Há RLS para as tabelas base, validação de CNPJ/CPF no cadastro e isolamento por CNPJ/CNPJ destinatário. Também há limite de 20 MB para uploads de documentos e NFs e limite de 50 MB para Server Actions/proxy.

Os pontos que requerem revisão antes de alterações são: uso de service role, endpoint de download sem checagem de escopo, crons que gravam `usuario_id = null` apesar de a coluna estar `NOT NULL`, e ações que dependem da RLS para impedir alteração por role incorreta em vez de verificar explicitamente a role.

## 7. Configuração

### Variáveis de ambiente usadas pelo código

| Variável | Uso |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL do Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente browser/server com sessão |
| `SUPABASE_SERVICE_ROLE_KEY` | Cliente administrativo server-side |
| `ESCROW_API_KEY` | API de sincronização escrow |
| `CRON_SECRET` | Autorização dos crons |
| `NEXT_PUBLIC_APP_ENV` | Presente nos arquivos `.env.homolog`/`.env.producao`; não há uso encontrado no código |
| `CHROMIUM_BINARY_URL` | Download/executável Chromium em geração de PDF serverless |
| `CHROME_PATH` | Executável Chrome local, com fallback no código |
| `FROMTIS_URL` | Endpoint SOAP Fromtis |
| `FROMTIS_USERNAME` / `FROMTIS_PASSWORD` | Credenciais Fromtis |
| `FROMTIS_TIPO_RECEBIVEL` | Tipo de recebível Fromtis; default `01` |
| `RESEND_API_KEY` | Ativa e-mail transacional |
| `EMAIL_FROM` | Remetente de e-mail; possui fallback no código |
| `NODE_ENV` | Seleciona Chrome local ou Chromium serverless |

Os arquivos `.env.homolog` e `.env.producao` estão no repositório e contêm os nomes acima; os valores não são reproduzidos nesta documentação. O código também referencia variáveis de exemplo do `supabase/config.toml` para recursos locais/experimentais, mas elas não são usadas pelo runtime da aplicação.

### Scripts

```text
npm run dev          next dev
npm run dev:homolog  dotenv com .env.homolog, porta 3001
npm run dev:prod     dotenv com .env.producao, porta 3000
npm run build        next build
npm run start        next start
npm run lint         eslint
```

O script adicional `scripts/test-pdf-parser.js` recebe uma pasta de PDFs e imprime campos extraídos/falhos; não é um teste automatizado integrado ao `package.json`.

Fontes: `package.json`, `next.config.ts`, `vercel.json`, `.env.homolog`, `.env.producao`, `src/lib/email.ts`, `src/lib/pdf/gerarContrato.ts`, `src/lib/fromtis/remessa.ts` e `scripts/test-pdf-parser.js`.

## 8. Funcionalidades implementadas

1. **Landing page pública:** apresentação do produto e links para login/cadastro — `src/app/page.tsx`.
2. **Cadastro/login/logout:** autenticação e redirect por role — `src/app/actions/auth.ts`.
3. **Onboarding de cedente:** dados da empresa, representantes e banco, com CNPJ/CPF — `src/app/cedente/cadastro/page.tsx`, `src/lib/validations/cedente.ts`.
4. **Alteração cadastral com aprovação:** proposta é salva em snapshot e aplicada/reprovada pelo gestor — `src/lib/actions/cedente.ts`, `src/lib/actions/gestor.ts`.
5. **Múltiplos acessos por cedente:** convite por e-mail, perfil administrador/operador, ativação e revogação — migration 011, `src/lib/actions/gestor.ts`.
6. **Upload/versionamento de documentos:** por empresa ou representante, com Storage privado — `src/lib/actions/cedente.ts`.
7. **Análise documental:** aprovação, reprovação com motivo e solicitação de atualização — `src/lib/actions/gestor.ts`.
8. **Validade documental:** prazos por tipo e alerta automático — `src/lib/documentos.ts`, `src/app/api/cron/documentos-vencidos/route.ts`.
9. **Upload múltiplo de NFs:** processamento paralelo e retorno parcial de erros — `src/lib/actions/nota-fiscal.ts`.
10. **Parser XML de NF-e:** extração estruturada, validação de CNPJ emitente e duplicidade de chave — `src/lib/nf-parser.ts`.
11. **Parser de DANFE PDF:** extração heurística de campos; rascunho quando insuficiente — `src/lib/pdf-nf-parser.ts`.
12. **Preenchimento manual de NF:** edição de rascunho e submissão — `src/app/cedente/notas-fiscais/[id]/page.tsx`.
13. **Gestão de NFs:** aprovação, reprovação/cancelamento, solicitação de ajuste e ações em lote — `src/lib/actions/nota-fiscal.ts`.
14. **Conta escrow:** criação na aprovação do cedente, extrato e ledger — `src/lib/actions/gestor.ts`, `src/app/cedente/extrato/page.tsx`, `src/lib/actions/escrow.ts`.
15. **Taxas por faixa de prazo:** configuração por cedente e cálculo de antecipação — `src/lib/actions/operacao.ts`, `src/app/cedente/operacoes/nova/page.tsx`.
16. **Solicitação de antecipação:** seleção de NFs, cálculo, operação e vínculos N:N — `src/lib/actions/operacao.ts`.
17. **Aceite/contestação de cessão:** individual e lote, com filtros — `src/app/sacado/aprovacao/page.tsx`, `src/lib/actions/sacado.ts`.
18. **Aprovação em duas etapas:** termos financeiros e depois desembolso condicionado a documentos — `src/lib/actions/operacao.ts`.
19. **Documentos contratuais:** contrato-mãe, termo de cessão, notificação ao sacado e quitação — `src/lib/pdf/gerarContrato.ts`, templates HTML e Route Handlers de contratos.
20. **Testemunhas:** cadastro global e seleção de duas testemunhas por operação — `src/lib/actions/testemunhas.ts`, `src/app/gestor/configuracoes/testemunhas/page.tsx`.
21. **CNAB 444:** geração e download de remessa — `src/lib/cnab/gerarCnab444.ts`, `src/app/api/contratos/gerar-cnab/route.ts`.
22. **Envio Fromtis:** ZIP/Base64/SOAP e persistência do retorno — `src/lib/fromtis/remessa.ts`.
23. **Desembolso e liquidação:** lançamentos escrow, status, notificações e termo de quitação — `src/lib/actions/operacao.ts`, `src/lib/actions/liquidacao.ts`.
24. **Inadimplência automática/manual:** cron, alerta e mudança de status — `src/app/api/cron/vencimentos/route.ts`.
25. **Notificações in-app:** páginas por portal, sino, Realtime, polling e marcar como lida — `src/lib/actions/notificacao.ts`, `src/components/ui/notification-bell.tsx`.
26. **E-mail transacional opcional:** templates para alguns tipos de notificação — `src/lib/email.ts`.
27. **Auditoria:** logs de eventos críticos com dados antes/depois — `src/lib/actions/auditoria.ts`, `src/app/gestor/auditoria/page.tsx`.
28. **Portal do consultor:** carteira, operações, escrow e estimativa de comissões — `src/app/consultor` e tabela `consultor_cedente`.
29. **Gestão de fundos:** CRUD, ativação e vínculo ao cedente — `src/app/gestor/fundos/page.tsx`, `src/lib/actions/gestor.ts`.

## 9. Pendências, limitações e pontos frágeis

### Inconsistências de schema e tipos

1. `src/types/database.ts` não acompanha o estado do banco após as migrations: não declara `aceita`, `contestada` e `requer_ajuste` em `NfStatus`, nem campos recentes de NF, operação e cedente.
2. As tabelas `representantes`, `testemunhas`, `solicitacoes_alteracao_cedente`, `cedente_acessos`, `devedores_solidarios` e `consultor_cedente` não estão todas representadas no tipo `Database`.
3. O schema declara `comprovante_de_renda`, mas `DocumentoTipo` e `documentoUploadSchema` não o tratam de forma consistente.
4. `supabase/schema.sql` e `supabase/homolog_setup.sql` são bases antigas em relação às migrations 008–016. A implantação correta depende de executar as migrations posteriores; não há evidência no repositório de qual estado está efetivamente aplicado em cada ambiente.
5. `storage.sql` não cria o bucket `contratos`, enquanto a migration 003 cria. O comportamento completo depende da migration.

Fontes: `src/types/database.ts`, `supabase/schema.sql`, `supabase/homolog_setup.sql` e `supabase/migrations`.

### Implementações parciais ou não comprovadas

1. O envio de e-mail só funciona com `RESEND_API_KEY`; os arquivos `.env` do projeto não declaram essa variável e a dependência `resend` não está instalada.
2. O parser PDF não suporta OCR: PDFs escaneados ficam como rascunho. A extração usa regex e pode depender do layout do DANFE.
3. `confirmarPagamento` do sacado apenas notifica/loga; não recebe upload de comprovante e não liquida a operação.
4. O relatório do gestor é uma tela de consulta; não foi encontrada exportação para arquivo apesar de o manual antigo mencionar relatórios/exportação.
5. `devedores_solidarios` existe no SQL, mas não foi encontrada interface, action ou uso em geração de documentos.
6. Não há testes automatizados no `package.json`; o único artefato de teste encontrado é o script manual do parser PDF.
7. Não há implementação de recuperação de senha, OAuth ou MFA no fluxo da aplicação. O MFA aparece desabilitado na configuração local do Supabase.

### Fragilidades de consistência financeira e transacional

1. Operações de negócio fazem várias gravações sequenciais sem transação explícita. Se uma etapa posterior falhar, podem existir status, vínculos, saldo e auditoria parcialmente atualizados.
2. A atualização de saldo escrow usa padrão “ler saldo, calcular, atualizar”, sem lock/transação no código de `src/lib/actions/operacao.ts`, `src/lib/actions/escrow.ts` e `src/app/api/escrow/sync/route.ts`; concorrência pode causar perda de atualização.
3. `registrarMovimentosLote` em `src/lib/actions/escrow.ts` não rejeita explicitamente saldo negativo para débitos, embora a API HTTP faça essa validação.
4. Em `liquidarOperacao`, o saldo é incrementado pela receita (`valor_bruto_total - valor_liquido_desembolso`), mas o movimento inserido recebe `valor: valor_bruto_total`. Isso deixa o ledger divergente do saldo.
5. `removerNfDaOperacao` permite operação `em_andamento`, recalcula valores e avisa para verificar o saldo, mas não estorna o crédito escrow já realizado.
6. A geração automática do Termo após aprovação é disparada sem bloquear a aprovação e com `catch(() => {})`; falha de geração não é apresentada ao usuário naquele momento.

### Fragilidades de segurança e autorização

1. `/api/contratos/download` exige apenas usuário autenticado e usa service role para assinar qualquer `path` recebido; não há validação de role, entidade ou propriedade do caminho.
2. Algumas Server Actions de gestor verificam apenas autenticação e deixam a autorização efetiva para RLS. Isso ocorre, por exemplo, em partes de `src/lib/actions/gestor.ts`, `src/lib/actions/nota-fiscal.ts` e `src/lib/actions/operacao.ts`; a proteção depende de as policies estarem aplicadas corretamente.
3. Os crons inserem `usuario_id: null` em `logs_auditoria`, mas `supabase/schema.sql` declara a coluna como `NOT NULL REFERENCES profiles(id)`. O código trata o erro apenas como log e pode não registrar auditoria automática.
4. `criarNotificacao` aceita `usuario_id` recebido pelo chamador e usa o cliente de sessão; o isolamento final depende das policies e do contexto da chamada.

### Ausências de TODOs

Não foram encontrados comentários `TODO` ou `FIXME` nos diretórios analisados. Há, porém, comentários de fallback, falha silenciosa e funcionalidades preparadas/desabilitadas nos arquivos citados acima; eles foram tratados como limitações mesmo sem marcador TODO.

## 10. Fluxo técnico completo da principal funcionalidade

O fluxo abaixo acompanha a antecipação de uma NF desde o primeiro acesso até a liquidação.

### Etapa 1 — acesso e criação do perfil

1. `/cadastro` renderiza `src/app/(auth)/cadastro/page.tsx`.
2. O formulário chama `signup` em `src/app/actions/auth.ts`.
3. `cadastroSchema` em `src/lib/validations/auth.ts` valida nome, e-mail, senha e confirmação.
4. `createClient` server-side em `src/lib/supabase/server.ts` chama `auth.signUp`.
5. `handle_new_user` em `supabase/schema.sql` cria `profiles` com role padrão/metadado.
6. Em login, `login` chama `signInWithPassword`, lê `profiles.role` e redireciona.
7. `src/proxy.ts`/`src/lib/supabase/middleware.ts` atualiza cookies, valida sessão e impede acesso a portal de outra role.

### Etapa 2 — onboarding e ativação

1. O cedente acessa `/cedente/cadastro`.
2. A página coleta dados da empresa, representantes e banco.
3. `cadastrarCedente` valida com `cedenteSchema`, insere `cedentes` e `representantes`.
4. `registrarLog` grava `CEDENTE_CADASTRADO`; `notificarGestores` cria aviso.
5. O cedente usa `/cedente/documentos`; `uploadDocumento` valida MIME/tamanho, calcula versão, grava no Storage e cria `documentos`.
6. O gestor usa `/gestor/documentos` ou o detalhe de `/gestor/cedentes/[id]`.
7. `analisarDocumento` atualiza status, motivo, analista e data.
8. `aprovarCedente` confere todos os documentos obrigatórios, altera status e cria `contas_escrow`.

Arquivos: `src/app/cedente/cadastro/page.tsx`, `src/lib/actions/cedente.ts`, `src/app/cedente/documentos/page.tsx`, `src/app/gestor/documentos/page.tsx`, `src/app/gestor/cedentes/[id]/page.tsx` e `src/lib/actions/gestor.ts`.

### Etapa 3 — envio e aprovação da NF

1. O cedente acessa `/cedente/notas-fiscais` e escolhe arquivos.
2. `uploadNFs` processa arquivos em paralelo por `processarArquivo`.
3. XML passa por `parseNFeXML`; PDF passa por `extractDanfeFromPdf`; imagem/PDF não extraído vira rascunho.
4. O arquivo é enviado ao bucket `notas-fiscais` e a NF é criada.
5. O rascunho é editado em `/cedente/notas-fiscais/[id]`; `salvarDadosNF` valida e atualiza.
6. `submeterNF` altera `rascunho` para `submetida` e notifica gestores.
7. O gestor usa `/gestor/notas-fiscais` ou o detalhe; `aprovarNF`, `reprovarNF` ou `solicitarAjusteNF` fazem a transição.

Arquivos: `src/app/cedente/notas-fiscais/page.tsx`, `src/app/cedente/notas-fiscais/[id]/page.tsx`, `src/lib/actions/nota-fiscal.ts`, `src/lib/nf-parser.ts`, `src/lib/pdf-nf-parser.ts`, `src/app/gestor/notas-fiscais/page.tsx` e `src/app/gestor/notas-fiscais/[id]/page.tsx`.

### Etapa 4 — solicitação e aceite

1. `/cedente/operacoes/nova` consulta NFs aprovadas e `taxas_cedente`.
2. A interface calcula estimativas por NF.
3. `solicitarAntecipacao` repete as validações no servidor, calcula totais, cria `operacoes`, cria `operacoes_nfs` e muda NFs para `em_antecipacao`.
4. O sacado consulta `/sacado/aprovacao`.
5. `aprovarCessao`/`aprovarCessaoLote` mudam NFs para `aceita`, ou `contestarCessao` muda para `contestada`.
6. O gestor acompanha em `/gestor/operacoes/[id]`.

Arquivos: `src/app/cedente/operacoes/nova/page.tsx`, `src/lib/actions/operacao.ts`, `src/app/sacado/aprovacao/page.tsx` e `src/lib/actions/sacado.ts`.

### Etapa 5 — aprovação final, documentos e desembolso

1. O gestor informa taxa e valor líquido em `/gestor/operacoes/[id]`.
2. `aprovarOperacao` exige todas as NFs `aceita`, atualiza operação e valores por NF.
3. A página dispara `POST /api/contratos/gerar-termo`; o PDF é criado por Handlebars/Puppeteer e salvo em Storage.
4. O gestor pode selecionar testemunhas via `salvarTestemunhasOperacao`.
5. `POST /api/contratos/gerar-cnab` gera CNAB e salva `remessa_url`; depois `POST /api/contratos/enviar-remessa` envia ao Fromtis.
6. `UploadDocumentoAssinado` envia Termo assinado, notificação assinada e comprovante TED; as actions salvam os paths em `operacoes`.
7. `desembolsarOperacao` exige Termo assinado e comprovante, muda status para `em_andamento`, credita escrow e grava movimento.

Arquivos: `src/app/gestor/operacoes/[id]/page.tsx`, `src/lib/actions/operacao.ts`, `src/components/contratos/UploadDocumentoAssinado.tsx`, `src/app/api/contratos/*/route.ts`, `src/lib/pdf/gerarContrato.ts`, `src/lib/cnab/gerarCnab444.ts` e `src/lib/fromtis/remessa.ts`.

### Etapa 6 — vencimento e encerramento

1. O cron `/api/cron/vencimentos` alerta cedente/sacado/gestor e marca `inadimplente` após o vencimento.
2. O sacado pode clicar em informar pagamento; `confirmarPagamento` apenas notifica o gestor.
3. O gestor confirma em `/gestor/operacoes/[id]`; `liquidarOperacao` muda operação/NFs para liquidadas e lança o crédito.
4. O gestor gera Termo de Quitação em `POST /api/contratos/gerar-quitacao` e pode anexar a versão assinada.

Arquivos: `src/app/api/cron/vencimentos/route.ts`, `src/app/sacado/pagamentos/page.tsx`, `src/lib/actions/sacado.ts`, `src/lib/actions/liquidacao.ts`, `src/app/gestor/operacoes/[id]/page.tsx` e `src/lib/pdf/gerarContrato.ts`.

## 11. Arquivos mais importantes

| Arquivo | Responsabilidade |
|---|---|
| `package.json` | Versões, dependências e scripts |
| `next.config.ts` | Limites de upload, pacotes externos e React Compiler |
| `src/proxy.ts` | Entrada do proxy de sessão |
| `src/lib/supabase/middleware.ts` | Sessão, rotas públicas e roteamento por role |
| `src/lib/supabase/server.ts` | Cliente Supabase com cookies e service role |
| `src/lib/supabase/client.ts` | Cliente Supabase browser |
| `src/app/actions/auth.ts` | Login, signup e logout |
| `src/lib/actions/cedente.ts` | Onboarding e documentos do cedente |
| `src/lib/actions/gestor.ts` | Governança, compliance, fundos e acessos |
| `src/lib/actions/nota-fiscal.ts` | Ciclo de vida das NFs |
| `src/lib/actions/operacao.ts` | Ciclo da antecipação e desembolso |
| `src/lib/actions/sacado.ts` | Aceite, contestação e aviso de pagamento |
| `src/lib/actions/liquidacao.ts` | Liquidação/inadimplência |
| `src/lib/actions/escrow.ts` | Ledger e sincronização de saldo |
| `src/lib/actions/auditoria.ts` | Logs de auditoria |
| `src/lib/actions/notificacao.ts` | Notificações e e-mail opcional |
| `src/lib/nf-parser.ts` | Parser XML de NF-e |
| `src/lib/pdf-nf-parser.ts` | Parser heurístico de DANFE PDF |
| `src/lib/pdf/gerarContrato.ts` | Contratos, termos, PDFs e Storage |
| `src/lib/cnab/gerarCnab444.ts` | Layout CNAB 444 |
| `src/lib/fromtis/remessa.ts` | ZIP e chamada SOAP Fromtis |
| `src/components/auth/portal-layout.tsx` | Shell autenticado dos portais |
| `src/components/auth/sidebar.tsx` | Menus e roles |
| `src/components/contratos/*` | Geração/download/upload de documentos |
| `supabase/schema.sql` | Schema base, funções, trigger e RLS base |
| `supabase/migrations/003...016` | Estado incremental após o schema base |
| `src/types/database.ts` | Tipagem consumida pelos clientes Supabase; atualmente incompleta em relação às migrations |
| `vercel.json` | Crons e duração das funções de contrato |

## 13.2 Atualizacao apos a Fase 2

A Fase 2 adicionou a migration `supabase/migrations/20260721123935_fase2_nucleo_multifundo_politicas_snapshot.sql`. Ela cria `cedente_fundos`, preserva `cedentes.fundo_id`, faz backfill apenas para vinculos legados com fundo informado e marca operacoes anteriores como `legado_inferido` ou `legado_indefinido`. O campo legado continua sendo sincronizado nas acoes de vinculo em `src/lib/fundos/cedente-fundo.ts` e `src/lib/actions/gestor.ts`.

Politicas, versoes e requisitos documentais configuraveis estao em `politicas_operacionais`, `politica_operacional_versoes` e `politica_requisitos_documentais`. A autoridade server-side esta em `src/lib/actions/politica.ts`; apenas uma politica ativa pode existir por vinculo, e a publicacao encerra a versao vigente anterior. Prazos ficam nos requisitos documentais. A interface de gestor esta em `src/app/gestor/politicas/page.tsx` e no menu de `src/components/auth/sidebar.tsx`.

Novas solicitacoes de antecipacao resolvem o vinculo e a politica ativa em `src/lib/operacoes/politica.ts`, montam snapshot imutavel e hash SHA-256 e gravam o contexto em `src/lib/actions/operacao.ts`. A politica pode manter o aceite do sacado obrigatorio ou registrar o status `dispensado`; o roteamento e a exigencia historica das NFs aceitas continuam preservados para a Fase 4. O snapshot rejeita chaves de segredo e nao armazena credenciais.

As quatro tabelas novas possuem RLS e grants explicitos para o Data API na migration. O acesso de gestor e de administracao; cedentes e consultores podem apenas consultar os vinculos/politicas de sua carteira. A API nao expoe acesso de sacado a configuracao. Os testes novos estao em `src/lib/fundos/cedente-fundo.test.ts` e `src/lib/operacoes/politica.test.ts`. A validacao do TypeScript e dos testes passou; a validacao SQL aplicada ao banco remoto/homolog nao foi executada nesta etapa.

## 12. Resumo executivo

O BW Antecipa é uma aplicação Next.js com quatro portais sobre Supabase. O cedente passa por onboarding e compliance, envia NFs e solicita antecipação. O gestor valida documentos/NFs, espera o aceite do sacado, define termos, gera documentos, desembolsa e acompanha liquidação ou inadimplência. O sacado confirma/contesta cessões e informa pagamentos. O consultor consulta carteira, operações, escrow e comissões.

Os pontos fortes são a separação por roles, RLS, Storage privado, auditoria, fluxo de NF com XML/PDF, geração de documentos, CNAB/Fromtis, crons de vencimento e notificações Realtime/polling. O build e o lint atuais passam sem erro.

Os pontos de atenção são a defasagem entre tipos TypeScript, schema base e migrations; a ausência de testes automatizados; parser PDF heurístico sem OCR; e-mail opcional não ativado pelos `.env` versionados; gravações financeiras não transacionais; divergência de valor no movimento de liquidação; remoção de NF em operação já desembolsada sem estorno; cron que tenta inserir auditoria com usuário nulo; e download de contrato que aceita qualquer path para usuário autenticado.

Antes de alterar o sistema, deve-se entender que o comportamento real depende de aplicar schema base e migrations na ordem correta, que RLS é parte essencial da autorização, que `src/types/database.ts` não representa todo o banco atual, que operações escrow não estão encapsuladas em transações e que a geração de documentos usa service role e runtime Chromium. Qualquer mudança no ciclo de status de NF/operação, nos saldos, nos buckets ou nas policies deve ser revisada em conjunto no frontend, Server Actions, Route Handlers, SQL e templates.

## 13.1 Atualização após a Fase 1

A Fase 1 adicionou a tipagem consolidada do schema base mais as migrations existentes em `src/types/database.ts` e centralizou enums/status de domínio em `src/lib/types/domain.ts`. A relação de consultor usada pelo frontend foi alinhada ao nome existente no banco, `consultor_cedente`, em `src/app/consultor/carteira/page.tsx`, `src/app/consultor/dashboard/page.tsx` e `src/app/consultor/relatorios/page.tsx`.

As verificações server-side reutilizáveis estão em `src/lib/auth/authorization.ts`, incluindo autenticação, perfil, role de gestor, acesso a cedente, operação e NF. Elas foram aplicadas às actions e Route Handlers sensíveis de gestor, operação, NF, sacado, testemunhas, fundos, contratos, CNAB e remessa.

`GET /api/contratos/download` não recebe mais um path arbitrário. Ele recebe `tipo_entidade`, `entidade_id` e `tipo_documento`, busca o campo de Storage registrado na entidade, valida vínculo/role e só então gera a signed URL: `src/app/api/contratos/download/route.ts`. Os componentes de download foram atualizados em `src/components/contratos/BotaoDownloadContrato.tsx`, `src/components/contratos/UploadDocumentoAssinado.tsx` e nos consumidores correspondentes.

Os logs passaram a diferenciar `usuario`, `sistema`, `integracao` e `cron`, com `usuario_id` nullable, `origem` e `ator_identificador`. A mudança está na migration `supabase/migrations/20260720203009_fase1_auditoria_atores_origem.sql`; a gravação tipada está em `src/lib/actions/auditoria.ts` e `src/lib/auth/audit-actor.ts`; os crons e a API escrow usam ator explícito.

Foi criada uma base Vitest (`vitest.config.ts`, script `npm test`) com testes de autenticação/role, igualdade exata de paths registrados e atores de auditoria. A dívida transacional financeira está documentada em `docs/technical-debt-financial-transactions.md`; desembolso, liquidação e escrow não foram refatorados.

Na validação desta fase, `tsc`, testes, build e lint direcionado aos arquivos alterados passaram. O lint global ainda acusa erros preexistentes em telas/scripts não alterados, principalmente regras React Compiler do Next.js 16 e `require()` legado; eles permanecem como pendência fora do escopo. A validação SQL local não pôde ser executada porque não havia PostgreSQL local disponível em `127.0.0.1:54322`.
