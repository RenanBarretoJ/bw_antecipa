---
paths:
  - "src/api/**/*.ts"
  - "src/server/**/*.ts"
  - "backend/**/*.ts"
---

# Regras de backend

- Validar entrada e tratar erro explicitamente.
- Seguir o formato de resposta já adotado no projeto.
- Reutilizar serviços, utilitários e middlewares existentes antes de criar novos.
- Evitar lógica de negócio em controllers/handlers quando o projeto já separa essa responsabilidade.