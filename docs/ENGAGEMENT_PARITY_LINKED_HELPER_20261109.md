# ENG-01 — Paridade funcional: Curtir e comentar publicações e artigos

**Referências externas**: cinco capturas da configuração de ação Linked Helper 2 fornecidas pelo proprietário; documentação oficial pt `https://support.linkedhelper.com/hc/pt/articles/360018627020-Curtir-e-comentar-publica%C3%A7%C3%B5es-e-artigos` (atualizada 27/09/2026); `https://www.linkedhelper.com/pt/features/ai-comments`.

## Contrato funcional Linked Helper (ação única)
Uma ação, um lugar no workflow, com grupos de configuração:
- **Geral:** nome; adiar início; override de plataforma (LinkedIn / Sales Navigator / Recruiter); quantidade de artigos curtidos; quantidade de posts curtidos; ignorar conteúdos antigos em dias (filtros independentes e opcionais); ativar comentário.
- **Comentários:** fonte Template (Spintax e IF–THEN–ELSE/variáveis) OU AI-generated; objetivo textual; idioma; comprimento (1–2 / 3–4 / 5+ frases); tom (Friendly / Professional / Casual); a IA deve considerar conteúdo do post, nome e headline do autor.
- **Atrasos:** presets Manual / Fast delays / Safe delays, método de texto Random / Insert / Type; seis faixas de delay (navegar ao perfil, abrir todas as atividades, curtir artigo, comentar artigo, curtir post, comentar post); lote padrão 10 perfis; espera entre lotes 1 minuto. Para Manual, min/max de cada etapa editáveis e auditáveis; nunca tratar as faixas como permissão de violar limites da plataforma.
- **Etiquetas:** após êxito, adicionar/remover etiquetas do perfil, podendo agrupar contatos.
- **Horários de trabalho:** janela de execução da ação, independente da janela global da conta.
- **Extensões opcionais:** configurações adicionais por plugins da ação e gerais.

## Semântica da ação
1. Selecionar conteúdo do próprio autor na página de atividades, separando posts e artigos.
2. Filtrar por idade e tipo; pular já curtidos e buscar os próximos não curtidos.
3. Sem posts/artigos selecionados (0/0) não comentar. Se uma categoria faltar, processar a categoria disponível e reportar ausência da outra sem falso sucesso.
4. Para cada conteúdo, aplicar like somente se não curtido; verificar estado resultante e contabilizar o efeito.
5. Se comentários habilitados, gerar ou resolver o texto para AQUELE conteúdo, aprovar se necessário, publicar e verificar texto novo especificamente naquela publicação.
6. Falhas incertas interrompem novos efeitos externos; jamais repetir automaticamente uma interação com resultado desconhecido.
7. Cada efeito precisa de identidade estável do conteúdo, histórico, idempotência, limites da conta e recuperação após reinício.

## Matriz de implementação atual (PR #28)
| Recurso | Implementado | Limite |
|---|---|---|
| Ação única LikeAndComment no catálogo, editor e motor | Sim | Legados preservados para histórico |
| Nova campanha com uma etapa de engajamento | Sim | Sem migração destrutiva automática |
| Curtir 1 post próprio/recente | Sim | Somente post com URN canônica e autor comprovado |
| Comentário com IA, tom, comprimento, idioma, objetivo | Sim | Aprovação manual padrão; automático opcional |
| Verificar curtida e comentário, proteger contra duplicação | Sim | Site simulado; homologação real pendente |
| Contagem independente de likes e comments | Sim | Inclui curtida antes de aprovação pendente |
| Artigos em aba separada | NÃO | Precisa extrator, URL canônica e E2E próprios |
| 2+ posts ou artigos / várias aprovações por uma ação | NÃO | Precisa execução multi-item e identidade de rascunhos por URL |
| Filtro de idade diferente para posts e artigos | NÃO | Só filtro de posts |
| Template/Spintax/IF-THEN-ELSE | NÃO | Validador/renderizador e segurança contra comentários genéricos |
| Override de plataforma | NÃO | Depende de leitor DOM Sales Navigator/Recruiter |
| Lotes e delay presets por passo | NÃO | Motor atualmente usa maxResults e coolDown genéricos |
| Adiar início por data e working hours por ação | NÃO | Requer relógio por etapa, timezone e DST |
| Adicionar/remover etiquetas | NÃO | Requer persistência `person_tags` e API |
| Extensões de plugins da ação | NÃO | Requer modelo versionado de capabilities |

## Portões de homologação
- CI unitários/types e novo E2E Linux/Windows verde no SHA exato; regressão de convites, prospecção, aprovações, limites.
- Testar com DOM simulado de artigo, post, repost, post curtido, autor incerto, data não reconhecida, sem conteúdo, comentário preexistente, timeout e bloqueio.
- Testar migração de cópia real da base, backup, rollback, integridade dos status e aprovação pendente.
- Validar operação em conta autorizada sem bypass de mecanismos de proteção da plataforma.
- Medir p50/p95 de navegação, extração, seleção, IA, escrita, confirmação, SQL e UI.

**Declaração obrigatória:** esta primeira implementação NÃO constitui paridade integral da ação Linked Helper, apesar de o fluxo ser visualmente uma única ação.
