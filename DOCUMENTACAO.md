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
3.  **Status** (com labels na UI):
    *   `rascunho`: Criada via PDF/Imagem, aguardando dados.
    *   `submetida`: Aguardando análise do Gestor.
    *   `em_analise`: Em revisão pelo Gestor.
    *   `aprovada` → exibida como **"Validada"**: Disponível para antecipação (validada pelo Gestor).
    *   `em_antecipacao`: Incluída em operação, aguardando aprovação do Sacado.
    *   `aceita` → exibida como **"Aprovado pelo Sacado"**: Sacado aprovou a cessão.
    *   `contestada`: Sacado contestou a cessão.
    *   `liquidada`: Operação encerrada, sacado pagou.
    *   `cancelada`: NF inválida ou recusada.

### C. Operação de Antecipação — Fluxo Completo

O fluxo de uma operação é dividido em etapas claras com responsabilidades separadas:

```
NF submetida
  └─▶ Gestor valida → NF "Validada" (status: aprovada)
       └─▶ Cedente solicita antecipação → Operação criada (status: solicitada)
            └─▶ NFs vão para em_antecipacao → Sacado aprova cessão (individual ou em lote)
                 └─▶ NF status: aceita ("Aprovado pelo Sacado")
                      └─▶ Gestor define taxa e termos → clica "Aprovar e Seguir"
                           └─▶ Operação status: aprovada
                                ├─▶ Termo de Cessão gerado automaticamente
                                ├─▶ Gestor gera CNAB
                                ├─▶ Gestor faz upload: Termo Assinado + Comprovante TED
                                └─▶ Gestor clica "Desembolsar" (requer ambos os docs)
                                     └─▶ Operação status: em_andamento
                                          └─▶ Conta Escrow creditada, Cedente notificado
                                               └─▶ Gestor confirma recebimento do sacado
                                                    └─▶ Operação status: liquidada
```

**Status possíveis de uma Operação:**
| Status | Descrição |
| :--- | :--- |
| `solicitada` | Criada pelo cedente, aguarda análise do gestor. |
| `em_analise` | Gestor está revisando os termos. |
| `aprovada` | Gestor aprovou os termos. Aguarda upload de docs e desembolso. |
| `em_andamento` | Desembolso realizado. Aguardando pagamento do sacado. |
| `liquidada` | Sacado pagou. Operação encerrada. |
| `inadimplente` | Sacado não pagou no prazo. |
| `reprovada` | Gestor rejeitou a operação. |
| `cancelada` | Operação cancelada. |

**Pré-requisitos para o botão "Desembolsar":**
- Todos os termos definidos (taxa, valor líquido, testemunhas)
- Todas as NFs com status `aceita` (aprovação do sacado)
- `termo_assinado_url` preenchido (Termo de Cessão assinado enviado)
- `comprovante_pagamento_url` preenchido (comprovante TED ao cedente enviado)

### D. Aprovação de Cessão pelo Sacado
O sacado acessa `/sacado/aceite` (**Aprovação de Cessão**) onde pode:
- **Filtrar** NFs por cedente, vencimento (de/até) e valor (mín/máx).
- **Aprovar individualmente** cada NF.
- **Aprovar em lote**: seleciona múltiplas NFs via checkbox e clica "Aprovar N NFs".
- **Contestar** individualmente com motivo obrigatório.

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
| `/gestor/notas-fiscais` | Validação/Reprovação de NFs submetidas. |
| `/gestor/operacoes` | Painel de controle: definição de termos, aprovação e desembolso. |
| `/gestor/escrow` | Gestão de saldos e movimentações das contas escrow. |
| `/gestor/auditoria` | Logs de todas as ações críticas realizadas no sistema. |
| `/gestor/relatorios` | Exportação de dados para contabilidade e gestão. |

### 👤 Área do Sacado (`/sacado`)
| Rota | Funcionalidade |
| :--- | :--- |
| `/sacado/dashboard` | Visão geral de NFs cedidas e valores a pagar. |
| `/sacado/notas-fiscais` | Listagem de NFs recebidas com filtros de status. |
| `/sacado/aceite` | **Aprovação de Cessão** — aprovação individual ou em lote com filtros. |
| `/sacado/notificacoes` | Notificações de cessão de crédito e avisos do sistema. |

---

## 5. Estrutura de Pastas e Scripts Chave

### `src/lib/actions/` (Regras de Negócio)
*   `operacao.ts`: Criação, aprovação (2 etapas), desembolso e liquidação de antecipações.
    *   `solicitarAntecipacao`: Cedente cria operação com NFs selecionadas.
    *   `aprovarOperacao`: Gestor define termos e aprova (status → `aprovada`). Sem desembolso.
    *   `desembolsarOperacao`: Valida docs obrigatórios, credita escrow (status → `em_andamento`).
    *   `reprovarOperacao`: Gestor reprova, NFs retornam para `aprovada`.
*   `nota-fiscal.ts`: Processamento de arquivos, parsing e aprovação de NFs.
*   `sacado.ts`: Aprovação e contestação de cessão, incluindo aprovação em lote (`aceitarCessaoLote`).
*   `liquidacao.ts`: Confirmação de liquidação e marcação de inadimplência.
*   `gestor.ts`: Análise de documentos e ativação de cedentes.
*   `auditoria.ts`: Engine de registro de logs de eventos (`registrarLog`).

### `src/lib/pdf/gerarContrato.ts`
*   Gera o **Termo de Cessão** em PDF via Puppeteer + Handlebars.
*   Acionado automaticamente após "Aprovar e Seguir".
*   Template: `src/templates/contratos/termo-cessao.html`.

### `src/lib/cnab/gerarCnab444.ts`
*   Gera arquivo de remessa CNAB 444 para o banco (BB).
*   Acionado manualmente pelo gestor na tela de operação aprovada.

### `src/lib/nf-parser.ts`
*   Utiliza regex para extrair dados estruturados de XMLs da NF-e.

### `supabase/` (Infraestrutura)
*   `schema.sql`: Definição de tabelas, enums e políticas RLS.
*   `storage.sql`: Buckets privados e políticas de acesso.
*   `migrations/`: Alterações incrementais de schema (001–007).

---

## 6. Modelo de Dados (Tabelas Principais)

*   `profiles`: Centraliza usuários e roles.
*   `cedentes`: Dados da empresa, conta bancária e URLs de contratos.
*   `notas_fiscais`: Registro individual de cada documento fiscal.
    *   Coluna `aprovacao_sacado_em`: timestamp do momento em que o sacado aprovou a cessão.
*   `operacoes`: Agrupamento de NFs em uma solicitação de antecipação.
    *   `termo_assinado_url`: Caminho do Termo de Cessão assinado (obrigatório para desembolso).
    *   `comprovante_pagamento_url`: Comprovante do TED ao cedente (obrigatório para desembolso).
*   `operacoes_nfs`: Tabela de junção entre operações e NFs.
*   `contas_escrow`: Ledger financeiro por cedente.
*   `movimentos_escrow`: Histórico de débitos e créditos por conta.
*   `testemunhas`: Cadastro global de testemunhas para o Termo de Cessão.
*   `logs_auditoria`: Rastreabilidade total do sistema.

---

## 7. Histórico de Migrations

| Arquivo | Descrição |
| :--- | :--- |
| `001_*` | Schema inicial. |
| `002_*` | Buckets de storage. |
| `003_*` | Configuração de storage por ambiente. |
| `004_aceite_sacado_em.sql` | Adicionou coluna `aceite_sacado_em` em `notas_fiscais`. |
| `005_testemunhas.sql` | Tabela `testemunhas` e FKs em `operacoes`. |
| `006_documentos_assinados.sql` | Colunas `termo_assinado_url` e `comprovante_pagamento_url` em `operacoes`. |
| `007_rename_aceite_sacado_em.sql` | Renomeia `aceite_sacado_em` → `aprovacao_sacado_em` em `notas_fiscais`. |

---
*Última atualização: 2026-04-23*
