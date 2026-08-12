# Reset geral do ambiente de homologação

Este procedimento remove os dados funcionais do BW Antecipa para permitir que
o fluxo completo seja testado novamente desde o cadastro inicial.

## O que é apagado

- todos os registros funcionais das tabelas da aplicação no schema `public`;
- todos os usuários do Supabase Auth, incluindo sessões e fatores vinculados;
- todos os objetos de todos os buckets do Supabase Storage.

## O que é preservado

- schema, funções, triggers, RLS, grants e migrations aplicadas;
- buckets e suas configurações;
- `public.documento_tipos`, pois é o catálogo técnico controlado pelas
  migrations e necessário para os fluxos documentais.

O comando não apaga metadados internos gerenciados pelo Supabase, como o
histórico de migrations e logs internos da plataforma.

## Pré-requisitos

O arquivo `.env.homolog` deve conter:

```text
NEXT_PUBLIC_APP_ENV=homolog
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DB_URL=...
SUPABASE_PRODUCTION_PROJECT_REF=...
```

A URL da API e a conexão PostgreSQL devem pertencer ao mesmo projeto. A ref de
produção é obrigatória para o bootstrap recusar explicitamente esse destino. O
script valida essas correspondências antes de qualquer alteração.

## 1. Executar o preview

O preview é somente leitura e informa quantos registros, usuários e objetos
serão removidos:

```powershell
npm run reset:geral:homolog -- --expected-project-ref SEU_PROJECT_REF
```

O próprio preview imprime o comando exato necessário para executar o reset.

## 2. Executar o reset irreversível

Use o comando exibido pelo preview:

```powershell
npm run reset:geral:homolog -- --execute --expected-project-ref SEU_PROJECT_REF --confirm RESETAR_TODA_HOMOLOGACAO_SEU_PROJECT_REF
```

As duas confirmações são obrigatórias e vinculadas ao projeto configurado. O
script recusa execução quando o ambiente não é homologação, quando as URLs não
correspondem ou quando a frase não é exata.

## 3. Após o reset

O ambiente ficará sem usuários e fundos. O primeiro acesso administrativo deve
ser reconstruído pelo bootstrap de Super Admin, que não depende de fundo nem de
`usuario_fundos`.

Primeiro execute o preview:

```powershell
npm run bootstrap:super-admin:homolog -- --email admin@empresa.com --expected-project-ref SEU_PROJECT_REF
```

Depois execute apenas o comando confirmado pelo preview:

```powershell
npm run bootstrap:super-admin:homolog -- --email admin@empresa.com --execute --expected-project-ref SEU_PROJECT_REF --confirm PROVISIONAR_SUPER_ADMIN_HOMOLOG_SEU_PROJECT_REF
```

O fluxo usa convite do Supabase Auth e não recebe senha por argumento. Após o
convite, conclua o acesso, configure o MFA/TOTP e confirme que `/admin` abre com
zero fundos. A criação do primeiro fundo pertence ao escopo administrativo SA1.

Depois, valide ao menos:

1. convite e confirmação do primeiro Super Admin;
2. configuração do MFA e acesso a `/admin`;
3. criação do fundo e autorização do gestor quando SA1 estiver disponível;
4. onboarding e vínculo do cedente;
5. política, templates, CNAB e integração do fundo;
6. importação e aprovação de NF;
7. solicitação, aprovação, desembolso e acompanhamento logístico.

## Recuperação de falha parcial

Storage e Auth são serviços externos à transação PostgreSQL. Se o comando for
interrompido, execute-o novamente com as mesmas confirmações. O procedimento é
idempotente: buckets já vazios, tabelas sem dados e usuários já removidos não
impedem uma nova execução.
