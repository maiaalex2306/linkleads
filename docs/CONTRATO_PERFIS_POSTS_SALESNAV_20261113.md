# LINKLEADS — Contrato permanente: resolver perfil, encontrar post e preparar interação

Data: 2026-11-13. Diretorio de instalacao imutavel: `D:\LINKLEADS`.

## 1. Identidade (bloqueador P0)
- A URL /sales/people/ACw... é ORIGEM, não URL pública.
- Preservar endereço inteiro, hash com caixa original e tokens após as vírgulas.
- Guardar `member_id` separadamente. O número decodificado de ACw apenas ajuda a conferir identidade; **não inventa slug**.
- O identificador /in/ACo... ou /in/ACw... é sensível a maiúsculas/minúsculas. Comparar exatamente se opaco.
- Na sessão autorizada, avaliar URL pública conhecida, tentativa `/in/{ACw_core}/` (NÃO garantida), URL Sales original, rota antiga de member_id (somente fallback). Conferir destino e página real.
- NUNCA associar primeiro link /in/ encontrado no feed, sugestões ou comentários; extração canônica restrita à página de identidade.
- Falhas de login/checkpoint/autorização interrompem o fluxo, sem contorno; busca por nome/empresa é só candidato para confirmação humana.
- Somente após verificar nome/perfil, URL final e conflito com outros registros persistir no MESMO ID do lead. Não duplicar nem excluir campanhas.

### Evidência de dados — CSV enviado pelo usuário
`AUTOMOTIVO_AUTOPECAS_MOBILIDADE_INDUSTRIAL_821_LEADS_MENSAGENS_V3_AUDITADAS.csv`:
821 registros, 685 colunas; 809 URLs Sales Navigator, 12 URLs públicas `/in/`, 818 `sn_hash_id`, 818 `member_id`, 16 `public_id`. Outros três possuem URL pública sem `public_id`; portanto 19 com referência pública e 802 sem referência pública persistida. **NÃO versionar o CSV de contatos no repositório.**

## 2. Posts e comentários (etapa seguinte, em separado)
- Localizar o cartão de autoria do perfil correto, com URN de post e estado de reação dentro do MESMO cartão. Não selecionar posts de outros autores, URN fictícia ou reação desconhecida.
- Autor `/in/ACo...` comprovadamente igual ao publicId do lead **é válido**; não rejeitá-lo pelo prefixo, nem transformar em minúsculas.
- Expandir `ver mais` quando necessário. Interpretar conteúdo, autor, contexto, data e mídia sem misturar texto de comentários/controles.
- Usar IA para comentário contextualizado, com base apenas no post e dados autorizados, evitar fatos inventados, spam, URLs e repetição. Submeter à aprovação configurada.
- Após interação permitida, verificar mudança de estado de curtida/comentário no mesmo cartão. Se incerto, não repetir automaticamente.
- Parar no primeiro checkpoint de segurança da plataforma.

## 3. Diagnóstico de mudanças da interface
- Mapa de seletores versionado, vários candidatos semânticos por componente e saúde por rota.
- Registrar seletor usado, URL final, erro, versão e o status do componente; diagnosticar `UI_CHANGED` sem enviar ação ao alvo errado.
- Testes de DOM em ambiente local/sintético e verificação supervisionada da plataforma autorizada são gates separados.
- Nunca mascarar `webdriver`, identidade de dispositivo ou burlar controles de risco. O sistema deve operar de forma visível e autorizada.

## 4. Distribuição Windows (padrão obrigatório)
- Único instalador: `INSTALAR-LINKLEADS.cmd` na raiz do ZIP.
- Único destino: `D:\LINKLEADS` (APP/LinkLeads.exe, relatórios e atalho), sem subpastas por versão.
- Atualizar com backup local SHA-256 obrigatório, staging e rollback do código;
  nunca excluir campanhas nem usar NSIS.
- Antes de liberar: testes de identidade, posts, compilação, janela visível, instalação real em D:\LINKLEADS, reparo, atalho e SHA-256 no runner Windows.
- **Testes simulados não comprovam que 802/802 hashes são resolvíveis em conta Basic.** A homologação real com consentimento continua obrigatória.

## 5. Ordem de aceite
Importou → preservou identidade → abriu rota → conferiu perfil → persistiu → identificou próprio post → analisou conteúdo → aprovou comentário → interagiu → confirmou. Uma falha em uma etapa não transforma automaticamente as anteriores em sucesso nem gera repetição de ação.
