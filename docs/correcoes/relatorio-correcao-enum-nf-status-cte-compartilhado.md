# Correção do enum `nf_status` no compartilhamento de CT-e

## Resumo executivo

O detalhe da Nota Fiscal deixou de enviar o literal inválido `reprovada` ao
PostgREST. A lista de NFs candidatas ao compartilhamento de CT-e agora exclui
somente `cancelada`, valor pertencente ao enum canônico `nf_status`, e só é
consultada quando a política resolvida contém um requisito logístico ativo da
família CT-e.

A correção é exclusivamente de aplicação. Não foi criada migration e não houve
alteração de schema, enum, RLS, RPC, Storage ou dados.

## Causa-raiz

O loader `carregarChecklist()` consultava `notas_fiscais` com:

```ts
.not('status', 'in', '(cancelada,reprovada)')
```

O Postgres precisa converter cada literal desse filtro para `nf_status`.
`reprovada` pertence a `operacao_status`, não a `nf_status`; por isso a consulta
falhava antes de retornar o checklist inteiro.

Os valores canônicos de `nf_status` continuam sendo:

- `rascunho`;
- `submetida`;
- `em_analise`;
- `aprovada`;
- `em_antecipacao`;
- `aceita`;
- `contestada`;
- `liquidada`;
- `cancelada`;
- `requer_ajuste`.

## Consulta corrigida

A consulta foi movida para o helper server-side
`src/lib/logistica/candidatas-cte.server.ts` e passou a utilizar:

```ts
const NF_STATUS_CANCELADA_CTE: NfStatus = 'cancelada'

.neq('status', NF_STATUS_CANCELADA_CTE)
```

Além do status, a consulta restringe as candidatas pelo mesmo `cedente_id`,
`cedente_fundo_id` e `fundo_id`. Antes da consulta, o vínculo é confirmado como
ativo. O resultado também é validado contra o enum canônico em tempo de
execução.

## Carregamento condicional

O fluxo atual é:

```text
NF e acesso autorizado
  -> política/snapshot resolvido
  -> requisitos documentais carregados
  -> existe requisito ativo de CT-e em pós-cessão/entrega?
       não -> candidatos = [] e nenhuma consulta é executada
       sim -> valida contexto e vínculo ativo
            -> consulta NFs do mesmo contexto, exceto canceladas
```

Quando já existe uma entrega logística, não há envio antecipado e a consulta de
candidatas também não é executada.

## Regra e autoridade server-side

A lista da interface é apenas auxiliar. O upload continua validando no servidor:

- acesso a todas as NFs selecionadas;
- usuário cedente;
- mesmo cedente, fundo e vínculo ativo;
- política e requisito aplicáveis;
- ausência de cessão ou entrega incompatível;
- conteúdo e formato do CT-e.

O resolvedor de contexto foi compartilhado entre a listagem e o upload por meio
de `nfsCompartilhamContextoCte()`. A RPC existente permanece como autoridade
transacional final.

Não foi criado bloqueio adicional para NFs em rascunho, pois não existe decisão
de domínio comprovada que autorize essa mudança. A tela da própria NF continua
carregando normalmente nesse estado.

## Resiliência do checklist

Falhas operacionais exclusivas da consulta auxiliar de candidatas agora retornam:

- checklist preservado;
- candidatos vazios;
- aviso localizado no item CT-e;
- upload individual ainda disponível.

Erros de contexto, vínculo ativo, fundo ou status incompatível continuam
falhando de forma fechada.

## Strict Mode e notificações

O React Strict Mode não foi desabilitado. Erros do carregamento principal do
checklist agora usam uma `dedupeKey` estável por NF e mensagem, impedindo toasts
duplicados para a mesma falha lógica durante a renderização de desenvolvimento.

## Perfis afetados

O mesmo checklist compartilhado atende cedente e gestor. A correção não amplia
permissões: o acesso à NF é validado antes do uso do cliente administrativo e a
consulta auxiliar permanece restrita ao contexto persistido da NF.

## Testes adicionados

O teste `src/lib/logistica/candidatas-cte.server.test.ts` cobre:

- `cancelada` como valor válido e `reprovada` como valor inválido de `nf_status`;
- identificação de requisito CT-e antecipável;
- ausência de consulta quando a política não contém CT-e;
- captura de tabela, filtros, operadores e valores da consulta Supabase;
- uso exclusivo de `.neq('status', 'cancelada')`;
- matriz completa dos valores reais de `nf_status`;
- exclusão defensiva de NFs canceladas;
- preservação do checklist em falha acessória;
- falha fechada quando o vínculo ativo não existe;
- separação entre label/status de operação e enum persistido de NF.

## Arquivos alterados neste ajuste

- `src/lib/logistica/candidatas-cte.server.ts`;
- `src/lib/logistica/candidatas-cte.server.test.ts`;
- `src/lib/actions/documento-v2.ts`;
- `src/components/documentos-v2/ChecklistCedente.tsx`;
- `src/lib/logistica/upload-antecipado.server.ts`;
- `src/lib/types/domain.ts`;
- `docs/correcoes/relatorio-correcao-enum-nf-status-cte-compartilhado.md`.

## Validações executadas

- `npx tsc --noEmit`: aprovado;
- testes direcionados de logística/loader: 3 arquivos e 31 testes aprovados;
- `npm test -- --run`: 84 arquivos e 640 testes aprovados;
- `npm run lint`: aprovado sem erros; permaneceram 6 avisos preexistentes em
  arquivos fora deste ajuste;
- `git diff --check`: aprovado, com avisos de normalização LF/CRLF do ambiente;
- `npx next build --webpack`: aprovado; permaneceram avisos conhecidos do
  Handlebars sobre `require.extensions`;
- varredura de segredos: nenhuma credencial com formato sensível encontrada nos
  arquivos alterados.

## Riscos residuais

- A elegibilidade de compartilhamento por estado da NF continua permissiva para
  todos os estados reais, exceto `cancelada`, preservando o comportamento
  anterior. Uma regra mais restritiva exige decisão funcional separada.
- A interface executa filtros preventivos, mas concorrência e mudanças de estado
  entre listagem e upload continuam sendo tratadas pela validação server-side e
  pela RPC.
- Smoke real depende de uma sessão autenticada e de massa com políticas com e
  sem CT-e.

## Parecer

A causa-raiz foi removida sem alterar o banco. O loader não envia mais valores
externos ao enum, políticas sem CT-e deixaram de pagar o custo e o risco da
consulta auxiliar, e uma falha não crítica dessa capacidade não apaga o restante
do checklist. As fronteiras de autorização e a validação definitiva do upload
foram preservadas.
