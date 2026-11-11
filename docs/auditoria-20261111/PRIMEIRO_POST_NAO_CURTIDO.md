# P0 — primeira publicação ainda não curtida (11/11/2026)

## Regra de negócio

A primeira publicação na ordem visual de **Publicações/Atividades** do perfil-alvo cuja conta ativa ainda não curtiu é a candidata. Pular publicações com reação já ativa. Não ordenar candidatos por data, URN ou texto. Não transformar reação desconhecida em ausência comprovada.

A definição de candidato é diferente dos pré-requisitos de uma ação externa. **A falta de data ou URN não deve fazer o software escolher outro post**; deve registrar qual é o primeiro candidato e por que não há caminho seguro/autorizado para agir sobre ele.

## Evidência do incidente

A captura do proprietário mostra 12 cartões reconhecidos, mas nenhum com identidade/data verificáveis. O código anterior em `discoverUnlikedPost()` filtrava por `isCanonicalPostUrn` e `parseRelativeAgeDays` *antes* de escolher o primeiro não curtido, contrariando a regra de negócio. Cartões com IDs provisórios `ll-idx-0` são índices locais, repetidos a cada leitura e inadequados como chave de uma fila persistente.

## Componentes

- `apps/desktop/src/main/linkedin/executors.ts::firstUnlikedCandidate`: seleção pura pela ordem visual. Não clica. A diferenciação de `liked=false`, `liked=true` e `liked=null` é obrigatória.
- `discoverUnlikedPost`: usa a candidata prioritária, sem preferir outra publicação apenas porque esta tem ID/data canônicos. Mantém a checagem de elegibilidade antes de qualquer clique existente; se não houver identidade/autorização, devolve diagnóstico e não aciona outro post.
- `apps/desktop/src/main/linkedin/diagnostics.ts::firstUnlikedControlProbe`: inventário sem clicar nem exportar nomes, texto, URLs ou credenciais. Registra posição, presença de controles de reação/comentário/editor/envio e acertos dos seletores na candidata.
- `apps/desktop/src/main/linkedin/post-identity.ts`: protege contra alvos provisórios e deduplicação incorreta.
- `apps/desktop/src/main/engagement-executor.ts`: curtida, redação, aprovação e comentário permanecem dependentes da política de execução.

## Estados obrigatórios

1. `LIKED`: já curtido. Pular.
2. `UNLIKED`: primeira candidata na ordem; apresentar mesmo quando a data ou URN não estiver legível.
3. `UNKNOWN`: não afirmar que é curtido ou não curtido; revisão humana.
4. `ACTION_NOT_PERMITTED`: candidato encontrado, porém sem integração/escopo LinkedIn autorizado. Oferecer ação manual na interface oficial, sem simular sucesso.
5. `REQUESTED`, `CONFIRMED`, `UNCERTAIN`: diferenciar tentativa e efeito; não repetir publicação incerta.

## Critérios de aceite restantes para curtida/comentário real

- Receber diagnóstico de um dos 12 posts com dados pessoais removidos e mapear controles *dentro do cartão selecionado*.
- Suíte reproduzível de ordem visual: curtido, não curtido, desconhecido, repost, cartão sem texto, data/ID ausentes.
- API oficial com `w_member_social_feed` e aprovação do aplicativo/ator, quando houver; se não, interação manual assistida no LinkedIn.
- Nunca iniciar automaticamente uma campanha de 818 pessoas a partir deste ajuste.
- Não afirmar que o LinkedIn real foi curtido ou comentado a partir de CI/E2E simulado.

## Referências oficiais

LinkedIn Help: https://www.linkedin.com/help/linkedin/answer/a1341543

LinkedIn Reactions API: https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/reactions-api

LinkedIn Help — Activity: https://www.linkedin.com/help/linkedin/answer/a546122/viewing-recent-activity
