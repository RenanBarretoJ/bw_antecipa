# Fase 10 — Homologação integrada e preparação para produção

Data da execução local: 22/07/2026.

Branch auditada: `homolog`.

Commit base antes das alterações locais da Fase 10: `878b623fc96b19d5725b9ef51f82a73160f772c7`.

## 1. Objetivo da fase

A Fase 10 consolida as fases 1 a 9 antes de produção. O foco não é criar novo fluxo de negócio, mas validar a integridade do que já foi implementado, reduzir riscos de segurança e registrar um roteiro objetivo de homologação.

Durante a auditoria local foram encontrados dois pontos corrigíveis no código:

- ausência de um fluxo administrativo auditável para reset de MFA, requisito necessário quando MFA é obrigatório e o usuário perde acesso ao autenticador;
- funções antigas `SECURITY DEFINER` usadas por RLS sem `SET search_path`, o que é frágil em produção.

Também foi criado CI mínimo para impedir regressões de TypeScript, testes, lint e build.

## 2. Escopo executado localmente

Executado neste repositório:

- inventário das migrations versionadas em `supabase/migrations`;
- criação da migration `supabase/migrations/20260722143728_fase10_reset_administrativo_mfa.sql`;
- hardening de funções auxiliares antigas de RLS;
- criação da tabela auditável `mfa_reset_solicitacoes`;
- implementação de server actions para solicitação, aprovação/execução e rejeição de reset administrativo de MFA;
- atualização dos tipos em `src/types/database.ts`;
- correções de lint necessárias em páginas existentes;
- criação do workflow `.github/workflows/ci.yml`;
- validações locais de TypeScript, testes automatizados, lint, build e whitespace.

Não executado localmente:

- aplicação de migrations no banco de homolog;
- backup real do banco de homolog;
- testes reais de RLS com usuários do Supabase;
- homologação real com Portal FIDC, Fromtis ou administrador externo;
- teste real de envio/retorno integrado;
- `supabase db lint` e `supabase migration list --local`, pois não existe Postgres local na porta `127.0.0.1:54322`.

## 3. Arquitetura antes x depois

Antes

```text
Usuário perde MFA
 ↓
MFA obrigatório continua bloqueando login
 ↓
Não havia fluxo administrativo codificado para reset seguro
```

Depois

```text
Gestor AAL2 solicita reset
 ↓
mfa_reset_solicitacoes registra motivo/evidência
 ↓
Outro gestor AAL2 aprova
 ↓
Supabase Auth Admin remove fatores MFA
 ↓
Recovery codes e sessões elevadas são invalidadas
 ↓
Perfil volta a exigir novo setup MFA no próximo login
 ↓
Eventos de segurança e notificação são registrados
```

Antes

```text
Policies RLS
 ↓
Funções SECURITY DEFINER antigas
 ↓
search_path implícito
```

Depois

```text
Policies RLS
 ↓
Funções SECURITY DEFINER recriadas
 ↓
SET search_path = public
 ↓
Referências qualificadas por schema
```

## 4. Decisões arquiteturais

- Reset de MFA exige dupla aprovação porque MFA é controle obrigatório. A mesma pessoa que solicita não pode aprovar ou executar o reset.
- Reset administrativo fica auditável em tabela própria, porque o evento precisa sobreviver ao ciclo de sessão do usuário e ser rastreável por auditoria.
- A remoção efetiva de fatores usa Supabase Auth Admin no backend, não o client browser, porque somente o backend com `service_role` deve ter permissão para operar sobre fatores de outro usuário.
- A ação exige sessão elevada (`exigirSessaoElevada`) para o gestor, reduzindo risco de abuso se uma sessão comum estiver comprometida.
- Recovery codes e sessões elevadas do usuário alvo são invalidadas após reset para evitar reaproveitamento de credenciais antigas.
- Notificações são secundárias: falha ao criar notificação não impede a ação principal, que fica registrada em auditoria.
- Migrations já existentes não foram editadas. A correção foi adicionada em migration nova, preservando histórico de ambientes já migrados.
- Funções antigas de RLS foram recriadas com `SET search_path = public` para mitigar risco de resolução indevida de objetos em funções `SECURITY DEFINER`.

## 5. Modelo de dados

### `public.mfa_reset_solicitacoes`

Finalidade: registrar solicitações administrativas de reset MFA com motivo, evidência, dupla aprovação, execução e erro.

Principais campos:

- `id`: identificador da solicitação.
- `usuario_id`: usuário alvo do reset, referenciando `public.profiles(id)`.
- `solicitante_id`: gestor que abriu a solicitação.
- `aprovador_id`: gestor que aprovou/rejeitou/executou; deve ser diferente do solicitante.
- `motivo`: justificativa obrigatória com ao menos 10 caracteres.
- `evidencia`: campo textual opcional para referência de evidência.
- `status`: `pendente`, `aprovado`, `executado`, `rejeitado` ou `erro`.
- `fatores_removidos`: quantidade de fatores MFA removidos via Supabase Auth Admin.
- `erro_execucao`: motivo de rejeição ou erro técnico.
- `solicitado_em`, `aprovado_em`, `executado_em`, `created_at`, `updated_at`: carimbos de tempo.

Relacionamentos:

- `usuario_id -> profiles.id`;
- `solicitante_id -> profiles.id`;
- `aprovador_id -> profiles.id`.

Constraints:

- `status` limitado aos estados conhecidos;
- `motivo` com tamanho mínimo;
- `aprovador_id <> solicitante_id` quando preenchido.

Índices:

- `idx_mfa_reset_solicitacoes_usuario_created`;
- `idx_mfa_reset_solicitacoes_status_created`;
- `idx_mfa_reset_solicitacoes_solicitante`.

RLS:

- RLS habilitado;
- gestor autenticado pode consultar solicitações;
- usuário alvo pode consultar suas próprias solicitações;
- escrita fica restrita ao backend com `service_role`.

## 6. Inventário de migrations

| Migration | Finalidade principal | Risco de aplicação |
| --- | --- | --- |
| `003_storage_buckets_env.sql` | Buckets e base de storage legado | Médio, altera storage/policies |
| `004_aceite_sacado_em.sql` | Aceite do sacado em NF/operação | Baixo/médio |
| `005_testemunhas.sql` | Testemunhas para contratos | Baixo |
| `006_documentos_assinados.sql` | Documentos assinados | Baixo/médio |
| `007_rename_aceite_sacado_em.sql` | Ajuste de coluna legado | Médio se aplicado fora de ordem |
| `008_document_update_request.sql` | Solicitação de atualização documental | Baixo |
| `009_habilitar_escrow_cedente.sql` | Configuração de acesso a extrato escrow | Baixo |
| `010_solicitacoes_alteracao_cedente.sql` | Solicitações cadastrais | Baixo/médio |
| `011_cedente_acessos.sql` | Acessos vinculados ao cedente | Médio, impacta RLS/acesso |
| `012_storage_policies_acesso_vinculado.sql` | Storage para acessos vinculados | Médio |
| `013_nf_solicitar_ajuste.sql` | Ajuste de NF | Baixo |
| `014_coobrigacao_notificacao.sql` | Coobrigação e notificação | Baixo/médio |
| `015_remessa_fromtis.sql` | Remessa Fromtis inicial | Médio |
| `016_termo_quitacao.sql` | Termo de quitação | Baixo/médio |
| `20260720203009_fase1_auditoria_atores_origem.sql` | Auditoria, atores, origem e base de testes | Médio, base transversal |
| `20260721123935_fase2_nucleo_multifundo_politicas_snapshot.sql` | Núcleo multifundo, políticas versionadas e snapshot | Alto, modelagem central |
| `20260721132903_fase3_repositorio_documental_nf.sql` | Repositório documental e documentos pré-cessão por NF | Alto, documentos/storage/RPC |
| `20260721170157_fase4_roteamento_aceite_sacado.sql` | Roteamento operacional e dispensa de aceite | Médio/alto |
| `20260721183540_fase5_logistica_pos_cessao.sql` | Pós-cessão, CT-e, canhoto e entrega | Alto |
| `20260721190904_fase6_templates_juridicos_fundo.sql` | Templates jurídicos por fundo | Médio/alto |
| `20260721194546_fase7_cnab_configuravel_rastreavel.sql` | CNAB versionado e rastreável por fundo | Alto |
| `20260722090000_fase8_portal_fidc_fundo.sql` | Integração Portal FIDC por fundo | Alto |
| `20260722132525_fase9_mfa_totp_hardening.sql` | MFA TOTP, recovery codes, rate limit e auditoria | Alto |
| `20260722143728_fase10_reset_administrativo_mfa.sql` | Reset administrativo MFA e hardening de funções antigas | Médio/alto |

Recomendação: aplicar em homolog estritamente na ordem cronológica acima, com backup antes e conferência de tabela/função após cada bloco.

## 7. Fluxo completo de homologação recomendado

```text
Backup do banco homolog
 ↓
Conferir branch/commit a ser homologado
 ↓
Aplicar migrations pendentes na ordem
 ↓
Validar schema e RLS
 ↓
Criar fundo novo
 ↓
Publicar política operacional
 ↓
Publicar templates jurídicos
 ↓
Publicar configuração CNAB
 ↓
Configurar integração Portal FIDC por fundo
 ↓
Executar operação ponta a ponta
 ↓
Gerar contrato / documentos / CNAB
 ↓
Registrar remessa
 ↓
Executar testes MFA e reset administrativo
 ↓
Validar logs, auditoria e notificações
 ↓
Executar rollback ensaiado em ambiente controlado
```

## 8. Segurança

Validações implementadas nesta fase:

- `solicitarResetMfaAdministrativo` exige usuário autenticado, perfil `gestor` e sessão elevada;
- `aprovarExecutarResetMfaAdministrativo` exige gestor diferente do solicitante;
- `rejeitarResetMfaAdministrativo` também exige gestor diferente do solicitante;
- motivo de reset/rejeição precisa ter ao menos 10 caracteres;
- ações registram eventos em `eventos_seguranca`;
- fatores MFA são removidos por `auth.admin.mfa.deleteFactor`;
- recovery codes ativos são invalidados;
- sessões elevadas do usuário alvo são removidas;
- `profiles.mfa_ativado_em` é zerado para forçar novo setup no próximo login;
- `profiles.sessoes_revogadas_em` é atualizado.

Hardening de banco:

- `public.get_user_role`;
- `public.get_user_cedente_id`;
- `public.get_user_sacado_cnpj`;
- `public.get_user_operacao_ids`.

As funções acima passam a usar `SECURITY DEFINER SET search_path = public`, referências qualificadas e grants explícitos para `authenticated` e `service_role`.

## 9. Compatibilidade

A Fase 10 preserva o funcionamento legado porque:

- não altera as migrations antigas já versionadas;
- adiciona migration nova;
- não remove campos ou tabelas existentes;
- não muda o fluxo normal de login/MFA;
- só adiciona uma rota operacional backend para recuperação administrativa;
- não altera a semântica de CNAB, Portal FIDC, fundos, templates ou políticas.

Operações antigas não são recalculadas nem reprocessadas por esta fase.

## 10. CI e qualidade

Foi criado `.github/workflows/ci.yml` com:

- `npm ci`;
- `npx tsc --noEmit`;
- `npm test -- --run`;
- `npm run lint`;
- `npm run build`.

Validações locais executadas:

- `npx tsc --noEmit`: aprovado;
- `npm test -- --run`: aprovado, 12 arquivos e 52 testes;
- `npm run lint`: aprovado com 0 erros e 28 warnings legados;
- `npm run build`: aprovado, 58 rotas geradas/analisadas;
- `git diff --check`: aprovado, apenas avisos de conversão LF/CRLF.

Comandos Supabase locais:

- `npx supabase --version`: `2.88.1`;
- `npx supabase migration list --local`: não executável sem banco local;
- `npx supabase db lint`: não executável sem banco local.

## 11. Dívidas técnicas e limitações conhecidas

- Warnings de lint legados permanecem e devem ser tratados em rodada própria.
- Não há Supabase local neste repositório, então lint de banco e migration dry-run local não foram possíveis.
- Migrations ainda precisam ser aplicadas e validadas no banco de homolog.
- RLS precisa ser testado com usuários reais dos papéis `gestor`, `cedente`, `sacado` e `consultor`.
- Integrações externas precisam de homologação com credenciais e endpoints reais.
- O reset administrativo MFA foi implementado no backend, mas ainda precisa de tela administrativa dedicada, se o produto exigir operação sem SQL/console.
- A gestão segura de segredos continua dependente de variáveis/secret manager externo; segredos não devem ser gravados em tabelas comuns.
- O workflow de CI usa placeholders/fallbacks para variáveis públicas de build; em GitHub/Vercel, configurar secrets reais.

## 12. Riscos residuais

- Migration não aplicada em homolog pode deixar o código de reset administrativo sem tabela.
- Ambientes com função `update_updated_at` ausente precisam aplicar as migrations base antes da Fase 10.
- A validação real de `auth.admin.mfa.deleteFactor` depende de projeto Supabase com MFA habilitado.
- Fatores MFA removidos encerram sessões verificadas conforme comportamento do Supabase Auth Admin; testar com usuário real antes de produção.
- Integrações Portal FIDC/Fromtis ainda dependem de homologação externa.
- Golden files CNAB devem ser revalidados após aplicação das migrations de Fase 7/8/10 no banco real.
- Backup e rollback ainda não foram ensaiados contra dump real de homolog.

## 13. Checklist de homologação antes de produção

- [ ] Backup completo do banco de homolog.
- [ ] Backup/export dos buckets relevantes.
- [ ] Confirmar commit exato a homologar.
- [ ] Aplicar migrations pendentes em ordem.
- [ ] Conferir existência de `mfa_reset_solicitacoes`.
- [ ] Conferir hardening de `get_user_role`, `get_user_cedente_id`, `get_user_sacado_cnpj`, `get_user_operacao_ids`.
- [ ] Rodar validação de schema remoto.
- [ ] Testar RLS com perfil gestor.
- [ ] Testar RLS com perfil cedente.
- [ ] Testar RLS com perfil sacado.
- [ ] Testar RLS com perfil consultor.
- [ ] Testar login sem MFA cadastrado.
- [ ] Testar setup MFA.
- [ ] Testar desafio MFA.
- [ ] Testar recovery codes.
- [ ] Testar encerramento de outras sessões.
- [ ] Testar reset administrativo MFA com dois gestores.
- [ ] Confirmar que usuário não consegue desativar MFA próprio quando obrigatório.
- [ ] Criar fundo novo em homolog.
- [ ] Publicar política operacional do fundo.
- [ ] Publicar template jurídico do fundo.
- [ ] Publicar configuração CNAB do fundo.
- [ ] Gerar arquivo CNAB de teste e comparar golden file.
- [ ] Configurar integração Portal FIDC por fundo.
- [ ] Testar operação ponta a ponta do fundo legado.
- [ ] Testar operação ponta a ponta de fundo novo.
- [ ] Validar logs de auditoria.
- [ ] Validar notificações.
- [ ] Testar concorrência de aprovação/publicação.
- [ ] Testar rollback técnico em ambiente controlado.
- [ ] Executar build de produção.
- [ ] Executar CI remoto no GitHub.
- [ ] Homologar com administrador externo/Portal FIDC.

## 14. Métricas da implementação local da Fase 10

- Tabelas criadas: 1 (`mfa_reset_solicitacoes`).
- Migrations criadas: 1 (`20260722143728_fase10_reset_administrativo_mfa.sql`).
- Funções antigas hardenizadas: 4.
- Server actions adicionadas: 3.
- Workflow CI criado: 1.
- Tipos TypeScript atualizados: 1 arquivo.
- Arquivos de UI ajustados por lint: 5 páginas.
- Script ajustado por lint: 1.
- Testes adicionados nesta fase: 0.
- Testes existentes executados: 52.
- Cobertura aproximada: não medida; o projeto não possui comando de coverage configurado no `package.json`.

## 15. Próxima fase recomendada

Antes de novas funcionalidades, a próxima etapa prática deve ser homologação operacional assistida em banco real:

1. aplicar migrations em homolog com backup;
2. executar checklist de RLS e MFA com usuários reais;
3. expor UI administrativa para listar/aprovar/rejeitar solicitações de reset MFA, caso o time não queira operar o reset apenas por action/console;
4. homologar Portal FIDC/Fromtis com credenciais reais por fundo;
5. validar golden files CNAB por fundo;
6. fechar warnings de lint restantes para elevar CI a “sem warnings”.

## 16. Parecer técnico

A arquitetura atual está preparada para múltiplos fundos, novos layouts CNAB e novos provedores porque as fases anteriores moveram políticas, templates, CNAB e integrações para contexto de fundo e versões históricas. A Fase 10 reforça a camada de segurança necessária para produção, especialmente MFA obrigatório, auditoria e hardening de funções usadas por RLS.

O que ainda impede produção não é uma lacuna estrutural evidente no código local, mas sim validação operacional real:

- migrations aplicadas em homolog;
- RLS validada com usuários reais;
- integração externa homologada;
- backup/rollback ensaiados;
- reset administrativo MFA testado ponta a ponta em Supabase Auth real;
- golden files CNAB aprovados pelo administrador.

Conclusão: o projeto está tecnicamente mais próximo de produção, mas ainda não deve ser promovido sem execução completa do checklist de homologação em ambiente real.

## 17. Complemento obrigatório — Credenciais Portal FIDC no banco

Após o fechamento inicial da Fase 10, foi incorporado o complemento de credenciais do Portal FIDC persistidas no banco sem texto aberto.

Arquitetura implementada:

```text
Gestor com MFA/AAL2
 ↓
Cadastro do fundo > Integrações
 ↓
Credenciais do Portal FIDC
 ↓
Server action protegida
 ↓
Criptografia AES-256-GCM server-side
 ↓
credenciais_integracao
 ↓
integracao_fundo_versoes.credencial_integracao_id
 ↓
Resolvedor Portal FIDC
 ↓
Teste/envio com credencial ativa
```

Modelo novo:

- `public.credenciais_integracao`: armazena credenciais criptografadas por `fundo_id`, `integracao_fundo_id` e `ambiente`.
- `public.integracao_fundo_versoes.credencial_integracao_id`: permite que uma versão publicada da integração aponte para uma credencial ativa específica.

Regras implementadas:

- usuário e senha são criptografados antes do INSERT;
- o formato do ciphertext é `v1:iv:tag:ciphertext`;
- a chave fica fora do banco, via `PORTAL_FIDC_CREDENTIAL_KEYS_JSON` e `PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION`;
- `chave_versao` preserva a versão de chave usada;
- credenciais são imutáveis quanto a ciphertext, fundo, integração, ambiente e chave;
- ativação substitui a credencial ativa anterior do mesmo ambiente;
- credencial revogada não pode ser usada;
- credencial vinculada a versão publicada não pode ser revogada antes de nova versão;
- acesso direto por `authenticated`/`anon` é revogado;
- a interface lista apenas metadados sanitizados;
- senha, ciphertext, IV, tag e chave nunca retornam ao navegador.

Compatibilidade:

- o resolvedor do Portal FIDC procura primeiro credencial ativa no banco;
- se ainda não houver credencial no banco, usa `credential_ref`/variáveis `PORTAL_FIDC_CREDENTIAL_*` como fallback temporário;
- uso do fallback é registrado como evento de segurança com severidade `warning`;
- o fallback deve ser removido após migração completa dos fundos.

Validações locais adicionais:

- testes de criptografia adicionados em `src/lib/portal-fidc/credenciais.test.ts`;
- total de testes passou de 52 para 56;
- os testes cobrem criptografia/descriptografia, nonce único, falha de integridade e chave ausente.

Checklist adicional de homologação:

- [ ] Aplicar `20260722145820_complemento_credenciais_portal_fidc_banco.sql`.
- [ ] Configurar `PORTAL_FIDC_CREDENTIAL_KEYS_JSON`.
- [ ] Configurar `PORTAL_FIDC_CREDENTIAL_ACTIVE_KEY_VERSION`.
- [ ] Cadastrar credencial Portal FIDC em `/gestor/fundos/[id]?tab=integracoes`.
- [ ] Confirmar que senha e ciphertext não aparecem no navegador.
- [ ] Ativar credencial.
- [ ] Criar/publicar versão da integração apontando para a credencial ativa.
- [ ] Testar conexão.
- [ ] Rotacionar credencial sem deploy.
- [ ] Revogar credencial antiga após validação.
- [ ] Confirmar evento `CREDENCIAL_USADA`.
- [ ] Confirmar evento de fallback caso ainda use env.
