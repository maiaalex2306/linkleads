# LinkLeads

App desktop de prospecção B2B: automação com ritmo humano, várias contas isoladas e CRM local.
Funciona como o Linked Helper: um navegador próprio (Electron/Chromium), sem extensão, sem
injetar código na página e sem chamar API não oficial.

> Código e marca são próprios. A arquitetura segue o dossiê técnico público do Linked Helper
> (ver `docs/ARQUITETURA.md`).

## Estrutura

```
linkleads/
├─ packages/core     # domínio: catálogo de ações, motor de campanhas, ritmo/limites, templates
├─ packages/db       # SQLite local por conta (schema + CampaignStore)
├─ apps/desktop      # Electron: Launcher + uma instância isolada por conta
└─ docs/             # arquitetura, roadmap, riscos
```

## Começando

Requer Node.js 22 ou mais recente.

```bash
npm install
npm run build
npm test
npm run dev        # abre o Launcher (Electron)
```

Porta CDP opcional, para automação externa: `LINKLEADS_CDP_PORT=9222 npm run dev`.

## Princípios

1. **Emular o humano, não a API.** O input é nativo (`webContents.sendInputEvent`), o mouse
   faz curvas, a digitação tem cadência irregular, e a janela é visível (headful).
2. **Uma conta = um ambiente.** Cada conta tem partição de sessão, proxy, banco e janela próprios.
3. **Só confirma com efeito real.** Uma ação só vira `successful` depois que `verify()` comprova
   o estado resultante. Caso contrário, fica `failed: NO_REAL_EFFECT` e não é repetida.
4. **O produto protege o cliente.** Limites diários com teto fixo, rampa de aquecimento,
   horário comercial, freio automático por taxa de aceite e kill switch por tipo de ação.
5. **Os dados ficam com o cliente.** O banco é local por conta, e a sessão de login nunca sai da máquina.
