# Relatório — Multi-CNPJ do Cedente

## Objetivo

Separar o relacionamento comercial (`Cedente`) das pessoas jurídicas operacionais (`Matriz` e `Filiais`), permitindo que diferentes CNPJs do mesmo Cedente emitam NFs com conta bancária e checklist próprios, sem duplicar fundos, políticas ou histórico.

## Fluxo

```text
Cedente
  └─ Matriz aprovada
       ├─ Filial aprovada
       ├─ conta bancária própria
       └─ checklist próprio

XML/PDF/manual → CNPJ emitente oficial → estabelecimento canônico
              → gate estabelecimento + matriz + Cedente + vínculo + Fundo
              → Storage/INSERT da NF
              → operação no nível do Cedente
```

## Segurança e integridade

- O frontend não escolhe `estabelecimento_id`; o servidor e o trigger derivam pelo CNPJ.
- No XML, o CNPJ vem de `NFe.infNFe.emit.CNPJ`; no DANFE com chave, ele é derivado das posições fiscais da chave. O fallback para a Matriz existe somente no fluxo legado sem emissor oficial e é revalidado no preenchimento antes da submissão.
- RLS restringe o Cedente aos próprios registros e o Gestor aos Cedentes vinculados a fundos autorizados.
- Usuário `super_admin` puro não recebe acesso operacional por essa modelagem.
- Todas as mutações usam RPCs controladas, com logs de auditoria.
- A suspensão preserva registros históricos e bloqueia apenas novas originações.

## Compatibilidade

`cedentes.cnpj` não foi removido. A migration converte cada CNPJ legado válido em matriz, replica a conta principal e associa NFs históricas compatíveis. O contrato antigo permanece legível durante a transição.

## Limite deliberado

A política de misturar CNPJs em uma única operação não foi definida. O conjunto é coletado pelo domínio e marcado como `FUTURE_DECISION_RULE_1`, sem bloqueio ou autorização implícita.

## Validação

A migration `20260818200641_multi_cnpj_cedente_estabelecimentos.sql` foi aplicada exclusivamente em homologação (`fhgkmggthxikfpogrvaa`) pelo fluxo controlado do Supabase CLI. Produção não foi acessada.

O pós-flight confirmou:

- migration historicizada;
- um estabelecimento Matriz para cada Cedente existente;
- nenhum CNPJ duplicado;
- nenhuma NF existente sem estabelecimento vinculável;
- RLS habilitada nas três novas tabelas;
- seis RPCs públicas controladas disponíveis.

A matriz E2E transacional concluiu `18/18 PASS` e foi revertida ao final (`ROLLBACK`), sem preservar massa sintética. Foram validados Matriz/Filial, conta bancária, checklist, vínculo herdado com Fundo, bloqueios de origem, auditoria e isolamento de Cedente, Gestor, `super_admin` puro e `anon`.

Os gates locais concluíram:

- TypeScript: PASS;
- testes automatizados: PASS;
- lint: PASS, sem erros (seis avisos preexistentes fora deste escopo);
- build Next.js: PASS;
- `git diff --check`: PASS;
- `npm audit --omit=dev --audit-level=high`: PASS, zero vulnerabilidades;
- varredura de segredos nos 25 arquivos alterados: PASS, sem padrão de credencial encontrado (`gitleaks` não estava disponível; foi usado o verificador local restrito aos arquivos da entrega).

## Parecer

A arquitetura está apta a operar múltiplos CNPJs por Cedente em homologação. A regra jurídica/operacional sobre misturar estabelecimentos na mesma operação continua explicitamente adiada em `FUTURE_DECISION_RULE_1`; nenhuma permissão ou proibição foi inferida nesta entrega.
