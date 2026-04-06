# Documentação Técnica - BW Antecipa

Este documento fornece uma visão completa da arquitetura, fluxos de negócio, rotas e funcionalidades do projeto **BW Antecipa**.

---

## 1. Visão Geral
O **BW Antecipa** é uma plataforma de **Antecipação de Recebíveis**. Ela atua como intermediária (ou fundo) que permite que empresas (**Cedentes**) antecipem o recebimento de valores de suas vendas a prazo (representadas por **Notas Fiscais**) mediante uma taxa de desconto.

### Termos Chave:
*   **Cedente**: Empresa que emitiu a NF e deseja antecipar o valor.
*   **Sacado**: Empresa que comprou do cedente e deve pagar a NF no vencimento.
*   **Gestor**: Administrador da plataforma que analisa riscos e aprova operações.
*   **Conta Escrow**: Conta virtual segura onde o dinheiro da antecipação é creditado e de onde as liquidações são geridas.

---

## 2. Stack Tecnológica
*   **Frontend**: Next.js 15+ (App Router, Server Components).
*   **Backend & DB**: Supabase (PostgreSQL, Auth, Storage).
*   **Lógica de Negócio**: Server Actions (em `src/lib/actions`).
*   **Parser de NF**: Utilitário personalizado para leitura de XML de NF-e (`src/lib/nf-parser.ts`).
*   **Estilização**: Tailwind CSS + Shadcn/UI.

---

## 3. Fluxos de Negócio Principais

### A. Onboarding do Cedente
1.  **Cadastro**: Criado via Supabase Auth.
2.  **Documentação**: O cedente envia documentos obrigatórios (Contrato Social, CNPJ, etc.).
3.  **Análise**: O Gestor revisa os documentos. Todos devem estar "aprovados" para o cedente ser ativado.
4.  **Ativação**: Ao ativar, uma **Conta Escrow** é criada automaticamente para o cedente.

### B. Ciclo de Vida da Nota Fiscal (NF)
1.  **Upload**: O cedente sobe XML (parse automático) ou PDF/Imagem (requer preenchimento manual).
2.  **Validação**: O sistema valida se o CNPJ emitente da NF é o mesmo do cedente logado.
3.  **Status**: 
    *   `rascunho`: Criada via PDF/Imagem, aguardando dados.
    *   `submetida`: Aguardando análise do Gestor.
    *   `aprovada`: Disponível para antecipação.
    *   `cancelada/reprovada`: NF inválida ou recusada.

### C. Operação de Antecipação
1.  **Solicitação**: O cedente seleciona NFs `aprovadas` e envia para antecipação.
2.  **Cálculo**: O sistema estima o valor líquido baseado na taxa de desconto configurada para aquele cedente.
3.  **Desembolso**: O Gestor aprova a operação, mudando o status para `em_andamento` e creditando o valor na conta escrow do cedente.
4.  **Cessão**: O Sacado é notificado formalmente sobre a cessão do crédito.

---

## 4. Mapa de Rotas e Funcionalidades

### 🔐 Autenticação (`/login`, `/signup`)
*   Fluxo gerenciado pelo Supabase Auth.
*   Criação automática de `profile` no banco via trigger PostgreSQL.

### 🏢 Área do Cedente (`/cedente`)
| Rota | Funcionalidade |
| :--- | :--- |
| `/cedente/dashboard` | Visão geral de saldos, NFs em análise e operações recentes. |
| `/cedente/cadastro` | Formulário de dados cadastrais da empresa e representantes. |
| `/cedente/documentos` | Upload e acompanhamento de documentos de compliance. |
| `/cedente/notas-fiscais` | Upload de XML/PDF e gestão de notas fiscais. |
| `/cedente/operacoes` | Solicitação de antecipação e histórico de operações. |
| `/cedente/extrato` | Movimentações financeiras da Conta Escrow (Créditos/Débitos). |
| `/cedente/notificacoes` | Alertas de aprovação/reprovação e mensagens do sistema. |

### 🛠️ Área do Gestor (`/gestor`)
| Rota | Funcionalidade |
| :--- | :--- |
| `/gestor/dashboard` | KPI do sistema: total antecipado, NFs pendentes, inadimplência. |
| `/gestor/cedentes` | Listagem e aprovação de novos cadastros de empresas. |
| `/gestor/documentos` | Análise detalhada de documentos enviados pelos cedentes. |
| `/gestor/notas-fiscais` | Aprovação/Reprovação de NFs submetidas. |
| `/gestor/operacoes` | Painel de controle para aprovar desembolsos de antecipação. |
| `/gestor/escrow` | Gestão de saldos e movimentações das contas escrow. |
| `/gestor/auditoria` | Logs de todas as ações críticas realizadas no sistema. |
| `/gestor/relatorios` | Exportação de dados para contabilidade e gestão. |

### 👤 Área do Sacado (`/sacado`)
*   **`/sacado/dashboard`**: Visualização de Notas Fiscais cedidas que ele deve pagar.
*   **`/sacado/notificações`**: Recebimento de notificações de cessão de crédito.

---

## 5. Estrutura de Pastas e Scripts Chave

### `src/lib/actions/` (Regras de Negócio)
*   `operacao.ts`: Criação, aprovação e fluxo financeiro de antecipações.
*   `nota-fiscal.ts`: Processamento de arquivos, parsing e aprovação de NFs.
*   `gestor.ts`: Análise de documentos e ativação de cedentes.
*   `auditoria.ts`: Engine de registro de logs de eventos (`registrarLog`).

### `src/lib/nf-parser.ts` (Inteligência de Parsing)
*   Utiliza regex para extrair dados estruturados de XMLs da NF-e (Tags: `ide`, `emit`, `dest`, `ICMSTot`, `dup`).

### `supabase/` (Infraestrutura)
*   `schema.sql`: Definição detalhada de tabelas, enums (roles, status) e segurança RLS.
*   `storage.sql`: Configuração de Buckets (arquivos privados por CNPJ) e políticas de acesso.

---

## 6. Modelo de Dados (Tabelas Principais)
*   `profiles`: Centraliza usuários e roles.
*   `cedentes`: Dados da empresa e conta bancária.
*   `notas_fiscais`: Registro individual de cada documento fiscal.
*   `operacoes`: Agrupamento de NFs em uma solicitação de antecipação.
*   `contas_escrow`: Ledger financeiro por cedente.
*   `logs_auditoria`: Rastreabilidade total do sistema.

---
*Gerado automaticamente para consulta da equipe técnica.*
