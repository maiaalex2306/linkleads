> **Registro histórico:** este documento descreve o antigo fluxo NSIS. O único instalador oficial atual e o ZIP portatil versionado em Releases, com `INSTALAR-LINKLEADS.cmd` na raiz e destino imutavel `D:\LINKLEADS`. A partir de 0.5.12, o instalador cria backup local SHA-256 dos dados conhecidos, verifica manifesto de todos os binarios, faz staging e tenta rollback do APP em falha. Ver `docs/FASE7_FASE8_HOMOLOGACAO.md`.

# LINKLEADS — Passo 1: preservação e linha de base Windows

## Escopo e identificação

Esta etapa NÃO altera campanhas nem executa ações no LinkedIn. Protege o estado existente antes de qualquer instalação posterior.

- Código-fonte canônico: `maiaalex2306/linkleads`, branch `main`; versão e SHA local registrados no JSON quando há checkout Git.
- Aplicação desktop: `apps/desktop/package.json` (versão da aplicação); instalação encontrada em `%LOCALAPPDATA%\Programs\LinkLeads`, `%ProgramFiles%\LinkLeads` ou equivalentes.
- Contas e configuração: `%APPDATA%\LinkLeads` e `%APPDATA%\@linkleads\desktop`.
- Campanhas, filas, aprovações e histórico persistidos nos bancos `Partitions\linkleads-account-*\linkleads.db`, incluindo arquivos `-wal` e `-shm` existentes.
- Sessões, cache e cookies: partições Electron sob o mesmo userData. A rotina não abre senhas/JSON de contas nem consulta conteúdos do banco.
- Instalação: `LinkLeads-Setup-*.exe` identificado no relatório com SHA-256.

## Entradas do pacote na raiz

- `PRESERVAR-LINKLEADS.cmd`: inventaria e cria snapshot, sem abrir instalador.
- `INSTALAR-LINKLEADS.cmd`: verifica integridade do instalador, exige backup validado e então inicia o assistente Windows.
- `BASELINE-LINKLEADS.ps1`: mecanismo local de inventário e backup, com hashes SHA-256 por arquivo.
- `REPARAR-ATALHO-LINKLEADS.cmd`: repara apenas o atalho.
- `SHA256.txt`, `LinkLeads-Setup-*.exe` e `LEIA-ME-INSTALACAO.txt`.

## Execução somente para preservar, sem instalação

1. **Feche** o LINKLEADS e confirme que não existe processo `LinkLeads.exe` ativo.
2. Extraia `LINKLEADS-INSTALADOR.zip` para uma pasta NOVA; não substitua pastas da instalação atual.
3. Execute `PRESERVAR-LINKLEADS.cmd` na raiz.
4. Leia `resultado-baseline-linkleads.json` no diretório `D:\LinkLeads-Seguro\Relatorios` ou, na ausência de D:, `%USERPROFILE%\Documents\LinkLeads-Seguro\Relatorios`.
5. Somente `status=BACKUP_VERIFICADO` com `snapshot.verified=true` aprova a cópia; confira `snapshot.path`, `totals.files` e `totals.bytes`.
6. **Não** compartilhe o diretório do snapshot em chamados: ele contém cookies e dados protegidos da sessão; envie apenas o relatório JSON redigido se necessário.

### Instalação posterior

O assistente de instalação usa a mesma verificação e **aborta antes do NSIS** se o LINKLEADS estiver aberto, houver dados indisponíveis, junction/reparse point, sobreposição de caminho ou qualquer divergência de SHA-256. Não permite criar backup dentro da origem. O snapshot parcial em caso de falha NÃO é apagado automaticamente.

### Limites do inventário

O inventário é de **arquivos e metadados**, não um relatório sobre conteúdo do CRM: comprova a preservação física dos bancos, mas não afirma quantos leads, campanhas ou comentários há em cada banco. Essa conferência lógica e a restauração funcional exigem teste específico com aplicativo/SQLite em ambiente isolado. O CI atual testa fixtures e persistência de conta no Electron, não substitui a checagem do Windows do operador.

### Manter histórico e regressões

O PR desta etapa introduz `scripts/test-baseline-preservation.ps1`, preserva os testes unitários/E2E existentes e exige Windows PowerShell 5.1 no pipeline. O ZIP do proprietário deve conter os dois `.cmd` na raiz (sem subpastas).

## Critérios de produção

- Todos os gates de CI, incluindo Windows NSIS, aprovados no mesmo SHA.
- O workflow `windows-owner-production.yml` da `main` publica **um** arquivo `LINKLEADS-INSTALADOR.zip` com os comandos na raiz.
- Na máquina Windows real, o operador deve gerar o JSON e comprovar `BACKUP_VERIFICADO`. **Nenhum resultado do CI autoriza afirmar que a máquina do operador foi alterada ou que seus dados reais já foram copiados.**
