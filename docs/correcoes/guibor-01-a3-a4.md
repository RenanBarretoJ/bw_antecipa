# GUIBOR A3/A4 — NFS-e visual e revisão fiscal

## Diagnóstico e decisões

`GUIBOR_A3_VISUAL_DIAGNOSIS_COMPLETE = YES`

O fallback existente em `src/lib/danfe/openai-pdf-fallback.server.ts` aceita
apenas `nfe_danfe`, exige chave NF-e com 44 dígitos e DV, e aplica coerência
de emissão com a chave. Não serve ao DANFSe v2.0. Esse arquivo não foi alterado.

A amostra B não fornece texto nativo suficiente. O novo caminho primeiro
classifica PDFs sem texto suficiente e, somente com fingerprint positivo,
executa o contrato `nfse_danfse_v2`. Texto completo usa `danfse_v2_labels`.
Contradições textuais não são reparadas por IA. Chave NFS-e tem validação de
formato de 50 dígitos, não autenticação fiscal nem decodificação de offsets NF-e.

O provider continua na Responses API, modelo configurável por `OPENAI_NF_MODEL`
(mesmo default do fallback NF-e), `store: false`, schema JSON estrito, até 20 MB
e timeout de 5–60 segundos por chamada. A classificação e extração são chamadas
separadas; não há repetição automática de extração ambígua. Campos são novamente
validados deterministicamente, inclusive CNPJ, datas, labels e aritmética.
Referências: [PDF inputs](https://developers.openai.com/api/docs/guides/file-inputs),
[Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

## Persistência

Preferência 1 adotada: sem vencimento, a ação retorna `REQUIRES_REVIEW` e
**não grava NF nem Storage**. O navegador mantém o arquivo e exige data manual
sem default. No reenvio, o servidor reextrai o mesmo arquivo e revalida o escopo;
não confia em valores fiscais devolvidos pelo cliente.

Migration nova `20260929154656_guibor_nfse_fiscal_provenance.sql` adiciona tipo,
origem do líquido, origem do vencimento e proveniência. Mantém vencimento NOT NULL,
unicidade textual da chave e todas as RLS existentes. Não há backfill. Registros
legados continuam sem provenance certificada. O líquido ausente fica NULL.

Trigger de auditoria registra actor, NF, data anterior (NULL/MISSING no upload),
nova data, timestamp e origem MANUAL na mesma transação. Fatos fiscais importados
não podem ser convertidos em valores calculados na revisão. Alteração de
vencimento fica restrita ao rascunho e às permissões existentes.

O dispatcher de upload exige `NFSE_UPLOAD_ENABLED=true`, configurado somente no
deployment de validação/homolog. Nenhuma habilitação em produção nesta etapa.
O documento-base PDF também possui validação NFS-e dedicada, sem passar a chave
de 50 dígitos pelo parser NF-e. Compensação NFS-e verifica falhas de limpeza e
as comunica, sem marcar remoção silenciosamente como bem-sucedida.

## Evidência local (Node 22.23.3)

- TypeScript: PASS.
- Suíte completa: 2419 PASS, 12 SKIP preexistentes; 282 arquivos PASS, 3 SKIP.
- Direcionados parser/visual/persistência/batch: 128 PASS, 1 SKIP.
- Lint: zero erros, aviso preexistente em `liquidacao.ts`.
- Build Next.js: PASS.
- Docker com cópia isolada e permissões preservadas: 16 assertions PASS
  (audit, líquido, NOT NULL, legado, Cedente/OPERADOR/Gestor, LEITOR e escopos).

Scripts reproduzíveis: `scripts/qa/guibor/database-smoke.mjs` (LOCAL somente),
`scripts/qa/guibor/visual-real.ts` (somente env homolog, sem writes de banco).
PDFs reais, credenciais e relatórios detalhados ficam fora do Git.

## Checkpoint antes do remoto

Amostra A real foi certificada no baseline textual A1/A2. O pipeline visual da
amostra B e os smokes autenticados A/B ainda **não** estão certificados.
A chave do provider em homolog é sensitive e não pode ser extraída via CLI;
a validação real será executada no deployment remoto autorizado.

`GUIBOR_A3_A4_HOMOLOG_READY = NO` até todos os smokes, CI e cleanup passarem.
`GUIBOR_PRODUCTION_CHANGED = NO`.
P17, comissão, política de base, CERC, Vórtx e RLX Email não foram alterados.

## STOP — pós-check de homolog em 29/09/2026

A migration aditiva foi aplicada **somente** em `fhgkmggthxikfpogrvaa`, com
guards transacionais de presença de P17 e fingerprints de dados antes/depois.
Nenhuma alteração em notas, operações ou contagem de auditoria foi permitida
pelo envelope. Não houve criação de usuários/NFs QA nem upload em homolog.

O script novo `scripts/qa/guibor/apply-homolog.mjs` detectou hash divergente no
campo `supabase_migrations.schema_migrations.statements[1]`. Investigação
somente leitura confirmou a causa: `String.replace` recebeu uma string de
substituição contendo o SQL, interpretando sequências especiais `$` na cópia
armazenada no histórico. O texto histórico corresponde exatamente a essa
expansão. **Não é divergência dos corpos das funções aplicadas:** ambos foram
comparados com o arquivo local e são idênticos. As quatro constraints também
foram comparadas por hash com Docker (`cb407fc63d660f169452df184f1258af`).

- Hash fonte normalizada: `6764965cb3be144ff3604f7aa294aafc62e90270a72d2a4d7104689571e31d76`.
- Hash cópia no histórico: `baf58d462397d739f1370c0ea13d7d348936bb52671bcf125ab52f6cb696c69a`.
- `data_vencimento` continua NOT NULL; zero registros NFS-e no alvo.
- Nenhuma correção automática do histórico foi feita após o STOP.
- Push, PR, Preview e promoção de código para homolog **não executados**.
- Tentativa de configuração branch-specific na Vercel não foi aplicada:
  branch ainda não existe no remoto. Não foram modificadas variáveis globais.
- Commits locais: `6604740` (A1/A2), `ecb0dc2` (A3), `b2c9490` (A4).

Próxima ação depende de liberação após o STOP: corrigir o envelope usando função
de substituição (sem expansão de `$`), restaurar **somente** o texto da nova
entrada de histórico, condicionado ao hash atual conhecido, conferir novamente
funções/constraints/hash e então retomar Preview e smokes reais. Não reaplicar
DDL, não editar migration já aplicada, não executar `db push` global.

Evidência detalhada ignorada no Git:
`rehearsal/reports/GUIBOR_A3_A4_POSTFLIGHT_STOP.json`.
As cópias Docker isoladas permanecem locais para diagnóstico; todos os registros
de fixture dos testes foram revertidos por ROLLBACK. Cleanup remoto QA não teve
objetos a remover.

## Status obrigatório no STOP

PASS abaixo identifica evidência local quando indicado; FAIL em gates remotos
significa **não certificado/não executado**, não um resultado inventado de smoke.
O PDF B real ainda não passou pelo novo pipeline.

```text
GUIBOR_A3_VISUAL_DIAGNOSIS_COMPLETE = YES
GUIBOR_A3_NFSE_DOCUMENT_KIND = PASS
GUIBOR_A3_VISUAL_CONTRACT = PASS
GUIBOR_A3_NFE_CONTRACT_PRESERVED = PASS
GUIBOR_A3_NFSE_KEY_VALIDATION = PASS
GUIBOR_A3_VISUAL_FAIL_CLOSED = PASS
GUIBOR_A3_VISUAL_PROVENANCE = PASS
GUIBOR_A3_OBSERVABILITY_REDACTED = PASS
GUIBOR_NFSE_TEXT_PDF = PASS
GUIBOR_NFSE_IMAGE_PDF = FAIL
GUIBOR_NFSE_FILE_A_REAL = PASS
GUIBOR_NFSE_FILE_B_REAL = FAIL
GUIBOR_A4_NET_VALUE_EXPLICIT = PASS
GUIBOR_A4_NET_VALUE_NO_GROSS_COPY = PASS
GUIBOR_A4_NET_VALUE_PROVENANCE = PASS
GUIBOR_A4_LEGACY_HISTORY_PRESERVED = PASS
GUIBOR_NFSE_DUE_DATE_SOURCE = MANUAL
GUIBOR_A4_NO_TODAY_FALLBACK = PASS
GUIBOR_A4_MANUAL_DUE_DATE_UI = FAIL
GUIBOR_A4_MANUAL_DUE_DATE_REQUIRED = PASS
GUIBOR_A4_MANUAL_DUE_DATE_AUDIT = PASS
GUIBOR_A4_DISPATCHER_ENABLED = NO
GUIBOR_A4_DUPLICATION = FAIL
GUIBOR_A4_STORAGE_INTEGRITY = FAIL
GUIBOR_A4_RLS = PASS
GUIBOR_PARSER_REGRESSION_MK = PASS
GUIBOR_PARSER_REGRESSION_BAHIAMED = PASS
GUIBOR_PARSER_REGRESSION_GENERIC = PASS
GUIBOR_PARSER_REGRESSION_XML = PASS
GUIBOR_A3_A4_MIGRATION_REQUIRED = YES
GUIBOR_A3_A4_FEATURE_TESTS = PASS
GUIBOR_A3_A4_CI = FAIL
GUIBOR_A3_A4_PREVIEW = FAIL
GUIBOR_A3_A4_HOMOLOG = FAIL
GUIBOR_A3_A4_HOMOLOG_CLEANUP = PASS
GUIBOR_A3_A4_HOMOLOG_READY = NO
GUIBOR_A3_A4_P17_CHANGED = NO
GUIBOR_COMMISSION_CHANGED = NO
GUIBOR_BASE_POLICY_CHANGED = NO
GUIBOR_PRODUCTION_CHANGED = NO
RLX_VORTX_CHANGED = NO
CERC_CHANGED = NO
RLX_EMAIL_CHANGED = NO
```

RLS/audit acima foram executados no Docker isolado; validação autenticada remota
continua pendente. UI está implementada, mas o smoke visual remoto está pendente.
Duplicação/Storage têm proteções implementadas e regressões NF-e locais PASS;
o ciclo NFS-e real remoto ainda não foi certificado. A real refere-se somente à
extração textual A1/A2, não à persistência/smoke homolog A4.
