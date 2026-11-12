# LINKLEADS — Contrato único para entrega Windows

## Objetivo
A partir deste checkpoint, "o EXE compilou" não significa que o aplicativo abriu.
Todos os releases Windows para teste do proprietário devem passar por estes gates antes de distribuição:

1. `npm ci`, `npm test`, `npm run typecheck` e `npm run build` passam.
2. `electron-builder --win dir` gera o diretório `LinkLeads/` completo.
3. `portable-first-window.mjs` abre o **EXE do pacote**, sem servidor fake, usando `APPDATA` temporário; comprova janela `.launcher-page` visível. Não acessar dados reais.
4. Testes E2E em site simulado não substituem o gate 3 nem a operação real com o dono.
5. A raiz do ZIP contém `ABRIR-LINKLEADS-PORTATIL.cmd`, `LinkLeads/`, `manifesto.json` e `LEIA-ME.txt`.
6. O CMD deve detectar outro `LinkLeads.exe` em execução e informar explicitamente. Nunca reiniciar, matar ou apagar o processo antigo automaticamente.
7. O CMD deve gravar `resultado-abertura-linkleads.txt`, distinguir `JANELA_OK`, `OUTRA_INSTANCIA_ATIVA`, `EXE_AUSENTE`, `PACOTE_INCOMPLETO` e `FALHA_ABERTURA`.
8. Nem instalação, nem diagnósticos exigem backup, desabilitação de antivírus, execução de .ps1 não assinado ou remoção de pastas.
9. Publicação via GitHub Releases só após testes Windows aprovados; ZIP deve ser vinculado ao commit e hash SHA256.
10. Homologação com dados reais e LinkedIn real é um gate distinto, não presumido pelos testes em site simulado.

## Defeito de 12/11/2026
O launcher de antes encerrava silenciosamente em algumas condições, não verificava a existência da janela, e o handler `second-instance` podia chamar `app.relaunch()` do executável antigo. Corrigidos para tornar a falha explícita e para bloquear a distribuição quando o pacote não abre uma janela no Windows de CI.

## Contrato de operação
- O único comando para abrir o pacote é o `ABRIR-LINKLEADS-PORTATIL.cmd` na raiz.
- Extrair o ZIP inteiro em uma pasta nova.
- Fechar a versão anterior, sem desinstalar nem apagar campanhas.
- Executar CMD, ler o resultado na mesma pasta.
- A validação `JANELA_OK` prova abertura de uma janela no computador testado, mas não comprova campanhas ou integrações reais.
