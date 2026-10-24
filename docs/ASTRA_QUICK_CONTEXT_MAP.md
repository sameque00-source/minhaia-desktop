# Mapa rápido de contexto — Astra Code (MinhaIA)

Índice curto. Antes de abrir um arquivo, busque (`Grep`/`Glob`) o símbolo ou caminho. Detalhe: `docs/ARQUITETURA.md`.
Caminhos conferidos no disco em 2026-10-24 contra o checkout principal (`C:\Users\sameq\Downloads\Astra Code`); alguns (marcados †) só existem lá, não neste branch antigo.

**Visão:** app desktop (Electron) + servidor local Node que roda missões de agentes sobre o MASTER (somente leitura).
Chat nunca executa; Code usa o agente com ferramentas reais. UI em pt-BR.

| Área | Onde olhar |
|---|---|
| CLI / entrada | `bin/minhaia.js` (serve, doctor, verify, select, run, gateway) |
| App Electron † | `desktop/main.js`, `desktop/preload.js` |
| Servidor/API | `src/server/index.js`, `src/server/vnext.js` †, `src/server/voice-routes.js` † |
| Agente (loop, ferramentas, intenção) † | `src/agent/loop.js`, `src/agent/tools.js`, `src/agent/intent.js` |
| Chat/conversas | `src/chat/sessions.js`, `src/chat/store.js` |
| UI (front) | `ui/index.html`, `ui/app.js`, `ui/vnext.js`, `ui/styles.css`, `ui/vnext.css` |
| Voz (STT/TTS) † | `src/voice/*`, `ui/voice-core.js`, `ui/voice-ui.js` |
| Instalação sob demanda / modelos † | `src/setup/installer.js`, `src/setup/downloader.js`, `src/setup/manifests.js`, `src/local/catalog.js` |
| Segurança / sandbox | `src/security/`, `.claude/hooks/guard.js`, `.claude/settings.json` (protegidos) |
| MASTER (sync, lock) | `master.manifest.json`, `master.lock.json`, `src/master/sync.js` |
| Instalador Windows (junctions) † | `build/installer.nsh`, `scripts/gen-installer-nsh.js`, `test/installer-nsh.test.js` — **nunca alterar a proteção** |
| Testes | `test/*.test.js`; `scripts/run-tests.js [fast\|slow]` †; `npm run check` = typecheck+lint+testes |
| Releases † | `Releases/AstraCode` (só 2 instaladores) |

**Documentação (por uso):** arquitetura → `docs/ARQUITETURA.md` · decisões → `docs/DECISOES.md` ·
histórico → `docs/HISTORICO-EXECUCOES.md` † · custo/tokens → `docs/design-toolkit/TOKEN-BUDGET.md` † ·
notas/checkpoint → Obsidian `30-Projetos/MinhaIA` via `node scripts/vault-search.js "<consulta>"` † ·
rotina de eficiência → `docs/CLAUDE-CODE-EFICIENCIA.md`.

**Gerado, não editar:** `vendor/`, `.claude/agents/`, `.claude/skills/`, `data/`, `node_modules/`.

Última atualização: 2026-10-24. Atualize ao criar/mover módulos de topo.
