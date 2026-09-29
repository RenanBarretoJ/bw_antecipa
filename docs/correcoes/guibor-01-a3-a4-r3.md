# GUIBOR A3/A4 R3 — certificação de persistência

Escopo autorizado em 29/09/2026: Local, Preview `prnudoydwiramsxjnxzn` e homolog após todos os gates. Produção proibida. PR #71 continua draft.

## Correções anteriores à certificação remota

- Recibo server-only de revisão: ator, cedente/vínculo/fundo, hash do PDF e fingerprint dos fatos fiscais. O cliente recebe apenas o identificador opaco junto ao resumo de revisão.
- Nova extração é comparada à primeira; divergência material bloqueia sem Storage. A primeira chamada não aceita vencimento manual para pular revisão.
- Autorização e sessão/MFA são verificadas novamente após o parser. Nenhuma escrita de NF troca o cliente autenticado por service role.
- Reserva CAS e índice único de identidade fiscal precedem Storage. `PROCESSING` e `CLEANUP_PENDING` conservam o caminho/ID reservado para reconciliação; não expiram silenciosamente.
- NF e auditoria manual continuam na mesma transação de insert/trigger A4. Provenance aponta para o recibo. Exclusão legítima de um rascunho libera a identidade, preservando o recibo.
- Quando a política exige PDF no repositório documental, somente sua cópia canônica permanece; a cópia inicial é compensada. Consulta de original resolve o hash documental pelo contexto autorizado, sem caminho fornecido pelo cliente.
- Migração nova `20260929174520`; a anterior `20260929154656` não foi editada nem reaplicada remotamente.

## Evidência local

- Node 22.23.3; 106 testes focados PASS.
- Suíte com dois workers: 2469 PASS, 12 skipped (285 arquivos PASS, 3 skipped).
- Primeira execução paralela: asserção estática de SELECT desatualizada (corrigida mantendo autorização antes de Storage), e timeout de 5s no teste de boleto inválido; segunda suíte completa com concorrência limitada passou sem alterar o parser de boleto.
- SQL em Docker: grants/RLS, CAS, identidade entre dois recibos, bloqueio de cleanup pendente e check de conclusão PASS. Fixtures em transação com rollback.
- As duas migrações aditivas foram instaladas no banco Docker local; não houve alteração de dados operacionais. O `COMMIT` interno da migração A4 encerrou o envelope inicialmente aberto, portanto a instalação local não foi revertida. A transação de fixtures foi revertida normalmente.

## Gates remotos

Pendentes nesta revisão documental: Preview A/B após vencimento, audit, duplicidade, Storage, matriz Auth/MFA, UI responsiva, CI/build e homolog. Não extrapolar o PASS de review do R2 para persistência.

GUIBOR_A3_A4_HOMOLOG_READY=NO

GUIBOR_PRODUCTION_CHANGED=NO; P17_CHANGED=NO; RLX_VORTX_CHANGED=NO; CERC_CHANGED=NO; RLX_EMAIL_CHANGED=NO.
