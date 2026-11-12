# LINKLEADS — padrão único e permanente de instalação Windows

**Diretório fixo determinado pelo proprietário: `D:\LINKLEADS`. Nunca alterar em próximas entregas sem solicitação explícita.**

## Entrega única

Arquivo público com nome constante `LINKLEADS-INSTALADOR-D-LINKLEADS.zip`.
A raiz do ZIP contém `INSTALAR-LINKLEADS.cmd`, `ABRIR-LINKLEADS.cmd`, `manifesto.json`, `LEIA-ME.txt` e o diretório `LinkLeads/` com todos os binários Electron. **Não utilizar NSIS** no fluxo normal; o antigo instalador ficou apenas para diagnóstico histórico.

O usuário extrai o ZIP completo e executa **`INSTALAR-LINKLEADS.cmd`** na raiz. O programa é instalado em:

- Raiz permanente: `D:\LINKLEADS`
- Executável estável: `D:\LINKLEADS\APP\LinkLeads.exe`
- Inicializador estável: `D:\LINKLEADS\ABRIR-LINKLEADS.cmd`
- Instalador também copiado para: `D:\LINKLEADS\INSTALAR-LINKLEADS.cmd`
- Atalho na área de trabalho: `LinkLeads.lnk` aponta para o inicializador estável
- Relatórios: `D:\LINKLEADS\resultado-instalacao-linkleads.txt` e `D:\LINKLEADS\resultado-abertura-linkleads.txt`

A pasta nunca varia por commit, versão, nome de ZIP ou timestamp. Sem alternativas como `D:\LinkLeads-Seguro`, `D:\LinkLeads-Atualizado` ou `D:\LinkLeads-<sha>`.

## Invariantes

1. **Não executar backup obrigatório**. Não chamar `BASELINE-LINKLEADS.ps1` nem modificar a política PowerShell. Consultas inline de integridade e atalho são permitidas.
2. Preservar tudo que já existe em `D:\LINKLEADS`. A única atualização é a sobreposição de arquivos do aplicativo em `APP/` (`robocopy /E`, nunca `/MIR` ou `/PURGE`). Não apagar arquivos de campanhas nem SQLite, cookies ou contas do `userData` do Electron.
3. Exigir que o LinkLeads anterior esteja fechado antes de atualizar. Não encerrar processos automaticamente.
4. Verificar o SHA256 do executável original e copiado conforme `manifesto.json`.
5. Criar/atualizar atalho da área de trabalho no perfil do usuário atual, apontando para o inicializador estável.
6. Executar o inicializador do destino e confirmar uma janela realmente visível do processo cujo caminho seja `D:\LINKLEADS\APP\LinkLeads.exe`.
7. Se qualquer etapa falhar, escrever o motivo no relatório e **não declarar sucesso**.
8. Empacotar e publicar somente se **o mesmo CMD distribuído** instalar num runner Windows em `D:\LINKLEADS`, criar o atalho e abrir o Electron com `JANELA_OK`.
9. Homologar com dados sintéticos e `userData` isolado no CI. Testes no LinkedIn real são outro portão, supervisionados pelo titular, sem os confundir com a abertura.
10. Os releases terão o mesmo nome de ZIP e um arquivo SHA256. O endereço estável é `https://github.com/maiaalex2306/linkleads/releases/latest/download/LINKLEADS-INSTALADOR-D-LINKLEADS.zip`.

A alteração do nome, destino, método de instalação ou estrutura só pode ser feita mediante pedido explícito do proprietário e acompanhada de testes atualizados.
