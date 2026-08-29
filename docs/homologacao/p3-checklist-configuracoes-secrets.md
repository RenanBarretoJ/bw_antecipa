# P3 — Checklist de configurações e secrets para produção

> Escopo e classificação vigentes no P3.1: `docs/homologacao/p3-1-dlz-health-release-candidate.md`.

Nenhum valor sensível deve ser registrado neste documento, em logs ou no manifesto.

## Configuração por fundo

| Item | DLZ | IMPULSE | Responsável | Evidência exigida |
|---|---|---|---|---|
| Política operacional publicada | Pendente | Pendente | Negócio/Gestora | versão aprovada e requisitos |
| Vínculos `cedente_fundo` | 10 existentes; 2 decisões externas | nenhum | Negócio | decisão formal por Cedente |
| Contrato-mãe publicado | Pendente | Pendente | Jurídico | preview e golden file |
| Termo de cessão publicado | Pendente | Pendente | Jurídico | preview e golden file |
| Adapter de cessão | Fromtis histórico; confirmar | Pendente | Operações/TI | documento do administrador |
| CNAB/layout publicado | Pendente | Pendente | Operações | golden file aprovado |
| Código originador | Pendente | Pendente | Administrador | valor textual confirmado |
| Banco/agência/conta/carteira/espécie | Pendente | Pendente | Operações | homologação bancária |
| Integração e capabilities publicadas | Pendente | Pendente | TI | teste de conexão homologado |
| Risco/exposição financeira | Pendente | Pendente | Risco | decisão de aplicabilidade e limites |

## Secrets e infraestrutura

| Configuração | Deve existir | Verificado? | Ação de cutover |
|---|---:|---|---|
| Site URL de produção | Sim | Pendente | confirmar domínio oficial no Supabase Auth |
| Redirect URLs fechadas | Sim | Pendente | incluir somente rotas oficiais de produção |
| `APP_BASE_URL` | Sim | Pendente | configurar URL HTTPS oficial |
| `NEXT_PUBLIC_APP_ENV` | Sim | Pendente | definir `production` |
| SMTP corporativo | Sim | Pendente | provisionar host, porta, usuário, senha e remetente fora do Git |
| Recovery e templates Auth | Sim | Pendente | validar `token_hash`, expiração e scanner-safe |
| Cron secret | Conforme cron ativo | Pendente | provisionar no ambiente da aplicação |
| Webhook secrets | Conforme providers | Pendente | gerar/rotacionar e registrar no cofre |
| Keyring de criptografia | Sim | Pendente | validar versão ativa e procedimento de rotação |
| Credencial Fromtis/Sinqia | Conforme decisão do fundo | Pendente | provisionar no cofre e vincular referência |
| Credencial Vórtx/mTLS | Conforme decisão do fundo | Pendente | provisionar key/secret/certificado/chave privada |
| Credencial de transportadora | Conforme uso | Pendente | provisionar token/digest no cofre |
| Certificados e cadeia CA | Conforme provider | Pendente | validar validade e cadeia completa |
| Vercel Production Env | Sim | Pendente | revisão de quatro olhos sem imprimir valores |
| Supabase PITR/backup | Sim | Pendente | confirmar retenção e ponto de restauração |

## Rollout MFA dos 23 usuários

- preservar senhas e usuários atuais;
- não executar reset coletivo;
- exigir setup TOTP no primeiro acesso quando ainda não houver fator;
- confirmar AAL2 e sessão operacional após o desafio;
- preparar suporte separado para Gestor, Cedente, Sacado e Super Admin;
- comunicar janela, instruções do autenticador e canal de recuperação;
- testar recuperação sem permitir bypass permanente do MFA;
- manter procedimento administrativo auditado para perda de dispositivo.
