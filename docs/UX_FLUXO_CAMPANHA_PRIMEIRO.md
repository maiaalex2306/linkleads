# LINKLEADS — Fluxo principal de operação

**Ordem para o usuário**: (1) Cadastrar conta LinkedIn → (2) Abrir LinkedIn e
entrar manualmente → (3) Criar campanha e escolher objetivo → (4) Configurar
etapas → (5) Importar leads CSV dentro da campanha → (6) Iniciar explicitamente
→ (7) Acompanhar Resultados e Conversas.

## Principais decisões UX

- A central de contas é uma escolha, sem repetição de quatro KPIs operacionais.
- Ao cadastrar uma conta, as credenciais são opcionais e ficam recolhidas.
- Cadastro de leads pelo CSV entra em **Leads da campanha**. A coleção interna é
  um recurso de persistência e reuso, não um pré-requisito conceitual.
- Todas as campanhas abrem **paradas**, com modelo de ações escolhido; criar,
  importar ou entrar na tela não inicia execução.
- O comando **Renomear** fica ao lado do título. Usa atualização direta apenas
  da coluna `campaigns.name`, com proteção contra nomes duplicados ativos;
  não regrava ações, filas, histórico nem configurações.
- A campanha tem cinco áreas: **Preparação, Etapas, Leads, Resultados, Conversas**.
  Apenas Resultados agrega números; códigos internos ficam restritos ao editor.
- Configurações de conta, limites e detalhes do TRACE ficam recolhidos em
  **Ajustes da conta**, **Atividade** e **Mais ferramentas**.
- `accountStats`, `liveStatus` e consultas detalhadas de fila não rodam
  na simples abertura da lista de campanhas. Resumos SQLite agregados são
  reutilizados por conta até 15 s e as respostas antigas de navegação são
  descartadas no renderizador.

## Significado operacional dos estados

- **Parada**: campanha desabilitada (não está na programação).
- **Pronta**: habilitada, executor desligado.
- **Na fila**: executor da conta ligado, aguardando o turno desta campanha.
- **Executando agora**: ação real em andamento nesta campanha.
- **Aguardando**: existe prazo futuro entre etapas.
- **Conta pausada**: bloqueio de segurança em nível de conta; nenhuma campanha executa.

A pausa da conta e a disponibilidade de campanhas permanecem controles separados,
mas o usuário vê apenas o estado operacional relevante, com justificativa.

## Gates de publicação

- CI de tipos, unitários, E2E Electron e aplicação empacotada **verdes no SHA exato**.
- Testar renomear, importar CSV, isolar contas, preservar SQLite e verificar
  que abrir conta/campanha não liga o executor.
- Comparar screenshots no Windows, testar responsividade, contraste e teclado.
- Investigar desempenho real (abertura da lista, campanha, importação, navegação):
  p50/p95 em carteiras de 1k/10k leads, sem confundir tempo do LinkedIn externo.
- Nenhuma alegação de compatibilidade com LinkedIn real até validação independente;
  contas em checkpoint continuam pausadas.
