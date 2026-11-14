# LINKLEADS — Fase 0, linha de base congelada

- Versao imutavel de referencia: **0.5.13**.
- Commit: `12937e2264316d87cc5ecc2d6c29d8130e27d2e0`.
- Release oficial: `v0.5.13-windows-12937e22`.
- ZIP oficial SHA-256: `48574d2c9cc52576f0a26840870eae0d97ac1ced65c542552de2188e7880c2c8`.
- CI oficial de referencia: run `43621447799`, 13/13 jobs concluidos com sucesso.
- Publicador Windows: run `43622140401`, 2/2 jobs concluidos com sucesso.
- Esses resultados sao **historicos**, anteriores a quaisquer novas modificacoes de Fase 1.

## Contratos protegidos
- `profile-resolver.ts`, blob SHA1 `6c3ff2dced70952499cc605987f4e4e8abd7b50e`.
- `packages/core/src/import/csv.ts`, blob SHA1 `570ae56547b5a924ce3a5409b3e5f2fdc9a415d2`.
- `packages/db/src/index.ts`, blob SHA1 `42ec41c495ea01f26cb72d3a6bb5cec54e194677`.
- `scripts/INSTALAR-LINKLEADS.cmd`, blob SHA1 `c616e480d1c2f0d3f400ce95c756069a20c09033`.
- `executors.ts#gotoProfile`: comparacao byte-a-byte com `git show` do commit imutavel.
- `instance.ts#runTick`: continuar SEM leitura automatica da caixa de entrada.

## Arquivos da Fase 1 — hashes originais Git
- `executors.ts`: `b56b5ac88bcab62ffcdde53c4d52d287c4f32ce0`.
- `dom-scripts.ts`: `50055dc80927b94fa9803d4d641352db89a88a45`.
- `page-driver.ts`: `fdbfc1d44de5a5acb3956353cbed8e0f8bcee532`.
- `scripts/BASELINE-LINKLEADS.ps1`: `53239b987608e91343138e09cc06b0ec6fa3d742`.

**Importante:** os hashes de blob Git acima sao SHA-1, nao SHA-256. O gate `scripts/verify-phase0-protected.mjs` produz automaticamente um manifesto com SHA-256 dos arquivos originais e modificados e bloqueia mudancas nos contratos protegidos.

## Backup de dados locais
O CI pode comprovar a integridade de snapshots de **dados ficticios**, mas nao possui acesso remoto aos dados reais do computador do usuario. O backup real so sera homologado apos a execucao local de `PRESERVAR-LINKLEADS.cmd`, com o LINKLEADS fechado. O script `BASELINE-LINKLEADS.ps1` produz inventario, snapshot, hash SHA-256 de cada arquivo e verificacao de copia, sem modificar as origens.

**Portao D:** nao atribuir status APROVADO ao backup do computador real ate existir relatorio local `BACKUP_VERIFICADO`.
