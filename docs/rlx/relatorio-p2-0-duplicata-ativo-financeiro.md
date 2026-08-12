# P2.0 — Duplicata Mercantil como ativo financeiro

Status do relatório: implementação concluída no código; migration validada no banco de homologação dentro de transação revertida, sem aplicação permanente e sem commit/push.

## 1. Objetivo

O P2.0 introduz a Duplicata Mercantil como ativo financeiro configurável por versão de política operacional. A Nota Fiscal continua sendo o documento fiscal e comercial de lastro; ela não é substituída nem deixa de participar dos fluxos documentais existentes.

A ativação não depende do nome do fundo. A fonte de verdade é `politica_operacional_versoes.tipo_ativo_financeiro`, com os valores controlados `NOTA_FISCAL` e `DUPLICATA_MERCANTIL`. O valor padrão `NOTA_FISCAL` preserva o comportamento dos fundos existentes.

Arquivos centrais: `supabase/migrations/20260811120000_p2_0_duplicata_ativo_financeiro.sql`, `src/lib/operacoes/politica.ts` e `src/components/politicas/PoliticasDoFundo.tsx`.

## 2. Diagnóstico anterior

Antes desta fase:

```text
Política operacional
        ↓
Nota Fiscal = referência fiscal e operacional
        ↓
Submissão e aprovação da NF
```

Não existia entidade própria para título de Duplicata Mercantil, versão do PDF, extração de campos, confronto com a NF, correção humana ou validação final do gestor. O Storage documental privado e a autorização por NF já existiam e foram reutilizados.

Fontes analisadas: `src/lib/actions/nota-fiscal.ts`, `src/lib/operacoes/politica.ts`, `src/lib/documentos-v2/storage.ts`, `src/lib/auth/authorization.ts`, páginas de detalhe da NF e migrations de política/RLS.

## 3. Modelo de dados

A migration incremental cria quatro tabelas:

- `duplicatas`: estado canônico atual do título e vínculo com fundo, cedente, vínculo cedente-fundo, NF e sacado.
- `duplicata_versoes`: versões imutáveis do PDF e de cada resultado de extração.
- `duplicata_correcoes`: trilha append-only por campo, com valor original, valor corrigido, motivo, autor e data.
- `duplicata_validacoes`: decisões finais append-only do gestor, vinculadas à versão analisada.

Campos canônicos principais de `duplicatas`: número, número da fatura, parcela, emissão, vencimento, valor nominal, moeda, nomes e CNPJs documentais das partes, local de pagamento, aceite textual, detecção textual triádica do aceite, método de extração, resultado do confronto e status de validação.

Não existe campo de valor/preço de aquisição. O `valor_nominal` representa o valor de face do título.

Fonte: `supabase/migrations/20260811120000_p2_0_duplicata_ativo_financeiro.sql`.

## 4. Cardinalidade

A cardinalidade implementada é:

```text
Fundo 1 ── N vínculos cedente_fundo
cedente_fundo 1 ── N Notas Fiscais
Nota Fiscal 1 ── N Duplicatas
Duplicata 1 ── N versões de PDF
Duplicata 1 ── N correções
Duplicata 1 ── N validações
```

A FK composta de `duplicata_versoes` garante que a NF informada na versão seja a mesma NF do registro pai. A versão atual é referenciada por `duplicatas.versao_atual_id`.

## 5. Identidade do título

A identidade operacional controlada é `(cedente_fundo_id, numero, parcela)`, por índice único parcial quando o número está preenchido. Isso:

- preserva a parcela como string;
- permite extração manual inicial sem número;
- impede que o mesmo título identificado seja criado duas vezes no mesmo vínculo;
- permite que fundos/vínculos diferentes possuam a mesma numeração.

Não foi criada equivalência entre número da duplicata, número da fatura e número da NF.

## 6. Vínculo com a Nota Fiscal

Cada duplicata possui `nota_fiscal_id` obrigatório. A NF fornece o contexto autorizado de `fundo_id`, `cedente_fundo_id` e `cedente_id`; esses IDs não são aceitos do frontend no upload.

O confronto usa a NF como lastro para comparar:

- CNPJ do cedente/emitente;
- CNPJ do sacado/destinatário;
- valor nominal individual e agregado;
- emissão e vencimento;
- vínculo fiscal.

O número da duplicata não precisa ser igual ao número da NF.

Fontes: `src/lib/actions/duplicata.ts`, `src/lib/duplicatas/validacao.ts` e a RPC `registrar_duplicata_versao`.

## 7. Status

Os únicos estados persistidos são:

- `RASCUNHO`: cadastro ainda não extraído/concluído;
- `EXTRAIDA`: extração automática com campos críticos suficientes e confronto coerente;
- `REVISAR`: extração manual, baixa confiança ou divergência;
- `VALIDADA`: decisão final do gestor;
- `REJEITADA`: decisão final negativa, com motivo obrigatório.

Não foram introduzidos estados de aquisição, estoque, cessão, liquidação ou registro externo.

## 8. Upload

O upload está disponível no detalhe da NF do cedente somente quando a versão vigente da política usa `DUPLICATA_MERCANTIL` e a NF ainda está em `rascunho` ou `requer_ajuste`.

Fluxo:

```text
Cedente autenticado
  ↓
Autorização sobre a NF
  ↓
Política vigente = DUPLICATA_MERCANTIL
  ↓
PDF válido, até 20 MB e até 50 páginas
  ↓
Extração e confronto no servidor
  ↓
Upload privado
  ↓
RPC transacional para título + versão + eventos
  ↓
Compensação do Storage se a RPC falhar
```

Fontes: `src/lib/actions/duplicata.ts`, `src/lib/duplicatas/arquivo.ts` e `src/lib/duplicatas/pdf.server.ts`.

## 9. Storage

Foi reutilizado o bucket privado `documentos-v2`. O caminho é gerado exclusivamente no servidor:

```text
{cedente_id}/duplicatas/{nota_fiscal_id}/{uuid}.pdf
```

A RPC valida o prefixo contra a NF canônica e rejeita `..`. Downloads usam URL assinada temporária. O frontend não recebe caminho de Storage para escolher ou persistir.

Se o SQL falhar depois do upload, `removerObjetoDocumento` executa compensação e agora também reporta erro de remoção. Não há `upsert` de arquivo.

Fonte: `src/lib/documentos-v2/storage.ts`.

## 10. Extração

A extração usa `pdf-parse` no servidor. Não foi incluído OCR nem provedor externo.

Controles implementados:

- assinatura binária `%PDF-`;
- MIME e extensão PDF;
- 20 MB por arquivo;
- até 50 páginas;
- timeout de 20 segundos;
- texto persistido limitado a 50.000 caracteres;
- PDF corrompido gera erro;
- PDF sem texto útil segue para método `MANUAL` e status `REVISAR`.

Fonte: `src/lib/duplicatas/pdf.server.ts`.

## 11. Normalização

O parser normaliza espaços, quebras, datas civis, valores monetários, CNPJs e identificadores. Ele procura aliases de rótulo e seções de cedente/sacador/emitente e sacado/destinatário/devedor, preservando também os nomes documentais quando identificados. Também possui fallback estrutural para linhas com número, vencimento e valor. O aceite é registrado como `SIM`, `NAO` ou `INDETERMINADO`, sem afirmar validade jurídica.

Cada evidência guarda:

- campo;
- valor original;
- valor normalizado;
- trecho fonte;
- método (`rotulo`, `secao`, `padrao_estrutural` ou `manual`);
- confiança.

Fonte: `src/lib/duplicatas/parser.ts`.

## 12. Confiança

Campos críticos:

- número;
- vencimento;
- valor nominal;
- CNPJ do cedente;
- CNPJ do sacado.

Uma evidência crítica ausente ou com confiança inferior a `0,75` impede classificação automática. O registro segue para revisão manual. A confiança geral é a média das evidências encontradas e não substitui as regras de confronto.

## 13. Matching

O matching foi implementado como função pura em `src/lib/duplicatas/validacao.ts`. Ele não depende da interface nem de dados enviados pelo cliente para definir o contexto.

Resultado por título:

- `COERENTE`: sem bloqueios;
- `DIVERGENTE`: existe regra bloqueante;
- `INCOMPLETO`: faltam campos críticos.

Resultado agregado por NF:

- total igual ao valor bruto: `COERENTE`;
- total inferior: `INCOMPLETO`;
- total superior: `DIVERGENTE`;
- qualquer título incompleto mantém o agregado incompleto.

## 14. Regras de validação

Bloqueios:

- campos críticos ausentes;
- CNPJ do cedente divergente da NF;
- CNPJ do sacado divergente da NF;
- valor individual maior que o valor bruto da NF;
- soma nominal divergente/incompleta;
- duplicata rejeitada;
- ausência de título em política de Duplicata Mercantil.

Avisos:

- emissão divergente;
- vencimento divergente.

Informações:

- ausência de aceite textual;
- número da duplicata diferente do número da NF, sem tratar isso como erro.

A ausência de aceite, isoladamente, não é considerada invalidade jurídica.

## 15. Revisão manual

O cedente pode revisar campos antes da submissão da NF. O gestor autorizado ao fundo também pode corrigir durante a análise. Cada mudança exige motivo e gera registro por campo com original, corrigido, autor, data e versão documental.

O gestor visualiza os dados da duplicata ao lado dos valores equivalentes da NF e pode validar ou rejeitar. A validação final recalcula o confronto no servidor. A RPC também impede validar se campos críticos ou partes estiverem divergentes.

Uma nova versão do PDF não herda dados de extração da versão anterior: o arquivo é processado novamente e o estado canônico é atualizado a partir do novo resultado.

## 16. RLS

As quatro tabelas possuem RLS habilitada.

Leitura de `duplicatas`:

- gestor autorizado ao fundo via `private.usuario_tem_acesso_fundo`;
- cedente proprietário via `get_user_cedente_id`;
- consultor autorizado ao cedente via `private.consultor_tem_acesso_cedente`.

As tabelas filhas validam acesso por `EXISTS` no pai. Não há grant para `anon` nem policy para sacado. Escritas de aplicação passam por RPCs `SECURITY DEFINER`, com autorização e contexto revalidados no banco.

A migration foi executada com sucesso no banco de homologação dentro de `BEGIN`/`ROLLBACK`, confirmando quatro tabelas, quatro tabelas com RLS e três RPCs. Uma massa exclusivamente transacional confirmou leitura pelo cedente proprietário, gestor autorizado, gestor multifundo e consultor autorizado; isolamento de cedente adversário, gestor de outro fundo, consultor não autorizado, sacado e anônimo; além do bloqueio de `INSERT` direto (`42501`) e de `UPDATE`/`DELETE` diretos pelo cedente. O vínculo temporário necessário ao caso do consultor foi revertido junto com toda a massa. A migration não foi aplicada permanentemente.

## 17. Auditoria

Eventos operacionais registrados:

- `duplicata_criada`;
- `duplicata_pdf_enviado`;
- `duplicata_extraida`;
- `duplicata_requer_revisao`;
- `duplicata_corrigida`;
- `duplicata_validada`;
- `duplicata_rejeitada`.

Os eventos carregam tenant/fundo, cedente, vínculo, NF, ator, perfil, origem e metadata sem URL assinada, texto integral do PDF ou segredo.

As correções e validações possuem trilhas próprias append-only, além de `eventos_dominio`.

## 18. Versionamento

Cada upload cria nova linha em `duplicata_versoes`, com sequência por duplicata, hash SHA-256, metadados, texto limitado, campos, evidências, resultado e confiança. Triggers impedem UPDATE e DELETE de versões, correções e validações.

O estado canônico atual permanece em `duplicatas`; o histórico técnico e humano permanece imutável nas tabelas filhas.

## 19. Interface

A configuração aparece na criação de versão da política como escolha entre Nota Fiscal e Duplicata Mercantil. Ela também é exibida na revisão, detalhes e confirmação de publicação.

O componente compartilhado `src/components/duplicatas/DuplicatasDaNota.tsx` é usado nos detalhes de NF do cedente e gestor:

- cedente: upload, nova versão, revisão de campos e visualização;
- gestor: confronto, evidências, histórico, validação e rejeição;
- ambos: resumo agregado, status e PDF sob demanda por URL assinada.

Quando a política usa `NOTA_FISCAL`, o componente não renderiza e o fluxo visual atual permanece inalterado.

## 20. Preparação para estoque futuro

O modelo separa valor nominal, identidade, versão documental e validação, deixando base para uma fase futura de estoque de recebíveis. Essa preparação não implementa:

- aquisição;
- preço de aquisição;
- posição/estoque;
- baixa/liquidação;
- registro em entidade externa;
- elegibilidade de carteira;
- PL ou concentração.

Esses conceitos devem ser entidades próprias e não colunas improvisadas em `duplicatas`.

## 21. Testes

Foram adicionados 33 testes específicos em:

- `src/lib/duplicatas/parser.test.ts`;
- `src/lib/duplicatas/validacao.test.ts`;
- `src/lib/duplicatas/arquivo.test.ts`;
- `src/lib/duplicatas/arquitetura.test.ts`.

Cobertura funcional: aliases, múltiplos títulos, datas inválidas, documento sem texto, limite textual, CNPJs, valores, aceite informativo, confronto individual/agregado, assinatura PDF, RLS estática, Storage privado, compensação, append-only, gates e preservação de `NOTA_FISCAL`.

Validação SQL em homologação: a migration foi aplicada transitoriamente, foram verificados `DEFAULT 'NOTA_FISCAL'`, quatro tabelas, RLS habilitada nas quatro tabelas e três RPCs. A massa RLS transacional validou cedente próprio e adversário, gestor autorizado e multifundo, gestor cross-fund, consultor autorizado e não autorizado, sacado, anônimo e bloqueio de escrita direta. Em seguida foi executado `ROLLBACK`. O bucket reutilizado `documentos-v2` foi confirmado como privado por consulta somente leitura.

O teste de snapshot de política existente também foi atualizado em `src/lib/operacoes/politica.test.ts`.

## 22. Riscos

- A migration ainda não foi aplicada permanentemente; o SQL estrutural e a matriz RLS passaram em transação revertida, mas as RPCs com sessão real da aplicação e o CRUD de Storage precisam de homologação após a aplicação controlada.
- PDFs com layout desconhecido podem exigir revisão manual.
- PDFs digitalizados não possuem OCR nesta fase.
- `pdf-parse` é uma dependência legada CommonJS externalizada pelo Next.js.
- O confronto de valor usa igualdade monetária em centavos; cenários de desconto, abatimento ou títulos com composição diferente não foram introduzidos.
- Testes concorrentes reais de duas versões enviadas ao mesmo tempo ainda dependem do banco de homologação.
- A validação jurídica do conteúdo extraído não substitui análise humana.

## 23. Limitações

Fora do P2.0:

- cálculo ou preço de aquisição;
- regra percentual fixa;
- estoque e liquidação;
- CERC/registradora;
- assinatura eletrônica;
- OCR;
- integração externa;
- edição pelo gestor;
- acesso do sacado;
- mudança do fluxo financeiro de operações já existente.

Não foram criadas constantes por fundo ou bifurcações baseadas em nome/CNPJ do fundo.

## 24. Parecer técnico

A arquitetura implementada separa corretamente o documento fiscal do ativo financeiro e mantém compatibilidade por configuração versionada. O modelo suporta várias duplicatas por NF, múltiplos fundos, histórico documental imutável, revisão humana e decisão final do gestor sem introduzir prematuramente estoque ou aquisição.

O código está preparado para homologação, mas não deve ser considerado pronto para produção antes de:

1. aplicar a migration em homologação;
2. executar testes reais de RLS para gestor, cedente, consultor, sacado e acesso cruzado;
3. validar upload/compensação no bucket privado;
4. testar concorrência de versões;
5. homologar PDFs reais de diferentes emissores;
6. executar o fluxo completo de submissão e aprovação em políticas `NOTA_FISCAL` e `DUPLICATA_MERCANTIL`.

Com esses gates cumpridos, o P2.0 fornece uma base coerente e extensível para as próximas fases do ciclo de vida da Duplicata Mercantil.
