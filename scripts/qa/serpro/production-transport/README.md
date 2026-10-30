# Adaptador de aplicação seletiva — R48

Biblioteca de manutenção sem CLI, rota, cron, leitor de `.env` ou obtenção de
credenciais. Importar estes módulos não abre conexão. Não é parte do runtime
operacional da aplicação, não ativa SERPRO e não substitui autenticação/MFA/RLS.

## Separação de responsabilidades

- `contract.mjs`: plano imutável, frescor do GO/preflight, fingerprint do
  adaptador, alvo literal, allowlist A/B e envelope por arquivo. Reutiliza os
  hashes, fontes e timeouts R46 sem alterar os guards antigos.
- `connection.mjs`: cliente `pg` dedicado, configurações explícitas, CA pinada,
  verificação de cadeia/hostname, TLS e vínculos de conexão/plano em memória.
  Sem connection string, opções de driver arbitrárias ou retry.
- `inspection.mjs` e `catalog.sql`: identidade da sessão, permissões de
  manutenção, contrato nativo de histórico, coorte S1 por cutoff, provider OFF
  e fingerprints de catálogo esperados antes/depois de cada arquivo.
- `journal.mjs`: composição do journal R46 com sidecar de plano exclusivo,
  cadeia de hashes, fsync e vínculo ao run/GO/projeto/fonte/transporte.
- `executor.mjs`: reserva de sessão, guard e inspeção na mesma transação,
  arquivo+linha nativa atômicos, COMMIT separado e observação independente.

`preparePlan` verifica a estrutura e o frescor de um **registro declarado pelo
operador**. Não autentica a origem humana desse registro, não verifica uma
assinatura de aprovação e não consulta Vercel/Supabase para renovar atestados.
O chamador de manutenção continua responsável pela autorização real e pelas
evidências autoritativas indicadas pelos hashes. Um arquivo de plano ou hash
autodeclarado nunca é, sozinho, permissão para executar em produção.

## Condições de execução futura

O único destino produtivo previsto é a conexão direta do projeto de produção
declarado no contrato, branch `main`, porta 5432, database `postgres`, com CA
aprovada e identificação de database/session/effective role conferida no servidor.
O modo de certificação usa exclusivamente hostname `.test.invalid`, bancos
`r48_*`, ator sintético e runner Docker. Não há fallback automático entre modos,
hosts, poolers ou usuários.

Um futuro chamador precisará fornecer um plano completo e aprovado, os bytes
originais A/B, CA e senha por canal privado autorizado, factory e journal novos.
Não há exemplo executável de produção nem leitor automático de credenciais.
Nenhum GO remoto está implícito nesta implementação ou em seus testes locais.

## Atomicidade e parada

Cada arquivo mantém DDL e seu `version/name/statements/created_by` na mesma
transação. As outras colunas nativas são preservadas com seus defaults. Não
existe `applied_at` inventado, repair, atualização do histórico ou replay.
O par A+B não é uma transação única.

B só começa depois do ACK de COMMIT de A e da observação independente esperada.
Falta de ACK, falha do postflight ou expiração depois de enviar COMMIT resulta
em `COMMIT_OUTCOME_UNKNOWN`, mesmo que uma leitura posterior encontre A salvo.
Isso nunca promove automaticamente o journal nem autoriza replay/continuação.
A confirmado e B falhou exige nova decisão de recuperação, não resume automático.

O catálogo observado é um escopo explícito de tabelas/funções/schemas, não uma
auditoria integral da instância. O hash da coorte inclui apenas registros até o
cutoff aprovado; novas importações não podem ser confundidas com alteração dessa
coorte histórica. As flags OFF do plano são atestados, não leituras de runtime.

## Validação local

Teste offline, sem conexão nem credenciais reais:

```powershell
node --test scripts/qa/serpro/production-transport/adapter.test.mjs
```

Os ensaios TLS/Postgres usam harness privado identificado nos relatórios locais,
duas stacks novas, certificados/usuários/NFs sintéticos, redes internas e zero
portas publicadas. As fixtures negativas introduzem erros de forma controlada
para provar recusa; isso não autoriza alterações de ACL ou configuração remotas.

CI do SHA anterior, build ou smoke da aplicação não certificam este diff ainda
sem commit. Publicação, prova read-only do canal real e aplicação seletiva exigem
GOs separados. `SQL_GO=false` até decisão explícita posterior.
