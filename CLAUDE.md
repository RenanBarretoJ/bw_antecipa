# BW Antecipa — regras para Claude

Leia primeiro [`AGENTS.md`](AGENTS.md) e integralmente o padrão compartilhado
em [`docs/development/engineering-standards.md`](docs/development/engineering-standards.md).

Claude deve seguir as mesmas regras de escopo, diagnóstico, arquitetura,
segurança, autorização, banco, testes, documentação e entrega definidas para
Codex. `engineering-standards.md` é a fonte única; não crie regras paralelas
nem contraditórias neste arquivo.

Instrução específica: antes de alterar código Next.js, leia o guia relevante em
`node_modules/next/dist/docs/`, pois esta versão possui APIs e convenções que
podem divergir do conhecimento geral.

Ao concluir um escopo, entregue o relatório, informe validações executadas e
aguarde a validação do usuário antes de iniciar outro escopo.
