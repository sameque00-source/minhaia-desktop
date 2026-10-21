# Relatório completo — MinhaIA

Data: 2026-10-19 · Ambiente: Windows (win32) · Node v24.21.0 · Repositório:
`C:\Users\sameq\Downloads\Minha ia` · Branch `claude/elegant-lovelace-slefxv` (HEAD `78cae09`).

Rótulos de evidência conforme `.claude/rules/20-evidencia.md`:
**[CONFIRMADO]** = verificado por execução/teste neste ambiente · **[INFERIDO]** = leitura de
código/documentação, sem execução · **[NÃO VALIDADO]** = sem verificação possível aqui.

---

## 1. Objetivo

Transformar a MinhaIA em um assistente de programação completo no Windows 10/11 — inspirado em
Claude Code/Codex — capaz de: escolher uma pasta real de projeto, conversar por chat com contexto,
ler e editar arquivos de verdade, executar código com isolamento, testar, se autocorrigir e
revisar com veto. Tudo construído **sobre** a infraestrutura MASTER
(`CLAUDE-MESTRE-FINAL-SKILLS-EM-LOTES-COMPLETO`), consumida **somente leitura**, sem recriar do
zero. Restrições: sem segredos em arquivos/logs, FREE_ONLY, nada de resultado inventado.

## 2. Sumário executivo

| Fase | Escopo | Status |
|---|---|---|
| A | Auditoria da base existente, ambiente, sync/verify/doctor, UI/API de missões | Concluída [CONFIRMADO] |
| B | Processos no Windows: árvore de kill, parada graciosa, recuperação | Concluída [CONFIRMADO] |
| C | Pastas de projeto do usuário com confinamento por realpath | Concluída [CONFIRMADO] |
| D | Chat persistente por projeto + API + UI (chat e navegador de arquivos) | Concluída [CONFIRMADO] |
| E | UX de chaves de provedor | Concluída: `minhaia keys` + painel "Configurar provedor" na UI (caminho real do `.env`) + abrir `.secrets` no desktop; gravação é manual por design |
| F | App desktop (Electron) reusando a mesma API/UI | Concluída e **empacotada** (instalador NSIS + validação do `.exe` de ponta a ponta) [CONFIRMADO por smoke test] |

Números finais: **153 testes, 150 passando, 0 falhando, 3 pulados** (POSIX/`/proc`);
typecheck e lint limpos; `verify` OK (MASTER limpo, HEAD `85b3d4cd…`, 363 arquivos, 0 drift).
Instalador: `dist/MinhaIA Setup 0.1.0.exe` (electron-builder/NSIS, per-user) validado por
`npm run smoke:dist` (missão completa com dublê TEST-STUB rodando dentro do `.exe`).
Nada foi commitado (nenhuma autorização de commit/push foi dada).

## 3. Arquitetura final

```
                MASTER (somente leitura; nunca executado no lugar)
                   │ minhaia sync (manifesto + 10 patches + lock sha256, 363 arquivos)
                   ▼
MinhaIA
 ├─ .claude/agents (25) · .claude/skills (140)      ← sessões Claude Code
 ├─ vendor/master/{ai-orchestrator, ia-avancado}    ← motor + gateway (gerado, gitignored)
 ├─ src/
 │   ├─ master/{sync,verify}.js      materialização e prova de somente leitura
 │   ├─ registry/ selection/ engine/ security/ skills/   registros, seleção, fachada
 │   ├─ projects/{store,browse}.js   registro de pastas + navegação confinada
 │   ├─ chat/{store,reconcile}.js      histórico por projeto (jsonl) + fechamento na leitura
 │   ├─ missions/{store,manager,worker,instrument,views,scope}.js
 │   │                               missão = processo worker; sandbox; confinamento real
 │   └─ server/index.js              API + UI + SSE (um único motor)
 ├─ ui/                              HTML/CSS/JS sem framework (CSP estrita)
 ├─ desktop/{main,preload}.js        shell Electron (mesma API/UI)
 └─ data/ · .secrets/                estado de runtime e segredos (gitignored)
```

Princípio central: **não existe segundo motor**. A API, a CLI e o desktop observam/comandam a
máquina de estados do motor do MASTER; observabilidade vem de instrumentação (wrappers), não de
fork.

## 4. O que foi implementado, por fase

### Fase A — fundação (já existente na sessão anterior, revalidada aqui)

- `sync` consome 5 fontes declaradas (ai-orchestrator 7 arquivos, ia-avancado 121, overlay de
  agentes 25, `.claude/agents` 25, `.claude/skills` 204) e cria 7 links de runtime para `data/`
  e `.secrets/`; lock com sha256 origem/destino (363 arquivos).
- `verify` prova somente leitura (git status do MASTER + HEAD + hashes + links desviados).
- `doctor` checa ambiente, MASTER, 25 agentes, 140 Skills e chaves.
- Registro/seleção determinística, gateway :20130 com 3 patches de segurança, sandbox do código
  gerado (permissões do Node + preload de rede), API/UI de missões com SSE.

### Fase B — processos no Windows [CONFIRMADO pelos testes de cancelamento/timeout/fim]

- `killGroup` (manager) usa `taskkill /PID <pid> /T /F` no Windows; POSIX mantém sinal de grupo.
- `worker.js`: `killOwnGroup` (taskkill da própria árvore) e `gracefulStop` unificado
  (SIGTERM/IPC `stop`), com guarda contra parada dupla.
- `terminate` no Windows confia no IPC (sem SIGTERM) e mantém killTimer de 5 s como rede.
- Handler `done` tolera job removido (corrida de mensagem tardia não derruba a API).
- Ressalva honesta: identificação do dono continua por **PID** fora do Linux (sem `/proc`), e a
  recuperação de grupo órfão é conservadora no Windows [INFERIDO por leitura de código].

### Fase C — pastas de projeto do usuário [CONFIRMADO pela suíte `projects`]

- `src/projects/store.js`: registro em `data/projetos/projetos.json` (ou `MINHAIA_PROJECTS_FILE`).
  Recusa raiz de unidade, pasta inexistente/arquivo, MASTER (ou dentro dele), caminhos com
  segmento `.secrets` e duplicatas por realpath. Id `prj_` + sha1(realpath)[0:12]. Remover do
  registro **nunca** apaga arquivos.
- `src/missions/scope.js`: `assertInside(raiz, alvo)` por caminho real, injetado no motor pelo
  patch `workspace-realpath-guard`. Fecha o furo descoberto: `node --permission` **não** resolve
  junction/symlink (escrita através de junction criada no workspace escapava do grant).
- Patch `project-workspace`: `pastaWorkspace()` devolve `MINHAIA_PROJECT_DIR` quando definido — a
  pasta escolhida **é** o workspace da missão (sem copiar o projeto). Sem a variável, o
  comportamento original permanece.
- Patch `ferramentas-erro-link` (3 pontos): erro de confinamento vira `{ok:false, erro}` para a
  autocorreção reagir, em vez de estourar a missão.
- `findWorkspaceLink` (instrumentação): recusa link quebrado, link que resolve para fora e
  hardlink; aceita link interno; não desce em diretórios pesados (`node_modules`, `.git`, `dist`,
  `target`, `vendor`…), mas confere os filhos diretos do workspace.
- `sandbox-preload.js`: bloqueia **criação** de symlink/hardlink (`fs` e `fs/promises`) com
  `ERR_MINHAIA_LINK_DENIED` (independente do bloqueio de rede).
- `src/projects/browse.js`: navegação/leitura/busca confinadas por realpath, ignora links,
  limites de 256 KB por arquivo, 2000 entradas por pasta, 100 resultados e 50 mil arquivos.
- Missão com projeto removido/pasta ausente vira `BLOQUEADA` antes de gastar LLM.

### Fase D — chat por projeto [CONFIRMADO pela suíte `chat` e pelo teste desktop]

- `src/chat/store.js`: um `.jsonl` por projeto (`data/chat/<prj_id>.jsonl` ou `MINHAIA_CHATS_DIR`),
  texto redigido, ≤ 8000 caracteres, ids `msg_…`, limpeza/limite na leitura.
- Enviar mensagem cria uma **missão real** com preâmbulo das últimas 6 trocas (≤ 1800 chars,
  400 por turno) + `Pedido atual: …`; a mensagem guarda `missionId`.
- No evento `finished`, o servidor grava a resposta-resumo da missão (status, arquivos, motivo).
  Não há segundo agente conversacional.
- API: `GET/POST /api/projects`, `PUT/DELETE /api/projects/:id`,
  `GET /api/projects/:id/files|file|search`, `GET/POST /api/projects/:id/chat`.
- UI: card de projeto (adicionar/remover/selecionar; id em `localStorage`), tela de chat com
  histórico e chips de missão, navegador de arquivos com busca e visualização.
- Resposta perdida em reinício: `src/chat/reconcile.js` fecha na leitura (idempotente) qualquer
  pedido cujo job já terminou [CONFIRMADO por teste de reinício do servidor com o arquivo do chat
  mutilado e por teste unitário de reconciliação].

### Fase E — chaves de provedor (concluída, gravação manual por design)

- `minhaia keys`: mostra arquivo (`.secrets/.env`), o que está configurado, o que falta e o
  modelo a colar. **Nunca** grava chave — regra do projeto: segredo só o humano grava.
- Chip de LLM na UI virou botão: abre o painel "Configurar provedor" com o caminho real do `.env`
  (via `providers.envFile` no `/api/system`) e a lista de chaves aceitas; no desktop há o botão
  "Abrir pasta .secrets" (IPC `desktop:open-secrets`, sem cruzar nenhum valor).
- `doctor` detalha; missão bloqueada mostra o motivo com instrução.

### Fase F — app desktop empacotado [CONFIRMADO por smoke test com Playwright `_electron`]

- `desktop/main.js`: inicia a mesma API em processo (porta efêmera em loopback), abre a mesma UI
  numa `BrowserWindow` com `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`.
- `desktop/preload.js`: ponte mínima — `minhaiaDesktop.chooseFolder()` (diálogo nativo de pasta) e
  `minhaiaDesktop.openSecretsFolder()` (abre `.secrets` no sistema). A UI mostra o botão "Pasta…"
  só quando a ponte existe.
- Navegação externa bloqueada; `https:` abre no navegador do sistema; instância única
  (`requestSingleInstanceLock`); ao fechar, o mesmo `shutdown` da API interrompe missões e fecha.
- `npm run desktop` (Electron 44.9.0 em devDependencies).
- **Pacote**: `npm run dist` (electron-builder 26 + NSIS, `asar: false`, instalação per-user) gera
  `dist/MinhaIA Setup 0.1.0.exe`; links de runtime e `.secrets` ficam **fora** do pacote (teste
  confere contra `master.runtimeLinks`) e `ensureRuntimeLinks()` os recria no boot para o `data/`
  do app; no Electron empacotado o worker roda com `ELECTRON_RUN_AS_NODE=1`; sem o MASTER de origem,
  `verify` cai em modo limitado (cópias × hashes do lock, HEAD do lock) e a UI mostra "MASTER
  íntegro (cópias)". `npm run smoke:dist` valida o `.exe` real: janela, pasta adicionada, missão
  completa com dublê TEST-STUB, arquivo gerado na pasta do projeto e chat com resposta [CONFIRMADO].
- Scripts de conveniência: `scripts/serve.cmd`, `scripts/desktop.cmd`, `scripts/check.cmd`.

## 5. Patches aplicados no MASTER (10 no total)

| Patch | Alvo | Efeito |
|---|---|---|
| `windows-aiorch-path` (9×) | vários do motor | troca caminho absoluto Windows do AI-ORCHESTRATOR pela cópia vendorizada |
| `windows-audio-env-path` | `multimidia/core/audio.js` | idem, escrito com `path.join` |
| `gateway-bind-loopback` | `gateway/server.js` | escuta só em loopback por padrão |
| `gateway-noauth-host-check` | `gateway/server.js` | sem chave, exige `Host` de loopback (anti DNS rebinding) |
| `gateway-log-redaction` | `gateway/server.js` | log com redação de segredos |
| `skills-context` | `executor/core/handlers-tarefa.js` | injeta Skills escolhidas por tarefa junto da persona |
| `extra-specialists` | `registro-especialistas.js` | 19 → 25 especialistas (os 6 canônicos restantes) |
| `project-workspace` | `executor/core/workspace.js` | workspace = pasta do usuário (`MINHAIA_PROJECT_DIR`) |
| `workspace-realpath-guard` | `executor/core/workspace.js` | confinamento por realpath na gravação |
| `ferramentas-erro-link` (3×) | `executor/core/ferramentas.js` | erro de caminho vira resultado estruturado |

Todos com contagem esperada (`expectCount`): se o MASTER mudar, o `sync` aborta sem tocar a
instalação anterior. O MASTER permanece intacto [CONFIRMADO: `verify`].

## 6. Segurança — achados e mitigações

1. **Junction escapava do sandbox** [CONFIRMADO com teste de regressão]: `node --permission`
   confia no caminho textual; junction criada dentro do workspace permitia escrever fora.
   Mitigação: `assertInside` (realpath) no motor + `{ok:false}` nas ferramentas + preload não
   deixa criar links.
2. **Política de links** (ADR-18): link interno aceito, externo/quebrado/hardlink recusado;
   diretórios pesados não percorridos; criação bloqueada com `ERR_MINHAIA_LINK_DENIED`.
3. **Rede do código gerado bloqueada** (preload imutável): TCP, UDP, `fetch`/WebSocket e DNS
   (incluindo consultas no C++, que seriam canal de exfiltração); escutar porta continua
   permitido para servidores gerados serem testados. Opt-out consciente via env.
4. **Sandbox de comandos**: só `node` roda, com lista de permissão de argumentos
   (`--run`, `-r`, `--import`, `--env-file` etc. recusados); outros interpretadores recusados
   salvo opt-in.
5. **Segredos**: só em `.secrets/.env` (humano grava); `keys`/`doctor`/logs nunca expõem valores;
   redação por valor em eventos e gateway.
6. **Pastas de projeto**: validação recusa MASTER/`.secrets`/raiz/inexistente; DELETE só remove
   do registro; API só em loopback, escrita exige JSON + `Origin` válido, corpo ≤ 16 KB.

## 7. Testes e evidências

- `npm run check` = typecheck + lint + testes. Resultado desta rodada [CONFIRMADO]:
  **153 testes · 150 pass · 0 fail · 3 skipped**.
- Suítes relevantes: sync/verify/lock (inclui modo limitado sem a origem e exclusões do pacote
  contra o manifesto); registros e seletor; guard (50+ casos de bypass);
  redação; memória/autocorreção; gateway; **API** (rotas, SSE, segurança);
  **integração de missão** (dublê de LLM só em teste): plano→execução→arquivos→cancelamento→
  timeout; **sandbox E2E** (escape, secrets, network, dns, python); **projetos** (8: registro,
  confinamento, junction, links, API, projeto removido → BLOQUEADA); **chat** (4: redação/
  preâmbulo, reconciliação unitária, reinício real do servidor com resposta recuperada, e fluxo
  via API); **UI no Chromium** (3, XSS, zero erros de console e teste dedicado do projeto:
  pasta → chat → missão → resposta → navegador de arquivos → busca → guia de chaves);
  **desktop** (1: Electron real via Playwright, pontes de pasta/segredos e projeto adicionado
  pela UI); **pacote** ([CONFIRMADO] `npm run smoke:dist`: missão completa com dublê TEST-STUB
  dentro de `dist/win-unpacked/MinhaIA.exe`, arquivo gerado na pasta do projeto).
- 3 pulados no Windows são POSIX/`/proc` (grupo órfão com worker morto, SIGKILL abrupto,
  cancelamento sem órfão); os 5 testes de identidade de processo e kill de árvore que dependiam
  de `/proc` agora rodam e passam no Windows (dono vivo, outro gerenciador, PID reaproveitado,
  dono morto + worker vivo, nunca matar PID reaproveitado).
- `verify` OK: MASTER limpo, HEAD `85b3d4cd3fdef1bbdfb8f044546dfd477b8df773`, 363 arquivos no
  lock, 0 drift, 0 cópias alteradas, 0 ausentes.

## 8. Inventário de arquivos

**Novos**
- `src/projects/store.js` — registro/validação de projetos.
- `src/projects/browse.js` — navegação/leitura/busca confinadas.
- `src/chat/store.js` — histórico de chat por projeto.
- `src/chat/reconcile.js` — fechamento idempotente de pedidos sem resposta (restart).
- `src/missions/scope.js` — guarda de realpath injetada no motor.
- `desktop/main.js`, `desktop/preload.js` — shell Electron e ponte IPC (pasta + `.secrets`).
- `scripts/{serve,desktop,check}.cmd`, `scripts/smoke-dist.js` — atalhos e validação do pacote.
- `test/ui-project.test.js` (1), testes novos em `test/chat.test.js` (2) e
  `test/master-sync.test.js` (3: modo limitado, exclusões do pacote, ensureRuntimeLinks).

**Modificados (principais)**
- `master.manifest.json` (+3 patches), `master.lock.json` (regerado), `package.json`
  (`desktop`/`dist`/`smoke:dist`, bloco `build` do electron-builder, Electron devDep),
  `tsconfig.json` (inclui `desktop/`, `scripts/`), `eslint.config.js` (ignora `dist/`).
- `src/missions/{manager,worker,store,views,instrument,sandbox-preload}.js`
  (manager: `procStart`, `killStaleGroup` com `taskkill`, `ELECTRON_RUN_AS_NODE` no worker).
- `src/master/{sync,verify}.js` (`ensureRuntimeLinks`; modo limitado), `src/config.js`
  (candidato de MASTER `../../ia-library/CLAUDE-MESTRE-FINAL`).
- `src/server/index.js` (rotas de projeto/chat com reconciliação, `providers.envFile`,
  `ensureRuntimeLinks` no boot), `bin/minhaia.js` (verify limitado), `ui/{index.html,app.js,styles.css}`
  (guia de chaves, chip clicável), `CLAUDE.md`, `docs/{ARQUITETURA,DECISOES}.md`.

## 9. Limitações conhecidas e pendências

1. **Missão real com LLM [NÃO VALIDADA]**: sem chave de provedor neste ambiente; todo o pipeline
   foi validado com dublê de teste rotulado `TEST-STUB` (inclusive dentro do `.exe`). Basta 1
   chave grátis (ex.: Groq) para destravar.
2. **Pacote**: instalador sem ícone próprio nem assinatura de código ("unknown publisher");
   assinatura/ícone são melhorias futuras.
3. **Windows/macOS**: recuperação de órfão quando o worker já morreu segue impossível (sem raiz
   de árvore; `/proc` só no Linux) — limitação aceita; identidade dono/PID reaproveitado agora é
   coberta por testes no Windows [CONFIRMADO].
4. **UX de chaves**: configuração continua manual (por design); o painel explica e abre a pasta.
5. 3 testes POSIX pulados no Windows (grupos órfãos/SIGKILL abrupto).

## 10. Como usar

```powershell
node bin/minhaia.js doctor                 # ambiente + MASTER + 25/140 + chaves
node bin/minhaia.js keys                   # o que falta e como habilitar
node bin/minhaia.js serve                  # UI + API em http://127.0.0.1:4317
npm run desktop                            # app desktop (mesma UI/API)
npm run dist                               # instalador NSIS em dist/
npm run smoke:dist                         # valida o .exe empacotado de ponta a ponta
node bin/minhaia.js projects add "C:\caminho\do\projeto"
node bin/minhaia.js run "objetivo" --project=<pasta|prj_id>
node bin/minhaia.js projects list | remove <prj_id>
npm run check                              # typecheck + lint + testes
node bin/minhaia.js verify                 # prova de somente leitura do MASTER
```

Na UI: adicionar a pasta do projeto → conversar no chat (cada mensagem vira uma missão com
contexto) → acompanhar abas (Plano, Task Graph, Agentes & Skills, Execução, Arquivos, Testes &
Revisão, Logs) → navegar/abrir arquivos do projeto. O chip de LLM abre o guia de chaves; no
desktop, o botão "Pasta…" usa o diálogo nativo e o guia pode abrir a pasta `.secrets`.
