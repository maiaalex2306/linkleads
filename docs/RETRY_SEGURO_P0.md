# P0 — Repetição segura após falha ou bloqueio

## O que muda

A opção **Tentar de novo** deixa de reencaminhar ações que possam ter sido
realizadas sem confirmação, restrições da plataforma, falta de conteúdo ou
perfis não identificados. A repetição em lote é restrita a `LIMIT_REACHED`,
situação em que o executor não deveria ter executado a ação por falta de orçamento.

A repetição não é autorizada quando a conta está **pausada**. Isso não retoma
campanhas, não contorna checkpoint, não altera limites e não remove histórico
de falhas. Mesmo quando não há elementos elegíveis para retry, as falhas
continuam visíveis na tabela e disponíveis para diagnóstico.

A conta que sofreu a verificação de segurança deve permanecer pausada;
a pessoa proprietária resolve a verificação diretamente no LinkedIn.
Abertura do navegador para diagnóstico sem executar campanhas só depois
de cumprir a verificação.

## Pendências P0 adicionais

- Testes de DOM do LinkedIn atual (layouts alternativos, botões de reação,
  posts sem identificador canônico, carregamentos tardios).
- Seletores e confirmação de curtida na página real após a conta liberada,
  sempre com revisão humana, sem repetição automática.
- Identidade do perfil e do post, desambiguação, comportamento 404.
- Homologação em Windows; CI em site simulado não equivale à
  compatibilidade comprovada com LinkedIn.
- Análise de conformidade com termos da plataforma e alternativas autorizadas.

A política de repetição é intencionalmente conservadora: não se deve
aumentar a velocidade em detrimento da consistência e segurança.
