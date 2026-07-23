# Reset operacional de fundo em homologação

Este procedimento serve para limpar dados operacionais de um fundo específico em homologação, permitindo testar novamente o fluxo ponta a ponta com os mesmos documentos e a mesma chave de NF.

Não use este procedimento em produção.

## O que o reset remove

O reset remove dados operacionais ligados ao fundo informado, como:

- operações;
- vínculos `operacoes_nfs`;
- notas fiscais, quando `--apagar-notas=true`;
- documentos das NFs;
- versões documentais;
- instâncias de requisitos documentais;
- entregas/logística;
- CT-es e canhotos;
- documentos jurídicos gerados;
- remessas CNAB;
- execuções/retornos de integração ligados às remessas/operações;
- movimentos de escrow ligados às operações;
- logs e notificações operacionais relacionados.

## O que o reset preserva

O reset não remove cadastros estruturais:

- fundos;
- cedentes;
- vínculos `cedente_fundos`;
- usuários;
- políticas operacionais;
- versões de políticas;
- requisitos de políticas;
- templates jurídicos;
- versões de templates;
- configurações CNAB;
- versões CNAB;
- integrações do fundo;
- credenciais.

## Pré-requisitos

O `.env.homolog` precisa conter:

```env
NEXT_PUBLIC_SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_DB_URL=...
```

Para `SUPABASE_DB_URL`, prefira a connection string do Supabase Session Pooler:

```text
Supabase Dashboard
→ Project Settings
→ Database
→ Connect
→ Session pooler
```

Formato típico, usando placeholders:

```env
SUPABASE_DB_URL="postgresql://postgres.<PROJECT_REF>:<SENHA>@aws-<REGION>.pooler.supabase.com:5432/postgres"
```

Evite depender de:

```text
conexao direta db.<PROJECT_REF>.supabase.co
```

Esse host direto pode falhar em redes sem IPv6 ou sem IPv4 add-on.

## Primeira vez no ambiente

Na primeira vez, aplique a RPC de reset no banco de homolog:

```bash
npm run reset:operacional:fundo:install-rpc
```

Esse comando aplica a função:

```sql
public.reset_operacional_fundo_homolog(...)
```

A RPC é usada pelo comando de reset para manter o banco transacional. O Node não faz deletes tabela a tabela pela API.

Depois da instalação, rode um preview:

```bash
npm run reset:operacional:fundo -- --fundo-id a4eb203b-ca53-40fa-8701-e453720bb15b --mode preview
```

Se aparecer `PGRST202` logo depois da instalação, aguarde alguns segundos e rode o preview novamente. Pode ser cache do PostgREST.

## Uso recorrente

### 1. Preview

Sempre rode o preview antes do reset:

```bash
npm run reset:operacional:fundo -- --fundo-id UUID_DO_FUNDO --mode preview
```

Exemplo:

```bash
npm run reset:operacional:fundo -- --fundo-id a4eb203b-ca53-40fa-8701-e453720bb15b --mode preview
```

Confira as contagens exibidas:

- operações;
- NFs;
- entregas;
- remessas;
- documentos;
- versões documentais;
- requisitos;
- CT-es;
- documentos gerados;
- objetos de Storage.

### 2. Reset apenas do banco

Para limpar o banco e preservar os arquivos físicos no Storage:

```bash
npm run reset:operacional:fundo -- --fundo-id UUID_DO_FUNDO --mode reset --yes
```

Exemplo:

```bash
npm run reset:operacional:fundo -- --fundo-id a4eb203b-ca53-40fa-8701-e453720bb15b --mode reset --yes
```

### 3. Reset do banco e Storage

Para limpar o banco e remover também os arquivos físicos mapeados no Storage:

```bash
npm run reset:operacional:fundo -- --fundo-id UUID_DO_FUNDO --mode reset --yes --delete-storage
```

Use essa opção quando quiser reutilizar uploads e evitar conflitos por paths antigos.

Importante: o banco é limpo primeiro. A remoção de Storage acontece depois via Supabase Storage API.

### 4. Validação posterior

Após o reset:

```bash
npm run reset:operacional:fundo -- --fundo-id UUID_DO_FUNDO --mode validate
```

Exemplo:

```bash
npm run reset:operacional:fundo -- --fundo-id a4eb203b-ca53-40fa-8701-e453720bb15b --mode validate
```

O esperado é:

- zero operações restantes do fundo;
- zero entregas restantes;
- zero remessas restantes;
- zero documentos gerados restantes;
- zero NFs do fundo, se `--apagar-notas=true`;
- cadastros estruturais preservados.

## Preservar NFs

Por padrão, o reset apaga NFs:

```bash
--apagar-notas=true
```

Isso libera a chave de acesso para novo upload.

Se quiser preservar as NFs e remover apenas operação/pós-cessão:

```bash
npm run reset:operacional:fundo -- --fundo-id UUID_DO_FUNDO --mode reset --yes --apagar-notas=false
```

Nesse modo, o script tenta restaurar as NFs para um status elegível usando valores reais do enum `nf_status`, preferindo:

```text
aprovada
submetida
rascunho
```

## Troubleshooting

### PGRST202: função não encontrada

Erro:

```text
Could not find the function public.reset_operacional_fundo_homolog...
```

Causa:

- a RPC ainda não foi aplicada no banco; ou
- o schema cache do PostgREST ainda não atualizou.

Correção:

```bash
npm run reset:operacional:fundo:install-rpc
```

Depois aguarde alguns segundos e rode:

```bash
npm run reset:operacional:fundo -- --fundo-id UUID_DO_FUNDO --mode preview
```

### Host direto do banco não resolve

Erro:

```text
hostname resolving error
lookup db.PROJECT_REF.supabase.co: no such host
```

Causa provável:

- conexão direta depende de IPv6 ou IPv4 add-on.

Correção:

Use `SUPABASE_DB_URL` com Session Pooler:

```env
SUPABASE_DB_URL="postgresql://postgres.<PROJECT_REF>:<SENHA>@aws-<REGION>.pooler.supabase.com:5432/postgres"
```

### Multiple commands into a prepared statement

Erro:

```text
cannot insert multiple commands into a prepared statement
```

Causa:

- pooler/prepared statement não aceita arquivo SQL com múltiplos comandos em uma única chamada.

Correção:

Use o comando atual:

```bash
npm run reset:operacional:fundo:install-rpc
```

Ele divide a instalação da RPC em comandos separados.

### Documento gerado compõe trilha jurídica

Erro:

```text
Documento gerado compoe trilha juridica e nao pode ser excluido
```

Causa:

- trigger de proteção em `documentos_gerados`.

Correção:

A RPC atual desabilita temporariamente apenas o trigger:

```sql
documentos_gerados_sem_delete
```

e reabilita em seguida.

### FK documento_requisito_versao_fk

Erro:

```text
update or delete on table documento_versoes violates foreign key constraint documento_requisito_versao_fk
```

Causa:

- alguma instância documental ainda referencia a versão aprovada.

Correção:

A RPC atual faz uma segunda passada documental para mapear requisitos por:

```text
documento_requisito_instancias.documento_id
documento_requisito_instancias.versao_aprovada_id
```

antes de remover `documento_versoes`.

### Analises de documentos sao append-only

Erro:

```text
Reset operacional homolog abortado: Analises de documentos sao append-only
```

Causa:

- trigger de auditoria `documento_analise_append_only` em `documento_analises`.

Correção:

A RPC atual desabilita temporariamente apenas o trigger:

```sql
documento_analise_append_only
```

e reabilita em seguida. Se esse erro aparecer, reaplique a RPC:

```bash
npm run reset:operacional:fundo:install-rpc
```

## Checklist seguro

Antes do reset:

- [ ] Confirmar que está em homologação.
- [ ] Confirmar `SUPABASE_DB_URL` do `.env.homolog`.
- [ ] Rodar `install-rpc` se for primeira vez ou se a RPC mudou.
- [ ] Rodar `preview`.
- [ ] Conferir contagens e objetos de Storage.

Durante o reset:

- [ ] Usar `--yes`.
- [ ] Usar `--delete-storage` apenas se quiser apagar arquivos físicos.
- [ ] Não interromper o processo.

Depois do reset:

- [ ] Rodar `validate`.
- [ ] Confirmar cadastros preservados.
- [ ] Testar novo upload de NF/XML.
- [ ] Testar novo fluxo ponta a ponta.

## Comandos rápidos

Primeira vez:

```bash
npm run reset:operacional:fundo:install-rpc
npm run reset:operacional:fundo -- --fundo-id UUID_DO_FUNDO --mode preview
```

Reset recorrente:

```bash
npm run reset:operacional:fundo -- --fundo-id UUID_DO_FUNDO --mode preview
npm run reset:operacional:fundo -- --fundo-id UUID_DO_FUNDO --mode reset --yes
npm run reset:operacional:fundo -- --fundo-id UUID_DO_FUNDO --mode validate
```

Reset recorrente apagando Storage:

```bash
npm run reset:operacional:fundo -- --fundo-id UUID_DO_FUNDO --mode preview
npm run reset:operacional:fundo -- --fundo-id UUID_DO_FUNDO --mode reset --yes --delete-storage
npm run reset:operacional:fundo -- --fundo-id UUID_DO_FUNDO --mode validate
```
