# LINKLEADS — Referência de telas reais, limites e engajamento (09/11/2026)

## Escopo e proveniência

Análise direta dos **14 PNGs** recebidos em `image.zip`, com nomes internos
`image.png` e `image (1).png` até `image (13).png`.
Não versionar screenshots: contêm nomes, endereços e outros dados de contas privadas.
Fontes adicionais verificadas na documentação Linked Helper:
- [Working Hours and Limits](https://support.linkedhelper.com/hc/en-us/articles/360016435499-Working-Hours-and-Limits)
- [What kind of limits should I use?](https://support.linkedhelper.com/hc/en-us/articles/360015349559-What-kind-of-limits-should-I-use)
- [Like and comment posts and articles](https://support.linkedhelper.com/hc/en-us/articles/360018627020-Like-and-comment-posts-and-articles)
- [Action steps delays](https://support.linkedhelper.com/hc/en-us/articles/9042541509138-Action-steps-delays-plug-in)
- [Política do LinkedIn sobre automação](https://www.linkedin.com/help/linkedin/answer/a1340567/automated-activity-on-linkedin)

Os valores dos prints pertencem à configuração exibida naquela conta em um instante,
**não** são limites universais e não devem ser reproduzidos como garantias de segurança.

## Mapa de todas as telas recebidas

| Imagem | Conteúdo objetivo | Requisito no LINKLEADS |
|---|---|---|
| image (13).png | Account Manager: workspaces, lista de contas, filtros All/Running/Stopped/In use/Archived, licenças, proxies, pesquisa, adicionar conta, estado e acesso | Launcher exclusivo; seleção não liga campanhas; estados e filtros próprios |
| image (7).png | Campanha individual: abas Information/Workflow/Profile lists/Inbox/Dashboard, nome da campanha, Start/Stop, fluxo com etapas sequenciais e contagens por etapa | Workspace exclusivo por conta + editor com linha do tempo e painel de parâmetros |
| image (6).png | Dashboard: Social Selling Index, chart e métricas de inbox/campanha, CSV | Painel de indicadores separado dos parâmetros e dos limites |
| image.png | Limite geral e início dos avançados | Limite geral, limites por tipo e limite efetivo após ajuste |
| image (1).png | Convites, eventos/grupos e páginas de busca | Janelas móveis específicas e indicação de restrições da licença |
| image (2).png | Visitas por URL, diferenças LinkedIn/Recruiter/Sales Navigator/Talent | Categorias separadas; não mesclar URLs de todos os produtos |
| image (3).png | Menções e diversos tipos de mensagens | Distinguir 1º grau, evento, grupo, imagem e menção |
| image (4).png | Organização, post liking, perfil | Medidores por ação, URLs e páginas carregadas |
| image (5).png | Perfil, contatos, webhook/CRM | Separar chamadas externas e páginas visitadas |
| image (8).png | Curtir/comentar: nome, adiamento, plataforma, quantidades, idade e habilitação do comentário | Aba Geral por ação com parâmetros reais |
| image (9).png | Template vs IA; objetivo, idioma, tamanho e tom | Aba Conteúdo/IA, com parâmetros propagados ao gerador |
| image (10).png | Etiquetas após sucesso e horário por ação | Regras de CRM e horários, quando existir executor e persistência |
| image (11).png | Lotes, pausa entre lotes, modo de digitação e presets de intervalo | Controle de ritmo com respeito ao horário global |
| image (12).png | Intervalos por microetapa, manual/fast/safe | Microetapas validadas, sem confundir pausa com autorização de executar |

## Matriz de limites: valores observados

Transcrição dos prints, não recomendação de volume. Quando duas regras aparecem para
o mesmo item, ambas devem ser avaliadas e vale a mais restritiva. `Sem limites`
significa **ausência de uma regra avançada configurada para aquele item no Linked Helper**,
não ausência de limites no LinkedIn.

| Atividade LH em inglês | Valor no screenshot | Janela | Particularidade |
|---|---:|---:|---|
| Daily activity limit | 200 | 24 h | **Acima** dos 150/24 h recomendados pelo próprio Linked Helper |
| Employees extractor | 100 | 24 h | Variação 10%; mostra 0 de 94 |
| Endorse my contacts | Sem limite avançado | — | Não há regra específica exibida |
| Follow/Unfollow profiles | Sem limite avançado | — | Não presume que ações sejam ilimitadas |
| Find profile emails | Sem limite avançado | — | Eventual visita a perfil continua contando |
| InMail to 2nd & 3rd contacts | Sem limite avançado | — | Não equivale a ausência de restrições LinkedIn |
| Connect with 2nd and 3rd degree contacts | 100 | 168 h | 7 dias móveis, variação 10%; mostra 0 de 95 |
| Invite person to event | 20 | 24 h | Restrição da licença Standard; mostra 0 de 19 |
| Invite to group | 20 | 24 h | Licença Standard; 0 de 19 |
| Invite to follow organization | 20 | 24 h | Licença Standard; 0 de 18 |
| Load LinkedIn search results | 100 | 24 h | 0 de 93 |
| Load LinkedIn page via URL | 80 | 24 h | 0 de 75 |
| Load Recruiter page via URL | 500 | 24 h | 0 de 484 |
| Load Sales Navigator page via URL | 500 | 24 h | 0 de 460 |
| Load Recruiter (Talent) page via URL | 500 | 24 h | 0 de 498 |
| Load page via URL | Sem limite avançado | — | Não é um teto universal |
| Mention person in a comment | 20 e 100 | 24 h cada | Uma regra de licença Standard e outra configurada; mais restritiva prevalece |
| Message to 1st connections | Sem limite avançado | — | Não confundir com recomendação do fabricante |
| Message to event attendees | 20 | 24 h | Licença Standard |
| Message to LinkedIn group members | 20 | 24 h | Licença Standard |
| Message with attached image | 20 | 24 h | Licença Standard |
| Load organization via URL | Sem limite avançado | — | Categoria separada de LinkedIn organization |
| Load organization page | Sem limite avançado | — | A navegação ainda pode gastar atividade geral |
| Load LinkedIn organization via URL | 40 | 24 h | 0 de 37 |
| Post liking | 20 | 24 h | Licença Standard; mostra 0 de 19 |
| Load profile via URL | Sem limite avançado | — | Categoria genérica distinta |
| Load profile page | 150 | 24 h | 0 de 137 |
| Load LinkedIn profile via URL | 40 | 24 h | 0 de 37 |
| Load Sales Navigator profile via URL | Sem limite avançado | — | Não garantir navegação irrestrita |
| Load Recruiter (Talent) profile via URL | Sem limite avançado | — | Separar por plataforma |
| Remove from 1st connections | Sem limite avançado | — | Ação não configurada no print |
| Send organization to Webhook | 20 | 24 h | Restrição de **licença**, não limitação da plataforma |
| Send person to external CRM | 20 | 24 h | Restrição de licença |
| Send person to Webhook | 20 | 24 h | Restrição de licença |

**Semântica obrigatória:** `Max / N hours` é janela móvel; `Used X of Y`
mostra uso medido versus limite **efetivo**; `Smart Daily Limit Adjustment = 10%`
aplica uma redução variável, não concede margem adicional. 168 h são 7 dias corridos
retroativos. Restrições da licença Standard dizem respeito ao produto Linked Helper.
Contadores do LINKLEADS observam apenas eventos registrados pelo aplicativo:
atividade manual em outro dispositivo não entra automaticamente.

## Limites documentados versus limites da conta mostrada

| Conceito | Documentação oficial Linked Helper | Screenshot | Política prudencial LINKLEADS |
|---|---|---|---|
| Atividade global | 150 por 24 h como padrão recomendado | 200/24 h | teto interno 150/24 h |
| Visitas a perfil por URL | 40 por 24 h sugerido | 40/24 h específico LinkedIn | teto interno 40/24 h |
| Conexões | orientação inclui 50/24 h para contas estabelecidas; novas exigem prudência adicional | 100/168 h | 20/24 h e 100/168 h |
| Curtidas | limite variável; print inclui 20/24 por licença | 20/24 h | 30/24 h interno; **ajustar para 20** se desejar mesmo ritmo do print |
| Comentários | categoria avançada separada | não isolada nos prints | 20/24 h interno |

Valores internos são **políticas configuráveis somente para reduzir**, não proteção
contra detecção nem garantia de conformidade. O LinkedIn proíbe várias automações
não autorizadas; a disponibilização comercial das operações externas depende
de autorização e revisão dos termos aplicáveis.

## Curtir e comentar: contrato funcional do screenshot + manual

### Geral — disponíveis/observados

- `Like X articles` — quantidade de artigos por perfil (no print **0**).
- `Like Y posts` — quantidade de posts por perfil (no print **1**).
- `Ignore articles older than` — toggle desligado no print; campo **183 dias**
  aparece desabilitado: não aplicar filtro quando toggle está desligado.
- `Ignore posts older than` — também desligado no print; campo 183 dias inativo.
- `Add comment to post or article` — toggle ligado.
- `Postpone action start` — data/hora por ação, com escopo da conta.
- `Override platform` — permitir especificar LinkedIn/Sales Navigator/Recruiter,
  **somente** quando houver implementação e direito de acesso.

### Conteúdo

- `Template` (variações/spintax/IF–THEN–ELSE) ou `AI-generated`.
- IA recebe objetivo de comentário, idioma, comprimento e tom;
  print mostra **Português**, **Médio (3–4 frases)** e **Profissional**.
- Modo manual de revisão antes do envio deve permanecer disponível.
- A ação do manual comenta **após curtir**; se ambos os números de curtidas
  forem zero, não deve comentar.
- Se os primeiros X posts já estiverem curtidos, o manual descreve procura
  pelos próximos X ainda elegíveis.
- Ausência de conteúdo e falha de leitura não são a mesma situação:
  `NO_POST` apenas para ausência comprovada; layout desconhecido requer diagnóstico.
- Contagem por tipo (posts vs artigos), confirmação da reação e publicação
  devem ser auditáveis por URN canônica e contato.

### Plugins/condições

- Etiquetas: adicionar e remover após êxito confirmado (não após clique ou
  simples preparação do comentário).
- Horário de trabalho individual de cada ação, dentro do horário global.
- Tamanho do lote (no print 10 perfis) e descanso entre lotes (1 minuto).
- Entrada de texto Random / Insert / Type; uso deve respeitar a política da plataforma.
- Presets Manual / Fast / Safe, mais mínimos e máximos por microetapa.
  No screenshot com Fast: ir ao perfil **10–70 s**, e várias etapas internas
  configuradas **1–3 s**. Isso descreve a conta do print, **não** indica nível seguro.
- Comportamento de Skipped/Failed deve respeitar o lugar da ação na sequência
  e nunca reenfileirar ação de resultado incerto sem conciliação.

### Matriz de implementação real LINKLEADS

| Parâmetro/efeito | Código atual | Situação |
|---|---|---|
| Encontrar atividade e curtir 1 publicação própria elegível | `likeLatestPost` | Implementado, depende de layout e URN verificáveis |
| Idade máxima e incluir compartilhamentos | `LikeSettings` | Implementado |
| Identidade canônica do post e confirmação após clique | PR #13 | Em homologação |
| Gerar 1 comentário após post curtido, modo manual/auto | `commentWithAi` | Implementado, depende de layout correto |
| Objetivo, idioma, comprimento e tom no prompt | PR #14 | Implementado na branch, sob testes |
| Artigos separados de posts | — | **Sem executor** |
| Curtir X posts por pessoa (X maior que 1) | — | **Sem executor** |
| Comentar múltiplos conteúdos por pessoa | — | **Sem executor** |
| Etiquetas automáticas pós-sucesso | — | **Sem executor** |
| Horários por etapa, plataformas override, lotes e microdelays individuais | — | **Paridade pendente** |
| Template e Spintax específico de comentário | — | **Paridade pendente** |

**Não expor controles operacionais para itens pendentes.** Um parâmetro com
interface que não altera o motor representa falso positivo de funcionalidade.

## Especificação visual a implementar

Paleta LINKLEADS preservada: `#6816A8` roxo identidade,
`#4A1078` roxo profundo, `#FF682C` CTA,
`#F8F6FA` fundo claro, `#FFFFFF` cards;
verde `#14713F` êxito e vermelho `#A8221F` erro.
O Linked Helper dos prints usa fundos `#282A30`, blocos `#404149`,
realce `#394E81`; **reaproveitar a hierarquia**, não copiar marca ou arte.

1. **Launcher:** tabela de contas, pesquisa, abas por situação, estado individual,
   sessão e licenças. Abrir uma conta nunca deve iniciar execução.
2. **Workspace da conta:** cabeçalho fixo com perfil, estado, pausa; sidebar de
   campanhas, CRM, LinkedIn, dashboards, inbox e configurações.
3. **Campanha individual:** abas Informação / Fluxo / Listas / Inbox / Dashboard;
   a seleção de uma campanha não deve modificar outras contas.
4. **Fluxo:** catálogo pesquisável e separado; cartões verticais por etapa,
   conexão clara, sucesso/falha/ignorados, painel de configuração fixo à direita
   nos monitores largos. Responsivo em janelas estreitas.
5. **Inspetor de ação:** seções Geral, Conteúdo/IA, Etiquetas, Horários,
   Intervalos e Condições. Somente controles suportados funcionam.
6. **Limites:** total global, grupos avançados, variação, janela, usados e
   efetivo; `+` adiciona regra, remover só elimina regra personalizada,
   nunca o teto protegido; ação de salvar com revisão de mudanças.
7. **Acessibilidade:** navegação via teclado, labels explícitos, foco visível,
   rolagem independente dos painéis e contraste suficiente.

Critério visual: captura de tela da versão Windows nas mesmas resoluções,
inspeção da hierarquia e 14 verificações comparativas. Automação de screenshot
não prova sozinha clareza/estética; revisão visual humana é necessária.

## Gating de produção

- CI com typecheck, unitários, SQLite e Electron E2E verde no **SHA exato**.
- Migrações sem perda de dados e restauração de backup em Windows.
- Testes de limites em janelas móveis (1/24/168 h), conta nova, regra ausente,
  variação 10%, maior/menor que guardrail, pausas e orçamento gasto.
- Para curtida/comentário: feed vazio, repost, autor diferente, post antigo,
  URN sintética, post já curtido, duplicidade textual, seletor ausente,
  verificação inconclusiva, checkpoint e conta pausada.
- Diagnóstico real **somente leitura** com permissão e sessão íntegra.
  Checkpoint deve ser resolvido manualmente; não tentar contorná-lo.
- Homologação real só pode ser declarada com evidência de operações autorizadas,
  sem interferir em limites e políticas da plataforma.

## Estado da entrega

PR #14: tetos internos, UI de limites e campos realmente ligados à IA.
PR #13: identidade canônica e confirmação de comentário por novo efeito.
PR #12: registro unificado e contratos dos 13 executores, já integrado no main
conforme auditoria anterior, mas CI novo do main precisa ser consultado.
Nenhum desses trabalhos deve ser confundido com liberação irrestrita real.
