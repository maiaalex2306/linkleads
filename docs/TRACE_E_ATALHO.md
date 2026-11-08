# TRACE de diagnóstico e inicialização no Windows

## Instalar o atalho na área de trabalho

Abra o PowerShell na pasta local do repositório `linkleads` e execute **uma vez**:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-desktop-shortcut.ps1
```

O instalador cria **LINKLEADS.lnk** na Área de Trabalho do Windows, inclusive se redirecionada ao OneDrive. O atalho executa, na pasta do repositório:

1. `git pull --ff-only` (não substitui nem destrói alterações locais)
2. `npm.cmd run build`
3. `npm.cmd run dev -w @linkleads/desktop` (inicia o Electron sem compilar o desktop novamente)

Se o Git ou a compilação falharem, o programa não é iniciado. O console informa o erro. Na instalação inicial, execute `npm ci` uma vez.

## TRACE persistente

Pasta: `app.getPath('userData')/traces/<accountId>/trace-AAAAMMDD-NNN.jsonl`. Eventos gerais do processo ficam em `traces/system/`. Cada linha JSON contém timestamp UTC, sessionId, sequence, area, event, level e, quando aplicável, accountId, campaignId, actionId, personId, requestId e outros metadados.

O TRACE registra controles acionados na interface, solicitações do usuário com duração e resultado, navegações, cliques e rolagem **executados pelo próprio software**, quantidades de caracteres digitados (sem conteúdo), campanhas, ações, filas, aprovações, erros do navegador e exceções não tratadas.

**Limitações intencionais:** ele não é um keylogger, não captura senhas, textos de mensagens, prompts, conteúdos de posts e nem cada clique manual do usuário dentro do site LinkedIn. Registra apenas a navegação dessa janela e as ações disparadas pelo programa.

No topo do aplicativo, clique em **Exportar TRACE**. A exportação inclui a conta selecionada e eventos gerais do processo, limitada a 50 MiB, em JSONL. Filtre por `level=error`, `campaignId`, `actionId`, `personId`.

Rotação de 5 MiB por arquivo, retenção de 14 dias, não bloqueia campanhas se houver erro de gravação. Os erros de bibliotecas podem incluir detalhes inesperados: revise o arquivo antes de compartilhá-lo. O arquivo local não é criptografado.

## Gates de produção

Aprovação do CI e merge não comprovam compatibilidade com páginas reais do LinkedIn. Homologue navegação, identificação de pessoa e post, curtir, comentários e segurança em ambiente autorizado; confirme regras da plataforma, privacidade e instaladores assinados antes de lançamento comercial.
