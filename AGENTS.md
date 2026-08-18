# BW Antecipa — regras permanentes para agentes

Antes de qualquer alteração, leia integralmente o padrão compartilhado em
[`docs/development/engineering-standards.md`](docs/development/engineering-standards.md).
Esse documento é a fonte única das regras de arquitetura, qualidade, segurança,
testes, escopo e entrega para Codex, Claude e agentes compatíveis.

## Resumo obrigatório

- Trabalhe em um único escopo pequeno por vez: diagnostique, planeje, implemente,
  teste, revise o diff e entregue; aguarde validação antes de iniciar outro escopo.
- Baseie decisões no código, banco, migrations, RLS, testes e documentação
  existentes. Não presuma arquitetura nem crie duplicações.
- Mantenha a separação entre domínio, aplicação, infraestrutura, apresentação e
  persistência. Regras compartilhadas devem ficar em módulos centrais e tipados.
- Valide autorização no servidor e no domínio; não confie em frontend, payload,
  cookie ou ID enviado pelo cliente. Preserve tenant, fundo, vínculo, snapshots,
  versionamento, auditoria e histórico.
- Para alterações de banco, use migration incremental nova, constraints, índices,
  RLS, grants, triggers, RPCs e compatibilidade legada explícitos. Não edite
  migration já aplicada para corrigir ambiente existente.
- Preserve atomicidade, compensação de Storage e idempotência em uploads, RPCs,
  integrações, eventos, notificações, CNAB e reconciliações.
- Não exponha SQL, stack trace, tokens, senhas, OTPs, secrets ou dados sensíveis.
  Diferencie erro de domínio, autorização, validação, infraestrutura e erro inesperado.
- Toda mudança de domínio deve ter testes apropriados; build não substitui teste
  funcional. Ao finalizar escopo, execute as validações aplicáveis e informe o que
  não foi possível executar.
- Mantenha o diff focado. Não faça refatoração global, formatação ampla ou
  alteração fora do escopo sem autorização explícita.

## Regra específica do Next.js

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Ordem de execução

1. Ler este arquivo e `docs/development/engineering-standards.md`.
2. Diagnosticar o fluxo e pesquisar implementações existentes.
3. Definir e comunicar um plano curto.
4. Implementar somente o escopo autorizado.
5. Executar testes e validações.
6. Revisar o diff e entregar relatório com riscos e pendências.
7. Parar e aguardar validação.
