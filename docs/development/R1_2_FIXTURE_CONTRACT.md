# R1.2 — fixture documental local

Antes do rerun: 227 hashes R1 iguais ao checkpoint; seis adições R1.1
registradas em `rehearsal/reports/R1_2_WORKTREE_BEFORE.json`.
Migration R1.1 preservada com SHA-256
`74ba5ff87d70ffd16a1aac4ac0be8d3c4c032454c1d0bec360567ee18f27cc0b`.

## FIXTURE_DOCUMENT_TYPES

| Código / ID sintético | Contrato oficial | Necessidade |
| --- | --- | --- |
| nf_xml / f1200000-0000-4000-8000-000000000001 | domínio nf; application/xml, text/xml, application/octet-stream; extensão xml; 20 MiB; ativo; múltiplas versões; por_nf | NF-e XML e companion |
| nf_danfe_pdf / f1200000-0000-4000-8000-000000000002 | domínio nf; application/pdf; extensão pdf; 20 MiB; ativo; múltiplas versões; por_nf | DANFE e suporte PDF conforme repositório fiscal existente |

Fonte inicial: `20260721132903_fase3_repositorio_documental_nf.sql`.
Tuplas vigentes extraídas diretamente de
`20260722193500_corrigir_catalogo_documental_requisitos_nf.sql`, sem executar
DDL, backfills ou outras linhas dessa migration.
Cardinalidade: default `por_nf` de `20260819220000_fase1_boleto_por_parcela.sql`.
Migrations posteriores do catálogo adicionam outros tipos, sem redefinir esses
dois. Nenhum tipo NFSE separado foi inventado: o repositório atual usa
`nf_danfe_pdf` para arquivo fiscal não XML, mas mantém
`tipo_documento_fiscal=NFSE`, identidade municipal e estratégia próprias.

Helper: `scripts/qa/reconciliation/r1-2-document-fixture.mjs`.
IDs fixos, ON CONFLICT DO NOTHING e comparação integral dos atributos: uma
linha divergente falha em vez de ser silenciosamente sobrescrita. Duas chamadas
consecutivas devem produzir o mesmo catálogo de exatamente duas linhas.

## FIXTURE_POLICY_ROWS

Reutilizada a fixture sintética oficial de `c2_1_r2_fluxo_taxa.test.sql`, somente
até antes da criação das NFs: um fundo, um cedente, um vínculo, uma política,
uma versão publicada e uma atribuição de política, com IDs fixos existentes.
Auth/perfis, autorização de consultoria, escrow e taxas são pré-requisitos dessa
fixture já existente, não dados copiados de ambiente remoto.

Os cenários documentais adicionais reutilizam `verifyNfeCompanions`:
políticas sintéticas sem requisitos, XML, PDF e XML+PDF; os requisitos usam
somente os dois tipos acima. IDs de instâncias de teste são gerados por cenário,
enquanto o catálogo é determinístico. Não são criadas políticas por fundo real.

## FIXTURE_OTHER_REQUIRED_CATALOG_ROWS

Nenhum outro catálogo da aplicação. Buckets privados e definições Auth/Storage
vêm do bootstrap oficial e metadados de schema já conferidos por hash.
Integrações, mensagens e anexos são exclusivamente sintéticos e nunca chamam
Graph, scheduler ou provedores. Não há fake Auth user para SYSTEM.

## Provas planejadas

- Ausência de nf_xml numa transação sintética: erro FISCAL_DOCUMENT_INVALID;
  rollback repõe o catálogo, sem relaxar o guard.
- Cadeia inteira recriada em Docker, sem reaproveitar estado R1.1.
- Storage via API local, download/hash e inspeção de arquivo físico na compensação.
- Arquivos sintéticos de 100 bytes testam persistência/Storage; não são usados
  como prova de leitura fiscal de PDF/XML. Parsers têm testes TypeScript próprios.
- Nenhuma alteração da migration forward ou de migrations históricas.
- Comparação de assinatura, ACL, SECURITY DEFINER e search_path antes/depois
  da forward; helpers privados sem permissão de execução para roles da API.

Os itens acima descrevem o plano/contrato; resultados somente no relatório da
execução. O primeiro cenário inesperadamente falho interrompe o rehearsal.
