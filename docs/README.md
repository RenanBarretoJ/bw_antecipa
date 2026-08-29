# Documentação do BW Antecipa

Este diretório separa a documentação técnica por domínio. Os manuais de uso são
mantidos exclusivamente em [`manual/`](manual/) e não devem ser misturados com
relatórios de implementação, diagnósticos ou procedimentos de engenharia.

## Arquitetura e modelagem

- [`architecture/data-model-v2.md`](architecture/data-model-v2.md) — modelo de dados e decisões arquiteturais da Fase 1.5.
- [`architecture/plano-tecnico-multifundo-fase-0.md`](architecture/plano-tecnico-multifundo-fase-0.md) — plano técnico do fluxo multifundo.

## Banco de dados

- [`database/migration-dependency-graph.md`](database/migration-dependency-graph.md) — dependências entre migrations.
- [`database/relatorio-escopo-9d-reconciliacao-migrations.md`](database/relatorio-escopo-9d-reconciliacao-migrations.md) — reconciliação das migrations.
- [`database/relatorio-escopo-9e-bootstrap-clean-room.md`](database/relatorio-escopo-9e-bootstrap-clean-room.md) — reconstrução clean-room.
- [`database/schema-diff-homolog-vs-clean.md`](database/schema-diff-homolog-vs-clean.md) — comparação inicial de schemas.
- [`database/schema-diff-homolog-vs-clean-final.md`](database/schema-diff-homolog-vs-clean-final.md) — comparação final de schemas.
- `database/*.json` — manifests gerados para análise e bootstrap.

## Desenvolvimento e padrões

- [`development/engineering-standards.md`](development/engineering-standards.md) — regras permanentes de engenharia.
- [`development/notificacoes-toast.md`](development/notificacoes-toast.md) — padrão global de notificações.
- [`development/paginacao-e-cursores.md`](development/paginacao-e-cursores.md) — paginação e cursores.
- [`development/performance-escopo-7-dashboards-relatorios.md`](development/performance-escopo-7-dashboards-relatorios.md) — dashboards e relatórios.
- [`development/requisitos-documentais-politica.md`](development/requisitos-documentais-politica.md) — requisitos documentais de políticas.

## Design

- [`design/design-system.md`](design/design-system.md) — tokens, componentes e direção visual.

## CNAB

- [`cnab/cnab-field-mapping.md`](cnab/cnab-field-mapping.md) — mapeamento posicional do CNAB.
- [`cnab/fase-7-relatorio-executivo-arquitetural.md`](cnab/fase-7-relatorio-executivo-arquitetural.md) — arquitetura da Fase 7.

## Integrações

- [`integracoes/fase-8-portal-fidc.md`](integracoes/fase-8-portal-fidc.md) — integração Portal FIDC por fundo.

## Segurança

- [`seguranca/fase-9-mfa-hardening-seguranca.md`](seguranca/fase-9-mfa-hardening-seguranca.md) — MFA e hardening pré-produção.
- [`seguranca/recuperacao-senha-supabase.md`](seguranca/recuperacao-senha-supabase.md) — recuperação de senha no Supabase Auth.
- [`seguranca/relatorio-mfa-sessao-24h.md`](seguranca/relatorio-mfa-sessao-24h.md) — validade de MFA por sessão.

## Homologação e operação técnica

- [`homologacao/estabilizacao-tecnica-pos-auditoria.md`](homologacao/estabilizacao-tecnica-pos-auditoria.md) — estabilização pós-auditoria.
- [`homologacao/fase-10-homologacao-producao.md`](homologacao/fase-10-homologacao-producao.md) — preparação para produção.
- [`homologacao/relatorio-massa-central-logistica.md`](homologacao/relatorio-massa-central-logistica.md) — massa da Central Logística.
- [`homologacao/reset-operacional-fundo-homolog.md`](homologacao/reset-operacional-fundo-homolog.md) — reset operacional de fundo em homologação.

## Performance

- [`performance/performance-escopo-1-operacoes-elegibilidade.md`](performance/performance-escopo-1-operacoes-elegibilidade.md)
- [`performance/performance-escopo-2-onboarding-cedentes.md`](performance/performance-escopo-2-onboarding-cedentes.md)
- [`performance/performance-escopo-3-notas-documentos-gestor.md`](performance/performance-escopo-3-notas-documentos-gestor.md)
- [`performance/performance-escopo-4-portal-sacado.md`](performance/performance-escopo-4-portal-sacado.md)
- [`performance/performance-escopo-5-auditoria-historicos-notificacoes.md`](performance/performance-escopo-5-auditoria-historicos-notificacoes.md)
- [`performance/performance-escopo-6-cedentes-escrow-seletores.md`](performance/performance-escopo-6-cedentes-escrow-seletores.md)
- [`performance/relatorio-escopo-9b-isolamento-rls.md`](performance/relatorio-escopo-9b-isolamento-rls.md)
- [`performance/relatorio-escopo-9c-bloqueadores-9a2.md`](performance/relatorio-escopo-9c-bloqueadores-9a2.md)
- [`performance/relatorio-final-rota-performance.md`](performance/relatorio-final-rota-performance.md)
- [`performance/relatorio-homologacao-escopo-9a.md`](performance/relatorio-homologacao-escopo-9a.md)
- [`performance/relatorio-homologacao-escopo-9a-retomada.md`](performance/relatorio-homologacao-escopo-9a-retomada.md)
- [`performance/relatorio-homologacao-escopo-9a-final.md`](performance/relatorio-homologacao-escopo-9a-final.md)

## Logística

- [`logistica/relatorio-acompanhamento-logistico-operacao.md`](logistica/relatorio-acompanhamento-logistico-operacao.md)
- [`logistica/relatorio-central-logistica-gestor.md`](logistica/relatorio-central-logistica-gestor.md)
- [`logistica/relatorio-envio-antecipado-documentos-logisticos.md`](logistica/relatorio-envio-antecipado-documentos-logisticos.md)
- [`logistica/relatorio-postergacao-upload-canhoto.md`](logistica/relatorio-postergacao-upload-canhoto.md)

## Financeiro

- [`financeiro/relatorio-metodos-calculo-operacao.md`](financeiro/relatorio-metodos-calculo-operacao.md) — métodos de cálculo por operação.
- [`financeiro/technical-debt-financial-transactions.md`](financeiro/technical-debt-financial-transactions.md) — dívida técnica das transações financeiras.

## Auditoria e comunicações

- [`auditoria/historico-operacional.md`](auditoria/historico-operacional.md) — histórico operacional unificado.
- [`comunicacoes/relatorio-motor-alertas-cobrancas.md`](comunicacoes/relatorio-motor-alertas-cobrancas.md) — motor de alertas e cobranças por e-mail.

## Storage e documentos

- [`storage/relatorio-upload-documentos-assinados-operacao.md`](storage/relatorio-upload-documentos-assinados-operacao.md) — upload de documentos assinados.

## Diagnósticos e correções

- [`analises/`](analises/) — diagnósticos técnicos anteriores à implementação.
- [`correcoes/`](correcoes/) — relatórios de correções e estabilizações concluídas.

## Manuais de uso

Os manuais funcionais permanecem em [`manual/`](manual/) e são mantidos como uma
coleção independente para gestor, cedente, sacado e consultor.

## Convenção para novos documentos

- Use a pasta do domínio correspondente; evite adicionar documentos técnicos na raiz de `docs/`.
- Registre diagnósticos em `analises/` e correções concluídas em `correcoes/`.
- Mantenha procedimentos de ambiente em `homologacao/` e regras de desenvolvimento em `development/`.
- Não mova relatórios técnicos para `manual/` e não use essa pasta para documentação de engenharia.
