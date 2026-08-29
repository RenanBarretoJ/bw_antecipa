# Upload de documentos assinados da operação

## 1. Erro original

O detalhe da operação do gestor enviava diretamente pelo navegador os PDFs do termo de cessão assinado, da notificação ao sacado assinada e do comprovante de desembolso/TED para o bucket privado `contratos`. A chamada usava `upload(..., { upsert: true })` e recebia `403 AccessDenied / new row violates row-level security policy`.

O problema era reproduzido antes de o path ser salvo na operação. A interface, entretanto, separava upload e persistência em duas chamadas independentes, deixando o cliente responsável pelo bucket e path final.

## 2. Causa raiz

A migration do Escopo 9C removeu corretamente a policy ampla `storage_contratos_gestor_all` e manteve em `storage.objects` somente leitura autenticada baseada no helper privado multifundo. Um upload novo requer `INSERT`; uma sobrescrita com `upsert` também requer `SELECT` e `UPDATE`. O navegador deixou de possuir essas permissões amplas, como esperado pelo modelo de segurança.

A falha imediata observada no primeiro envio é de `INSERT`. Em substituições, o mesmo desenho dependeria adicionalmente de `SELECT/UPDATE`. Reintroduzir policy baseada somente em `role = gestor` permitiria acesso cruzado entre fundos e, por isso, não foi adotado.

## 3. Fluxo anterior

```text
Gestor no navegador
  -> recebe/constroi bucket e path
  -> Storage privado: upload com upsert
  -> Server Action recebe path do cliente
  -> UPDATE isolado da coluna da operação
```

Fragilidades:

- autorização de Storage dependente do browser;
- path arbitrário aceito pelas Server Actions antigas;
- upload e banco sem compensação;
- substituição poderia sobrescrever a única versão válida antes de confirmar o banco;
- auditoria de primeiro envio/substituição não era atômica do ponto de vista lógico.

## 4. Fluxo novo

```text
Gestor no navegador
  -> POST multipart: tipo fechado + PDF
Route Handler
  -> autenticação com JWT real
  -> perfil gestor ativo
  -> operação visível pelo RLS 9B
  -> cedente_fundos ativo
  -> fundo ativo
  -> usuario_fundos ativo
  -> validação do PDF
  -> path versionado construído no servidor
  -> upload privado com cliente administrativo
  -> compare-and-swap da referência na operação
  -> auditoria
  -> remoção da versão anterior
  -> resposta compacta e revalidação visual
```

O ponto canônico é `POST /api/operacoes/[id]/documentos-assinados`. Foi escolhido Route Handler porque o payload é `multipart/form-data` e os PDFs podem alcançar o limite documental existente de 20 MB. Não houve aumento de limite global.

## 5. Autorização

A service role não representa o usuário. Ela somente é criada depois de todas as verificações abaixo com o cliente autenticado:

1. `auth.getUser()` e profile existente;
2. `profiles.role = gestor`;
3. `profiles.status = ativo`;
4. leitura da operação com o JWT real, sujeita ao RLS 9B;
5. resolução por `operacoes.cedente_fundo_id`;
6. `cedente_fundos.status = ativo`;
7. `fundos.ativo = true`;
8. `usuario_fundos(usuario_id = auth.uid(), fundo_id, status = ativo)`.

O cookie de fundo ativo não participa da autorização. Gestores adversários recebem resposta segura sem confirmação de arquivo. Cedente, consultor, sacado, usuário inativo, usuário sem profile e anônimo são negados para upload e para o novo endpoint de URL assinada.

## 6. Paths

O cliente não envia bucket, path, nome final, fundo, cedente, usuário ou URL anterior. A allowlist contém somente:

- `TERMO_CESSAO_ASSINADO`;
- `NOTIFICACAO_SACADO_ASSINADA`;
- `COMPROVANTE_DESEMBOLSO_TED`.

O formato controlado é:

```text
operacoes/{operacaoId}/assinados/{tipo-controlado}/{uuid-da-versao}.pdf
```

O `operacaoId` e o identificador da versão precisam ser UUIDs válidos. O nome original é apenas metadado sanitizado de auditoria. Traversal, barras no tipo e filename do cliente não influenciam o objeto final.

## 7. Substituição

A substituição não usa `upsert` nem sobrescreve o objeto vigente. Cada envio recebe um path versionado novo. A coluna atual da operação continua sendo a fonte de verdade.

O banco é atualizado por compare-and-swap: a referência só muda se ainda possuir exatamente o path lido durante a autorização. Duas requisições concorrentes não podem substituir silenciosamente uma à outra; a perdedora remove seu novo objeto e recebe conflito.

Eventos:

- primeiro envio: `DOCUMENTO_ASSINADO_ANEXADO`;
- substituição: `DOCUMENTO_ASSINADO_SUBSTITUIDO`.

Depois de banco e auditoria confirmados, o objeto anterior é removido. Se a limpeza falhar, ele permanece privado e sem referência atual, permitindo limpeza posterior sem afetar a operação.

## 8. Compensação

Storage e PostgreSQL não possuem transação compartilhada. O fluxo aplica compensação explícita:

- upload falha: nenhuma coluna é alterada;
- banco falha ou compare-and-swap perde concorrência: o objeto novo é removido;
- auditoria falha: a referência é restaurada por compare-and-swap e o objeto novo é removido quando a restauração é confirmada;
- remoção do objeto antigo falha: a versão vigente continua válida; somente a limpeza fica pendente;
- o objeto anterior nunca é removido antes de novo upload, banco e auditoria terem sucesso.

O botão de desembolso continua lendo `termo_assinado_url` e `comprovante_pagamento_url`; sua regra não foi alterada.

## 9. Policies

Nenhuma policy, grant, helper SQL ou migration foi alterado. O bucket `contratos` continua privado e o browser não recebeu `INSERT/UPDATE` amplo.

O helper `private.usuario_pode_ler_objeto_storage` e a policy `storage_private_objects_select_authorized` do Escopo 9C permanecem intactos. Outros uploads, geradores e o repositório documental v2 não foram modificados.

## 10. Signed URLs

O endpoint `GET /api/operacoes/[id]/documentos-assinados?tipoDocumento=...` repete toda a autorização canônica, resolve exclusivamente o path registrado na operação e cria URL assinada com validade de 60 segundos.

Não existem URLs persistidas nem geração em massa na listagem. O endpoint rejeita path fora do prefixo da própria operação. URLs anteriormente emitidas podem existir somente até o fim de sua curta validade; uma substituição não torna o path antigo consultável novamente pela aplicação.

O endpoint genérico legado continua atendendo documentos para os quais já existe regra explícita de visualização por cedente. A interface do gestor para estes três documentos usa exclusivamente o novo endpoint restrito.

## 11. Auditoria

A auditoria armazena:

- ator autenticado e perfil;
- operação e fundo;
- tipo documental;
- ação de primeiro envio ou substituição;
- data/hora;
- nome original sanitizado;
- MIME, tamanho e SHA-256;
- presença anterior e posterior do documento.

Não são registrados token, cookie, service role, signed URL, conteúdo, path temporário ou path interno. Falha de auditoria não é tratada como sucesso silencioso: ela aciona compensação.

## 12. Testes

Testes unitários e estruturais cobrem:

- allowlist e traversal;
- construção server-side do path;
- gestor ativo e negação dos demais perfis/estados;
- vínculo, fundo e associação de usuário ativos;
- PDF válido, MIME, extensão, vazio, limite de 20 MB e magic bytes `%PDF-`;
- hash e sanitização do nome original;
- primeiro envio e substituição;
- falha de upload antes do banco;
- falha/conflito após upload;
- restauração em falha de auditoria;
- preservação da versão vigente;
- ordem upload -> banco -> auditoria -> limpeza;
- ausência de Storage/path no cliente;
- remoção das Server Actions que aceitavam path arbitrário;
- confirmação antes de substituir e bloqueio de clique duplo;
- URL assinada de 60 segundos.

Resultados finais:

- testes específicos: 23/23;
- suíte completa: 74 arquivos e 515/515 testes;
- TypeScript: aprovado;
- ESLint: sem erros, com seis warnings preexistentes fora do escopo;
- `git diff --check`: aprovado;
- build Next.js/Webpack: aprovado, mantendo apenas warnings preexistentes do Handlebars.

## 13. Homologação

Foi criado o comando repetível `npm run perf9c:documentos-assinados`. Ele usa a massa PERF9A, exige que a operação de teste esteja sem os três documentos, autentica gestores com o fluxo real de MFA, executa os testes e, em `finally`, remove objetos criados e limpa as três referências da operação.

Resultado material em homologação:

- três de três tipos enviados pelo Gestor A;
- substituição do termo confirmada;
- três de três URLs assinadas válidas por 60 segundos;
- Gestor B bloqueado na operação do Fundo A;
- auditoria de primeiro envio e substituição confirmada;
- resultado geral: `APROVADO`.

Roteiro executado com a massa PERF9A:

1. autenticar Gestor A com JWT real e AAL2;
2. enviar e substituir cada um dos três PDFs da operação do Fundo A;
3. confirmar colunas e auditoria;
4. confirmar download temporário;
5. tentar upload e download com Gestor B/Fundo B na operação A;
6. repetir tentativas com cedente, consultor, sacado e anônimo;
7. confirmar que o desembolso reconhece termo e comprovante;
8. executar RLS 9B e Storage 9C.

A aplicação não encerra automaticamente uma sessão cujo access token tenha sido exposto anteriormente. A sessão comprometida precisa ser revogada operacionalmente; os testes criaram sessões novas e nenhum token foi copiado para este relatório.

## 14. Regressões

Escopo preservado:

- upload/download de NF, CT-e e canhoto;
- repositório documental v2;
- documentos gerados e termo de quitação;
- CNAB e integração;
- dashboards, notificações, aprovação e desembolso;
- policies multifundo dos Escopos 9B/9C.

O componente genérico anterior permanece apenas nos fluxos fora dos três tipos corrigidos. As três Server Actions que recebiam paths arbitrários foram removidas por não terem consumidores legítimos depois da migração da UI.

Gates materiais executados:

- RLS 9B: 50/50 aprovados;
- Storage 9C: 19/19 aprovados;
- smoke específico dos documentos assinados: aprovado.

## 15. Rollback

Rollback de aplicação:

1. reverter o novo Route Handler, módulo de domínio/servidor e componente específico;
2. restaurar os seis usos anteriores da página e as três Server Actions removidas;
3. não executar rollback de banco, pois não há migration;
4. objetos versionados já enviados permanecem privados; as colunas da operação continuam apontando para a versão vigente.

Não se recomenda restaurar o upload direto sem antes criar alternativa que preserve autorização multifundo e compensação.

## 16. Parecer

A correção elimina a dependência de permissões amplas no navegador e fecha o vetor de path arbitrário. A autorização usa a cadeia canônica da operação até o fundo, a substituição preserva o documento anterior durante falhas e o download é temporário e autorizado.

O desenho está apto para homologação material. A ida à produção depende da execução do roteiro com JWT/AAL2 real, confirmação dos gates RLS 9B e Storage 9C e revogação prévia de qualquer sessão cujo token tenha sido exposto.
