# P13 — correção do upload de DANFE escaneado e das recargas da listagem

Data da certificação: 22/09/2026

Ambiente certificado: homologação

Commit homologado: `e03c2325c74e709d3e2cdcd474bc5fd6790bc80b`

Parecer: **correção aprovada para promoção seletiva a produção, condicionada à configuração segura da chave OpenAI no ambiente Production**.

## 1. Incidente

PDFs de DANFE sem camada textual, incluindo documentos TADMEDICAL, não eram
interpretados de forma consistente pelo OCR local. Em lotes maiores, o caminho de
renderização de PDF, OCR e leitura de código aumentava o tempo e o tamanho da função
serverless. Paralelamente, cada arquivo importado invalidava a rota de Notas Fiscais,
provocando novas requisições RSC para a listagem, links de detalhes e itens da sidebar.

Também foi observado que o fallback por IA podia retornar o CNPJ do destinatário sem
a razão social. A consulta de CNPJ existente estava restrita ao cadastro e o `fetch`
server-side genérico recebia `HTTP 429` da BrasilAPI.

## 2. Causa raiz

1. O parser tentava renderizar o PDF e executar OCR local antes do fallback externo.
2. O upload em lote processava cada arquivo por Server Action, mas cada ação bem-sucedida
   executava `revalidatePath`, multiplicando recargas e prefetches automáticos.
3. Links visíveis da sidebar e dos detalhes das NFs eram prefetchados novamente após
   cada invalidação.
4. O importador persistia diretamente `razao_social_destinatario`; não havia ligação
   com o serviço server-side de consulta de CNPJ.
5. A BrasilAPI limitava o cliente HTTP genérico por ausência de identificação do
   consumidor.

## 3. Correção implementada

### 3.1 Extração de PDFs

- PDFs com camada textual válida continuam no parser determinístico P12.
- PDF sem texto, com texto insuficiente ou sem âncoras fiscais segue diretamente para
  a Responses API.
- A requisição usa PDF em alta resolução, resposta JSON estrita, `store: false`,
  timeout controlado, confiança mínima e no máximo uma repetição.
- A chave de acesso, datas, valor total, emitente e destinatário continuam sujeitos aos
  gates determinísticos antes da persistência.
- Erros remotos são convertidos em códigos seguros, sem corpo da resposta, token ou
  conteúdo fiscal nos logs.
- O OCR local de PDF e suas dependências pesadas não fazem parte do release de produção.

### 3.2 Nome do destinatário

- O nome legível no documento tem prioridade e não gera consulta externa.
- Quando o nome está ausente e o CNPJ é válido, a importação consulta a BrasilAPI no
  servidor e completa `razao_social_destinatario` antes do upload e do `INSERT`.
- Consultas concorrentes do mesmo CNPJ são compartilhadas.
- Respostas positivas ficam em cache no runtime por seis horas; falhas ficam em cache
  por um minuto para evitar repetição em cascata.
- A indisponibilidade do serviço público não bloqueia a criação do rascunho.
- O cliente server-side passou a enviar `User-Agent` identificado, eliminando o `429`
  indevido reproduzido durante o diagnóstico.

### 3.3 Desempenho da interface

- Cada arquivo permanece isolado em uma Server Action, com concorrência limitada a
  duas requisições, evitando exceder o limite do runtime.
- A listagem é atualizada uma única vez ao fim de um lote bem-sucedido.
- Upload unitário abre diretamente o rascunho sem refresh intermediário.
- O prefetch automático foi desativado na sidebar e nos links de detalhes de NFs.
- O Realtime legítimo de notificações foi preservado; ele atualiza estado local e não
  era a origem das recargas em cadeia.

## 4. Configuração operacional

Obrigatória no ambiente Production da Vercel:

- `OPENAI_API_KEY`

Controles opcionais já suportados:

- `OPENAI_NF_FALLBACK_ENABLED` — kill switch; valor `false` desativa o fallback;
- `OPENAI_NF_MODEL` — sobrescreve o modelo padrão do código;
- `OPENAI_NF_TIMEOUT_MS` — timeout entre 5 e 60 segundos;
- `OPENAI_NF_MIN_CONFIDENCE` — confiança mínima entre 0,5 e 1.

A chave deve permanecer somente nas variáveis server-side da Vercel. Não deve usar
prefixo `NEXT_PUBLIC_`, ser registrada em documentação, logs ou Git.

## 5. Evidências de homologação

- Upload real de 20 NFs TADMEDICAL concluído com 20 rascunhos visíveis.
- CNPJ `11.344.038/0021-41` enriquecido como `INSTITUTO NACIONAL DE TECNOLOGIA E SAUDE`.
- Valores, datas de emissão e vencimento foram apresentados na listagem.
- A validação manual foi confirmada pelo responsável como sucesso total.
- NF real `279775.pdf` passou pelo fallback OpenAI e pela consulta de CNPJ sem
  persistência no teste técnico isolado.
- CI de homologação `35738019195` aprovado para o commit `e03c232`.

## 6. Validações automatizadas

| Validação | Resultado |
|---|---:|
| Testes focados do parser, upload, observabilidade e CNPJ | aprovados |
| Teste real OpenAI + BrasilAPI com NF 279775 | aprovado |
| Suíte completa Vitest em homologação | 2.207 aprovados; 12 ignorados |
| Suíte completa na árvore seletiva de produção | 2.203 aprovados; 12 ignorados |
| TypeScript | aprovado |
| Lint | zero erros; três avisos preexistentes |
| Build Next.js de produção | aprovado |
| `git diff --check` | aprovado |

## 7. Banco, Storage e migrations

- Nenhuma migration foi criada ou aplicada.
- Nenhuma tabela, função, policy, RLS ou grant foi alterado.
- O teste real isolado não persistiu registros nem acessou Storage.
- O fluxo normal continua armazenando apenas arquivos aprovados pelos gates fiscais.

## 8. Riscos residuais e controles

1. Sem `OPENAI_API_KEY`, PDFs sem texto falham de forma segura e permanecem na fila;
   PDFs com texto e XML continuam no fluxo determinístico.
2. OpenAI e BrasilAPI são dependências externas; timeout, kill switch, cache e
   comportamento fail-safe limitam o impacto de indisponibilidade.
3. O envio à OpenAI ocorre somente quando a camada textual não é suficiente.
4. O smoke de produção deve ser realizado por um cedente real autorizado, sem criar
   massa improvisada, e deve confirmar importação, nome do sacado e ausência de rajada
   de requisições RSC.

## 9. Promoção e rollback

- Base de produção anterior: `db644c7bb934f0c7ea85639b0142fdc7bf740049`.
- A promoção deve transportar apenas o escopo P13 certificado, sem merge integral de
  `homolog`, scripts QA ou mudanças financeiras.
- Não há etapa de banco no rollout.
- Rollback: redeploy do commit anterior e, se necessário, desativação imediata do
  fallback por `OPENAI_NF_FALLBACK_ENABLED=false`.

## 10. Parecer

`P13_PDF_AI_FALLBACK = PASS`

`P13_RECIPIENT_CNPJ_ENRICHMENT = PASS`

`P13_UPLOAD_RSC_PERFORMANCE = PASS`

`P13_HOMOLOG_REAL_FLOW = PASS`

`P13_DATABASE_CHANGE = NONE`

`P13_READY_FOR_SELECTIVE_PRODUCTION_ROLLOUT = YES`
