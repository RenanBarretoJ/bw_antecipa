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
