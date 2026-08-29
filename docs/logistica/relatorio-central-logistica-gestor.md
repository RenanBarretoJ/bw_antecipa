# Central de Acompanhamento Logístico — Gestor

## Objetivo

A Central consolida, por fundo ativo, a situação física e documental das notas
fiscais que possuem contexto logístico. A tela é exclusivamente de leitura e
não altera upload, análise, aprovação, postergação, vínculo CT-e × NF ou qualquer
gate operacional existente.

Rota: `/gestor/logistica`.

## Arquitetura

```text
Sessão do gestor
  ↓
Fundo ativo autorizado (usuario_fundos)
  ↓
Carregador agregado em lotes
  ├─ notas e operações
  ├─ snapshots imutáveis da política
  ├─ entregas e prazos
  ├─ requisitos documentais
  ├─ evidências antecipadas
  ├─ versões e análises documentais
  ├─ CT-es e relações N:N
  └─ memórias logísticas de criação/aprovação
  ↓
Projeção de domínio
  ↓
Filtros, métricas e paginação no servidor
  ↓
Página do gestor / CSV
```

A implementação foi separada em:

- `tipos.ts`: contrato serializável da Central;
- `filtros.ts`: normalização fechada dos parâmetros da URL;
- `dominio.ts`: classificação, datas, prazos, métricas e agregações puras;
- `central-logistica.server.ts`: autorização e consultas em lote;
- `CentralLogisticaView.tsx`: apresentação e interações locais;
- `exportar/route.ts`: exportação CSV sujeita à mesma autorização e filtros.

## Universo acompanhado

Uma NF é incluída quando possui ao menos uma evidência confiável de contexto
logístico: política/snapshot aplicável, entrega materializada, requisito
logístico, evidência antecipada, memória imutável de classificação, CT-e
relacionado ou comprovante de entrega. Políticas sem logística e notas sem
qualquer evidência logística não entram no universo.

## Fontes de verdade e regras

### Status físico atual

A classificação reutiliza `classificarStatusLogisticoPreCessao`:

1. comprovante de entrega aprovado → `ENTREGUE`;
2. caso contrário, CT-e/DACTE aprovado → `EM_TRANSITO`;
3. sem evidência aprovada → `INDETERMINADA`.

O status não é inferido pela mera existência de arquivo, pelo status da operação
ou somente pela entrega materializada.

### Status histórico

Os campos “na criação” e “na aprovação” vêm exclusivamente de
`operacao_nf_logistica_memorias`. Memória ausente é apresentada como “—”; não é
reconstruída retroativamente.

### Data da cessão

Ordem de resolução:

1. `nota_fiscal_entregas.cessao_efetivada_em`;
2. `operacoes.cessao_efetivada_em`;
3. `operacoes.aprovado_em`, somente quando o snapshot congelado determina cessão
   na aprovação (`cessao_no_desembolso = false`).

`created_at` não é utilizado como cessão.

### Momento documental

O momento considera sempre o primeiro upload preservado:

- upload anterior à cessão → `ANTECIPADO`;
- upload igual ou posterior → `POS_CESSAO`;
- cessão ou upload ausente → `INDETERMINADO`.

A diferença é calculada em dias civis UTC. Primeira versão, versão atual, versão
aprovada e data da aprovação permanecem conceitos separados.

### Conformidade documental

Conformidade não é confundida com status físico. Cada família documental mantém
status próprio: não enviado, aguardando análise, aprovado ou rejeitado. Prazos
originais e novas previsões continuam visíveis separadamente.

## Interface

A página possui:

- resumo de quantidade e valor por status;
- indicadores documentais e de envio antecipado;
- visões rápidas;
- filtros persistidos na URL;
- abas Visão geral, Notas fiscais, Pendências e CT-es;
- paginação de 20, 50 ou 100 itens;
- detalhe das NFs relacionadas a cada CT-e N:N;
- ação única “Ver NF” nas linhas operacionais;
- CSV do conjunto filtrado.

O CSV não contém UUIDs internos, hashes, caminhos de Storage ou credenciais.

## Segurança e isolamento multifundo

- a sessão é validada por `requireGestor`;
- o fundo é resolvido por `resolverContextoFundoGestor`;
- o cookie de fundo é apenas preferência e precisa corresponder a um vínculo
  ativo em `usuario_fundos`;
- todas as consultas usam o cliente autenticado e respeitam RLS;
- não há `service_role` nem cliente administrativo;
- nenhuma URL assinada, hash, conteúdo documental ou histórico completo é
  carregado na listagem;
- somente os itens da página atual são enviados ao navegador.

## Desempenho

As consultas dependentes são executadas em lotes, sem `select` por linha e sem
`map(async)`. As tabelas que podem exceder o limite do PostgREST são percorridas
em páginas estáveis. A projeção e os filtros ficam no servidor.

No volume atual de homologação, a abordagem evita N+1 e limita o payload do
navegador. Se o fundo crescer para dezenas de milhares de NFs logísticas, deve-se
avaliar uma read model/RPC paginada no banco, preservando exatamente o contrato de
domínio desta camada.

## Testes e riscos residuais

Os testes cobrem resolução da cessão, momento do documento, precedência do
comprovante, separação entre versões, busca por CT-e, agregação N:N, autorização,
ausência de `service_role`, ausência de N+1 e payload mínimo.

Riscos residuais:

- memórias históricas ausentes permanecem indeterminadas por decisão de domínio;
- NFs antigas sem fundo/vínculo consistente não entram no fundo ativo;
- a exportação reflete o estado no instante da requisição e não representa um
  snapshot contábil persistido;
- smoke test autenticado depende de usuário e MFA válidos no ambiente alvo.

## Homologação recomendada

- [ ] validar gestor com dois fundos e alternar o fundo ativo;
- [ ] confirmar que nenhuma NF do outro fundo aparece na tela ou no CSV;
- [ ] comparar uma NF entregue, uma em trânsito e uma indeterminada com o detalhe;
- [ ] validar memórias de criação e aprovação existentes;
- [ ] validar CT-e relacionado a múltiplas NFs sem duplicar valor;
- [ ] testar filtros combinados, busca por chave CT-e e paginação;
- [ ] conferir prazos originais e postergados;
- [ ] testar temas claro/escuro e largura móvel;
- [ ] comparar CSV com o filtro visível.
