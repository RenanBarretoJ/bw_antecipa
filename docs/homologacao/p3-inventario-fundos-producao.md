# P3 — Inventário dos fundos e decisões operacionais

Fonte: clone local sanitizado do dump original de produção, reconstruído e migrado pela cadeia canônica. Nenhum segredo foi consultado ou registrado.

## DLZ FIDC

- ID: `7a114257-7816-468e-adf4-d796b93364df`;
- CNPJ: `62.342.629/0001-77`;
- status: ativo;
- Cedentes vinculados: 10;
- operações históricas: 45;
- NFs históricas: 903;
- operações Fromtis históricas: 26;
- termos históricos: 42;
- notificações históricas: 38;
- políticas publicadas no modelo novo: 0;
- templates publicados: 0;
- CNAB publicado: 0;
- integrações publicadas: 0;
- execuções financeiras/risco no modelo novo: 0.

Conclusão: o histórico prova uso de Fromtis e documentos jurídicos legados, mas não prova os parâmetros atuais necessários para criar uma configuração versionada. Códigos originadores, conta, carteira, templates, política e credenciais exigem homologação humana. O histórico não foi convertido retroativamente.

## IMPULSE CREDIT I FIDC NP

- ID: `cb372689-65c8-43af-8a20-7438002a3b91`;
- CNPJ: `54.760.649/0001-30`;
- status: ativo;
- Cedentes vinculados: 0;
- operações: 0;
- NFs: 0;
- histórico Fromtis: 0;
- políticas, templates, CNAB e integrações publicadas: 0;
- execuções financeiras/risco: 0.

Conclusão: não existe histórico suficiente para inferir adapter, política, templates, banco, conta, código originador, provider ou gates financeiros. Toda configuração requer decisão formal do negócio.

## Cedentes sem fundo

| Cedente | ID | Status | Operações/NFs | Classificação | Decisão |
|---|---|---|---:|---|---|
| BIOLOGICA DISTRIBUIDORA MEDICO HOSPITALAR LTDA | `382fab89-936b-4ff9-b4fe-edbfab0fa7f4` | pendente | 0 / 0 | onboarding pendente | `DECISAO_OPERACIONAL_PENDENTE` |
| HOSPITAL DE OLHOS BARUERI LTDA | `c3df4597-25a8-4b50-ae83-fadada7170e4` | pendente | 0 / 0 | onboarding pendente | `DECISAO_OPERACIONAL_PENDENTE` |

Ambos possuem acesso ativo, mas não possuem `fundo_id` legado, operação, NF ou `cedente_fundos`. Não há evidência inequívoca para escolher DLZ ou IMPULSE. Nenhum patch de vínculo foi criado.

## Comparação com homologação

A homologação foi consultada somente em leitura. Não existe fundo DLZ ou IMPULSE com configuração aprovada que possa ser promovida por equivalência. Os fundos RAIZ/RLX e fixtures QA pertencem a outros contextos e não podem servir como fonte automática.

## Decisões necessárias

1. indicar o fundo correto de cada Cedente pendente;
2. aprovar a política operacional de cada fundo;
3. aprovar os templates jurídicos e golden files;
4. confirmar adapter, layout, código originador e dados bancários;
5. confirmar provider, capabilities e referências de credenciais;
6. decidir se risco/exposição financeira é aplicável a cada fundo.
