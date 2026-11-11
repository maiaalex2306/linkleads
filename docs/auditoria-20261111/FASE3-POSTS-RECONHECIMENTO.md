# LINKLEADS — Fase 3 / leitura e identidade das publicações

Base: `main` SHA `6b78fd33f87653e9fdf466ca18e0a8586bfd01e0`. Preserva Passo 1 (backup/installer) e Etapa 2 (identidade URL).
Escopo: descoberta, autoria, texto, idade, ordenação e diagnósticos. Não altera quotas, login ou permissões de interações.

## Falhas auditadas
1. A antiga heurística escolhia a maior `div` textual; comentário, cabeçalho e rodapé podiam virar texto enviado à IA.
2. Regra `head.match(AGE)` podia tratar números do conteúdo como tempo da publicação.
3. O controle de fim da lista usava `seen.has('ll-idx-N')` mesmo armazenando chaves `unresolved:step:index`, gerando progresso falso.
4. URLs arbitrárias no formato `/in/slug` podiam ser interpretadas como links do autor, independentemente do domínio.
5. Cartões de autor ambíguo podiam receber um link arbitrário pela posição do primeiro `a[href*="/in/"]`.

## Contratos
- URN `urn:li:(activity|ugcPost|share):<número>` única e não provisória para qualquer efeito externo.
- Primeira publicação não curtida na ordem visual; curtida desconhecida ou autoria incerta bloqueiam avanço para o próximo cartão.
- Autoria confiável: identificador consistente e vinculado ao LinkedIn; comentários de terceiros não viram autoria.
- Conteúdo: extraído da região de texto do cartão, nunca do maior ancestral contendo UI.
- Idade: legenda temporal, `<time datetime>` ou permalink temporal, nunca números soltos no corpo.
- Rolagem: `ll-idx-N` é diagnóstico local da leitura, não prova de nova publicação.
- Falha de identificação: motivo auditável, nenhuma ação externa e sem declarar sucesso.

## Testes
- Unitário: `apps/desktop/test/post-selection.test.ts` (autoria host, índice provisório, URN nova).
- Chromium headless isolado: `apps/desktop/e2e/post-recognition.mjs`; dois layouts, múltiplos cartões, comentários longos, idade falsa, autoria ambígua e permalinks conflitantes.
- Regressão: suites E2E anteriores de scroll, curtidas/comentários, conta/campanha, Windows Electron e NSIS.

## Critérios para integração / liberação
- Todos os checks no **mesmo SHA** aprovados, inclusive Windows.
- Merge em `main` com registro SHA e CI pós-merge.
- Artefato Windows do proprietário comprovado por workflow de distribuição verde e ZIP com scripts na raiz.
- A máquina do operador e os dados locais não são acessados neste trabalho. CI com site simulado NÃO equivale a execução em LinkedIn real ou instalação local.
- A fase 2 possui dependência separada de conversão de hashes Sales Navigator; fase 3 somente opera em perfis corretamente identificados.
