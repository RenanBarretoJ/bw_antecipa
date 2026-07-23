# Estabilização técnica pós-auditoria — BW Antecipa

Data: 23/07/2026  
Branch analisada: `homolog`  
Commit-base local antes desta estabilização: `2469f8a`

## 1. Objetivo

Esta etapa estabiliza pontos técnicos identificados após as fases recentes, sem criar nova funcionalidade de negócio. O foco foi reduzir risco de inconsistência parcial em fluxos financeiros/documentais, alinhar a documentação ao comportamento real do código e deixar uma trilha objetiva de validação para homologação.

## 2. Baseline encontrado

O repositório já continha alterações pendentes antes desta etapa, principalmente nos fluxos de upload de NF/XML, documentos v2, requisitos logísticos, status pós-cessão e migrations recentes.

Arquivos pendentes relevantes no baseline:

- `src/lib/actions/nota-fiscal.ts`
- `src/lib/actions/documento-v2.ts`
- `src/lib/documentos-v2/*`
- `src/lib/notas-fiscais/*`
- `src/app/cedente/notas-fiscais/page.tsx`
- `src/app/gestor/operacoes/[id]/page.tsx`
- migrations `20260722191000` a `20260723125851`

Essas alterações foram preservadas e não revertidas.

## 3. Decisões técnicas

### Solicitação de operação agora possui base transacional

Antes, a criação de uma operação dependia de múltiplas escritas feitas pela aplicação:

```text
Action
 ↓
insert operacoes
 ↓
insert operacoes_nfs
 ↓
update notas_fiscais
 ↓
logs/notificações
```

Se uma etapa intermediária falhasse, havia risco de registro parcial. A estabilização adicionou uma RPC para concentrar as escritas críticas no banco:

```text
Action
 ↓
RPC solicitar_operacao_antecipacao_atomica
 ↓
lock/validação de cedente, vínculo, fundo, política, escrow e NFs
 ↓
insert operacoes + vínculo NFs + update status NF + auditoria
 ↓
retorno idempotente
```

Arquivos:

- `supabase/migrations/20260723134849_estabilizacao_operacoes_atomicas_cnab_compensacao.sql`
- `src/lib/actions/operacao.ts`
- `src/lib/operacoes/idempotencia.ts`
- `src/types/database.ts`

### Aprovação de operação agora possui base transacional

Antes, a aprovação calculava valores e atualizava operação/NFs em passos separados na aplicação. A estabilização moveu a escrita crítica para `aprovar_operacao_atomica`, com lock da operação e das NFs associadas.

A action continua executando validações funcionais antes da RPC, mas a RPC é a fonte de verdade para persistência atômica da aprovação.

Arquivos:

- `supabase/migrations/20260723134849_estabilizacao_operacoes_atomicas_cnab_compensacao.sql`
- `src/lib/actions/operacao.ts`

### Idempotência da solicitação

Foi adicionada uma chave determinística de idempotência para solicitação de antecipação. A chave considera:

- usuário;
- cedente;
- vínculo `cedente_fundo`;
- versão de política;
- conjunto ordenado e deduplicado de NFs.

Isso evita duplicidade em retry/reenvio da mesma solicitação.

Arquivos:

- `src/lib/operacoes/idempotencia.ts`
- `src/lib/operacoes/idempotencia.test.ts`
- `supabase/migrations/20260723134849_estabilizacao_operacoes_atomicas_cnab_compensacao.sql`

### CNAB com compensação de Storage

Storage não participa de transação SQL. Por isso, após upload da remessa CNAB, falhas de insert/associação/update agora disparam compensação removendo o arquivo enviado e limpando registros parciais.

Fluxo estabilizado:

```text
gerar arquivo
 ↓
upload Storage
 ↓
insert remessas_cnab
 ↓
insert remessas_cnab_operacoes
 ↓
update operacao
```

Se falhar depois do upload:

```text
erro SQL
 ↓
remove arquivo do bucket remessas-cnab
 ↓
remove registros parciais possíveis
 ↓
registra log de falha de compensação, se houver
```

Arquivo:

- `src/app/api/contratos/gerar-cnab/route.ts`

### CNAB exige configuração publicada para novas remessas

A documentação da Fase 7 foi ajustada para refletir a decisão operacional atual: novas remessas devem usar configuração CNAB publicada no fundo. A compatibilidade legado ocorre pela importação do padrão legado para uma versão inicial, não por fallback silencioso durante geração nova.

Arquivo:

- `docs/fase-7-relatorio-executivo-arquitetural.md`

### Branding residual

Foi removido resíduo de `BW Antecipa` no cabeçalho de e-mail e no remetente padrão de desenvolvimento, usando `BETTER WITH`.

Arquivo:

- `src/lib/email.ts`

## 4. Migração criada

Arquivo:

- `supabase/migrations/20260723134849_estabilizacao_operacoes_atomicas_cnab_compensacao.sql`

Principais mudanças:

- adiciona `operacoes.solicitacao_idempotency_key`;
- cria índice único parcial para idempotência;
- cria `solicitar_operacao_antecipacao_atomica`;
- cria `aprovar_operacao_atomica`;
- restringe execução das RPCs a `authenticated`;
- usa `SECURITY DEFINER` com `SET search_path = public`;
- valida papel do usuário via `public.get_user_role()`;
- valida contexto do fundo/vínculo/política/NFs antes de persistir.

## 5. Segurança e RLS

As RPCs possuem validações explícitas de:

- usuário autenticado;
- papel esperado (`cedente` para solicitação, `gestor` para aprovação);
- cedente pertencente ao usuário autenticado na solicitação;
- vínculo `cedente_fundos` ativo;
- fundo ativo;
- política operacional publicada e compatível com o vínculo;
- NFs pertencentes ao mesmo cedente, vínculo e fundo;
- status elegível das NFs;
- operação elegível para aprovação.

Observação importante: a validação de policies RLS em banco real não pôde ser executada localmente, pois o projeto não possui Supabase local em execução neste ambiente.

## 6. Validações executadas

Executado com sucesso:

- `npx tsc --noEmit`
- `npm test -- --run`
- `npm run lint`

Resultado dos testes:

- 16 arquivos de teste;
- 71 testes aprovados.

Resultado do lint:

- 0 erros;
- 27 warnings já existentes/fora do escopo principal desta estabilização.

Validações Supabase tentadas:

- `npx supabase --version`: `2.88.1`;
- `npx supabase status`: bloqueado por ausência do Docker Desktop/Linux engine;
- `npx supabase migration list --local`: bloqueado por ausência de Postgres local em `127.0.0.1:54322`.

## 7. O que não foi possível comprovar localmente

Não foi possível executar localmente:

- aplicação real das migrations;
- `supabase db lint` conectado a banco;
- validação RLS com usuários reais;
- smoke ponta a ponta em banco homolog;
- concorrência real em sequenciais/locks;
- execução das novas RPCs contra Supabase homolog.

Motivo: este repositório não possui Supabase local ativo neste ambiente e não foram usadas credenciais de homologação pelo Codex.

## 8. Checklist obrigatório para homologação

- [ ] Aplicar migrations pendentes em homolog, incluindo `20260723134849_estabilizacao_operacoes_atomicas_cnab_compensacao.sql`.
- [ ] Executar `select`/chamada RPC de solicitação com usuário cedente real.
- [ ] Confirmar que retry da mesma solicitação retorna replay idempotente.
- [ ] Executar aprovação com gestor real.
- [ ] Confirmar que retry da aprovação retorna replay idempotente.
- [ ] Confirmar logs de auditoria `OPERACAO_SOLICITADA` e `OPERACAO_APROVADA`.
- [ ] Gerar CNAB com configuração publicada.
- [ ] Simular falha controlada após upload CNAB e confirmar compensação do arquivo.
- [ ] Validar RLS de `cedentes`, `cedente_fundos`, `fundos`, `notas_fiscais`, `operacoes`, `operacoes_nfs`, `remessas_cnab`.
- [ ] Validar operação legado apenas como consulta/histórico, sem geração nova sem configuração publicada.
- [ ] Reexecutar build no mesmo ambiente do deploy.

## 9. Riscos residuais

- A migration ainda precisa ser aplicada e validada em banco real.
- RPCs usam `SECURITY DEFINER`; apesar das validações internas, devem ser revisadas com dados reais e policies habilitadas.
- A compensação de Storage é best-effort: se a remoção do arquivo falhar, o erro é logado, mas exige ação operacional posterior.
- Concorrência de aprovação/solicitação deve ser homologada em Postgres real.
- A documentação CNAB foi alinhada ao comportamento atual, mas o layout ainda depende de homologação externa com administrador/custodiante.

## 10. Parecer técnico

A estabilização reduziu os maiores riscos de inconsistência parcial em solicitação, aprovação e geração CNAB. O sistema ficou mais seguro para homologação assistida, mas ainda não deve ser considerado pronto para produção sem aplicar migrations em homolog, executar testes com usuários reais, validar RLS e comprovar comportamento das RPCs em banco real.
