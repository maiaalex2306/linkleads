# LINKLEADS 0.5.21 — Janela de posts para Curtir e Comentar

- Base da alteração: f2d2cef58f80e46a08cef1555534daaa68829d44
- Janela em toda a execução de curtidas: 1.826 dias (aproximação operacional de cinco anos).
- Campanhas existentes: preservar valores armazenados no SQLite, aplicar a nova janela durante a execução.
- Campanhas novas e interface: 1.826 dias.
- A mudança não amplia automaticamente o orçamento de rolagem, não ignora estado de curtida nem modifica limites de conta.
- E2E de rolagem: posts de seis anos devem ser ignorados, sem interação duplicada.
- Ainda requer prova na conta real em instalação Windows; CI não valida efeitos em rede externa.
- Velocidade: priorizar espera condicional, reuso de DOM válido e medição p50/p95; nenhuma redução arbitrária de intervalos neste patch.
