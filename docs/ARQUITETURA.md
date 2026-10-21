# Arquitetura da MinhaIA

Estado: **produto em construção** (fundação + camada de projeto/chat + app desktop empacotável). Rótulos de evidência conforme `.claude/rules/20-evidencia.md`.
Relatório completo do estado atual: [`RELATORIO.md`](RELATORIO.md).
Decisões e o registro "existe no MASTER?" estão em [`DECISOES.md`](DECISOES.md).

## 1. Visão geral

A MinhaIA **não reimplementa** a infraestrutura. Ela consome o repositório MASTER
(`CLAUDE-MESTRE-FINAL-SKILLS-EM-LOTES-COMPLETO`) em modo somente leitura e acrescenta só o que
falta: integração entre as peças, seleção de recursos por tarefa, isolamento de estado,
segurança operacional (hooks) e testes.

```
                MASTER (somente leitura)
  01-USO-DIRETO-CLAUDE/.claude   AI-ORCHESTRATOR      00-ORIGINAIS-PRESERVADOS/02-IA-AVANCADO-CLAUDE
  25 agentes · 140 Skills · 3    gateway · classifier  orquestrador · planejador · executor · agentes
  regras                         router · catalog      memória · autocorreção · pesquisa · router
        │                              │                        │ multimídia · projetos
        └───────────── minhaia sync (manifesto + patches + lock sha256) ─────────────┘
                                       ▼
  MinhaIA ─ .claude/agents, .claude/skills (Claude Code)   vendor/master/* (runtime)   data/ (estado)
          ─ src/registry · src/selection · src/engine · src/security · bin/minhaia.js · hooks · .mcp.json
```

## 2. Módulos

| Módulo | Origem | Papel |
|---|---|---|
| `src/master/sync.js` | novo | Materializa as fontes do manifesto, aplica patches, cria links de runtime (`createRuntimeLinks`/`ensureRuntimeLinks`), grava `master.lock.json` |
| `src/master/verify.js` | novo | Prova de somente leitura: `git status` do MASTER + sha256 origem/destino (modo limitado `limited` quando a origem não está presente) |
| `src/registry/` | novo (lê MASTER) | Registro de 25 agentes (+ metadados de veto/RO do motor), 140 Skills (Use/Skip when, dependências), 3 regras |
| `src/selection/selector.js` | compõe MASTER | Nível (classifier do AI-ORCHESTRATOR) + composição de agentes (motor) + ranking de Skills + governança + prévia de modelo (router do motor) |
| `src/engine/index.js` | fachada | Missão real via `Executor` do motor; acesso a memória, autocorreção, pesquisa, LLM, router |
| `src/security/redact.js` | compõe MASTER | Padrões de segredo da memória do MASTER + chave Google/query/chave privada |
| `src/projects/store.js` | novo | Registro de pastas de projeto do usuário (validação, ids, persistência) |
| `src/projects/browse.js` | novo | Navegação/leitura/busca de arquivos do projeto confinadas por realpath |
| `src/chat/store.js` | novo | Histórico de conversa por projeto (jsonl, redação, preâmbulo de contexto) |
| `src/chat/reconcile.js` | novo | Fecha na leitura pedidos sem resposta de missões já terminadas (restart); idempotente |
| `src/missions/scope.js` | novo | Guarda de confinamento por caminho real, injetada no workspace do motor |
| `desktop/main.js` · `desktop/preload.js` | novo | App desktop (Electron): inicia a mesma API e carrega a UI; ponte mínima de pasta e de abertura da pasta `.secrets` |
| `src/agents/especialistas-extra.js` | novo | 6 especialistas que o motor não mapeava (3d, cli, hooks, integration, mcp, swarm) |
| `vendor/master/ai-orchestrator` | MASTER | Gateway :20130, classificador, scoring/circuit breaker, adapters, catálogo free-only |
| `vendor/master/ia-avancado` | MASTER | Motor completo (DAG, planejador LLM, executor com ferramentas reais, especialistas com veto, memória, autocorreção, pesquisa web, multimídia, projetos) |
| `.claude/hooks/*` | novo | `guard` (PreToolUse) e `session-start` (SessionStart) |
| `scripts/mcp-playwright.js` | adapta MASTER | Inicia o MCP Playwright com versão fixada, browser detectado, saída em `data/` |

## 3. Dependências

- Node.js ≥ 22 (fetch global, `node:test`). Nenhuma dependência npm em runtime. [CONFIRMADO: v22.22.2]
- MASTER clonado ao lado (`../claude-mestre-final-skills-em-lotes-completo`) ou `MINHAIA_MASTER_DIR`.
- Para missões reais: ao menos uma chave em `.secrets/.env` — `GROQ_API_KEY`, `GOOGLE_API_KEY`,
  `OPENROUTER_API_KEY` ou `NINEROUTER_API_KEY` (+ 9Router rodando em :20128 para esta última).
- Opcional (MCP): `npx` com acesso ao registry npm; Chromium/Chrome para o Playwright.
- Opcional (desktop): Electron 44 (devDependency; `npm run desktop`) — sem dependência em runtime do Node.

## 4. Fluxo de execução

```
tarefa
  → select (classifier: nível 0-4/modalidade; agentes; Skills; regras; governança; modelo)
  → nível 0/1: resposta direta (sem equipe)
  → run: Planejador (LLM via router/decisor) decompõe em subtarefas com tipo + critérios
  → Orquestrador: DAG, máquina de estados, paralelismo por levas, persistência por passo
  → Executor: handlers por tipo; especialista resolvido no registro (25); persona .md injetada
       ferramentas reais (Read/Write/Edit/Bash/testarServidor) no workspace da missão
  → QA (testing) roda teste real · Security varre 5 padrões · Reviewer — VETO reabre a tarefa
  → Autocorreção: diagnosticar → estratégia → corrigir (orçamento: 3 tentativas/3 min/8 chamadas)
  → TESTANDO → REVISANDO → CONCLUIDA | FALHA honesta
  → memória: pesquisa/erro/solução/agente gravados (sanitizados) para missões futuras
```

## 5. Fluxo de agentes

- **Claude Code** (sessão interativa): 25 subagentes em `.claude/agents`, chamados pela tool
  `Agent`; o coordenador segue `10-coordenacao.md` (paralelo com `run_in_background`, só o
  coordenador integra, VETO bloqueia).
- **Motor** (missão autônoma): `agentes/core/registro-especialistas.js` — agora com 25 entradas
  (19 originais + 6 via patch). `gerenciador-agentes.js` lê `base-agente/agents` (25 canônicos
  sobrepostos pelo sync) e carrega o corpo do agente sob demanda.
- Portadores de veto: `architecture`, `testing`, `reviewer`, `security`, `security-auditor`.

## 6. Fluxo de Skills

`.claude/skills` (140) → descobertas pelo Claude Code [CONFIRMADO]. O seletor ranqueia por
sobreposição de termos (ponte PT→EN, radical em inglês, "Skip when" penaliza) e devolve o motivo.

**No motor autônomo** (patch declarado `skills-context` em `executor/core/handlers-tarefa.js`):
ao montar o contrato de **cada tarefa**, `src/skills/context.js` escolhe no máximo 2 Skills
para *descrição da tarefa + tipo + agente* — e só entra Skill que casa com algum termo da
**descrição** da tarefa (o nome do agente sozinho não basta; tarefa sem Skill relevante fica sem), injeta um trecho (≤ 1800 caracteres cada) junto à
persona e grava em `tarefa._skills` e no evento `skills`: Skill, motivo (termos em comum), agente,
tools (declaradas no frontmatter ou herdadas do agente), dependências mencionadas, linhas
removidas e, depois, o resultado da tarefa. Skills **sobre** serviço indisponível no executor
(claude-flow, AgentDB, Flow Nexus, GitHub, MCP) são descartadas com motivo; quando só
mencionam o serviço, as linhas com esses comandos são removidas do trecho. O Planejador não
recebe Skills de agente. [CONFIRMADO: teste verifica `### Skill:` nos prompts dos agentes]

## 7. Fluxo de modelos, routing e fallback

- **Classificação**: `classifier/classify.js` (regex, sem LLM) → nível e modalidade.
- **Decisão**: `router/router.js` do motor → `decisor.decidirModelo` (filtro free/sem cartão,
  adapters existentes, visão/ferramentas) → `scoring.ordenar` (aptidão, saúde observada,
  latência p50, folga de contexto, prioridade) + ajuste de aprendizado por histórico.
- **Fallback in-process** (`chamar-llm.js`): até 6 candidatos; pula quem não comporta o
  contexto (nunca trunca); registra resultado no scoring (cooldown por tipo de erro).
- **Fallback HTTP** (gateway :20130): mesma lógica + streaming SSE real + tradução de
  tool-calling Anthropic↔OpenAI↔Gemini; **9Router (:20128) fecha sempre a cadeia** como último
  recurso. [CONFIRMADO: 5 candidatos em 4 provedores tentados em ordem]

## 8. Memória

Motor `memoria/` (MASTER) sem alteração: 8 tipos (missão, projeto, agente, pesquisa, fato,
decisão, erro, solução), TTL por tipo, invalidação sem apagar, confiança ≤ 0,95, recall por
relevância, sanitização (segredos mascarados, id anti-path-traversal, conteúdo marcado como
dado). Persistência em `data/memoria/*.json` (link criado pelo sync; escrita atômica).

## 9. Auto-Repair

Motor `autocorrecao/` (MASTER) sem alteração: `executarComAutocorrecao({executar, avaliar,
corrigir})`, 10 categorias de diagnóstico, estratégia que muda ao detectar repetição (trocar
modelo/ferramenta, decompor, replanejar, consultar memória, bloquear), orçamento anti-loop,
memória de erro→solução. Usado pelo executor e pela multimídia.

## 10. Tools

Executor do motor: `arquivos` (Read/Write/Edit no workspace da missão, com locks),
`terminal` (Bash), `testarServidor`, `navegador`/`api` (pesquisa: npm, Wikipedia, DuckDuckGo).
Sessão Claude Code: ferramentas nativas + MCP.

## 11. MCP

`.mcp.json` do MinhaIA (adaptado do `.mcp.json` preservado no MASTER):
- `claude-flow`: `npx -y ruflo@3.44.0 mcp start` (versão fixada). [CONFIRMADO: handshake, 353 ferramentas]
- `playwright`: `node scripts/mcp-playwright.js` → `@playwright/mcp@0.0.82`, `--isolated --headless`,
  `--output-dir data/playwright`, browser detectado. [CONFIRMADO: navegação real renderizou página local]

## 12. Segurança

- MASTER: nunca executado no lugar; `sync` só lê, recusa MASTER com alterações locais, recusa
  destino fora do MinhaIA, dentro do MASTER (também após resolver symlinks) ou que atravesse
  symlink; é atômico (monta em staging e troca — falha deixa a instalação anterior intacta);
  symlinks do MASTER não são seguidos; cópias são arquivos, nunca symlink para o MASTER.
- `verify`: falha se `git status` do MASTER não puder rodar ou não estiver limpo, se o HEAD mudou,
  se houver cópia alterada/ausente, arquivo extra nos destinos gerados ou link de runtime desviado.
- Hook `guard` (PreToolUse, fail-closed) — **defesa em profundidade, não sandbox**:
  - Bash que referencia o MASTER (texto, caminho, `cwd`, glob/variável/substituição ambígua) só
    passa se todos os segmentos forem comandos de leitura de uma lista de permissão
    (`ls`, `cat`, `grep`, `git status|log|diff|show`…); interpretadores (`node -e`, `python -c`),
    `find -delete`, `npm --prefix`, redirecionamentos e `ln` são bloqueados.
  - Qualquer Bash que toque `.secrets`/`.env`/`ai-orchestrator/config` é bloqueado; escrita com
    padrão de segredo é bloqueada; `.secrets/` é gravado só pelo humano.
  - Autoproteção: `settings*.json`, `.claude/hooks/`, `src/security/`, `src/config.js` só com
    `MINHAIA_ALLOW_PROTECTED_EDIT=1` no ambiente em que o humano iniciou o Claude Code.
  - Destrutivos: `rm -r` em alvo raiz/home/pai/glob/variável/dados, push forçado (inclui `+ref`),
    `reset --hard`, `clean -f`, `find -delete`, acesso remoto.
  - Limites conhecidos (casamento de texto não é sandbox): qualquer indireção passa — nome montado
    por concatenação (`'claude-mes'+'tre…'` dentro de `node -e`), script gravado no MinhaIA e
    executado depois, ou symlink criado fora do Claude. Falso positivo conservador: `|` e `>`
    dentro de aspas (`grep 'a|b'`, `--format='%h > %s'`) são tratados como separador/
    redirecionamento. Qualquer Bash que cite `.env` é bloqueado, inclusive `.env.example`.
  - **Proteção forte recomendada** (decisão do dono do MASTER, não aplicada aqui): tornar o clone do
    MASTER somente leitura no SO (`chmod -R a-w` ou montagem read-only) e `.secrets/` com
    `chmod 600`.
- `settings.json`: nega leitura de `.env`/`.secrets`/chaves SSH, escrita em `.secrets`, acesso
  remoto; `cat` não é pré-aprovado (evita contornar os bloqueios de leitura).
- Gateway: bind em 127.0.0.1, sem `GATEWAY_API_KEY` só aceita `Host` de loopback (anti DNS
  rebinding), log com redação — 3 patches; `minhaia gateway` recusa host não-loopback sem chave.
- Segredos só em `.secrets/.env` (gitignored); `providerStatus` expõe só nomes, nunca valores, e
  lê no mesmo formato do gateway (`CHAVE=valor`, valor não vazio).
- **Sandbox do código gerado pelo LLM** (o motor do MASTER executa esse código): o worker
  intercepta `executarComando`/`testarServidor`. Só `node` roda, sempre com o modelo de
  permissões do Node (`--permission`, leitura e escrita **apenas no workspace da missão**, sem
  criar processos, logo sem ler `.secrets` nem escrever no MASTER). Argumentos do `node` por
  **lista de permissão**: só `node <script-no-workspace> [args]` (caminho real conferido, sem
  symlink para fora) ou `node -e <código>`; qualquer opção antes do script (`--run`,
  `--report-directory`, `-r`, `--import`, `--env-file`…) é recusada — `--run` escapava do
  confinamento (achado da revisão de segurança, com teste de regressão). Outros executáveis
  (python, sh…) não herdam o confinamento e são recusados; liberar exige
  `MINHAIA_ALLOW_UNSANDBOXED_COMMANDS=1` (a UI marca "SEM sandbox").
- O worker (e tudo que ele executa) recebe **ambiente mínimo** (PATH, HOME, locale, proxy/CA,
  `NODE_ENV`, `MINHAIA_*`): tokens exportados no shell do usuário não chegam ao código gerado.
- O worker roda em **grupo de processos próprio**; cancelar, timeout ou fim da missão encerram o
  grupo inteiro (nenhum servidor gerado fica órfão — testado via `/proc`).
- **Rede do código gerado bloqueada**: o modelo de permissões do Node 22 não cobre rede, então
  todo `node` da sandbox carrega `src/missions/sandbox-preload.js` (`--require`, antes do código
  do LLM), que trava de forma não reconfigurável `net.Socket#connect`, `net.connect`,
  `tls.connect`, UDP (`dgram`), `fetch`/`WebSocket` e **DNS** (`dns.lookup`, `resolve*`,
  `Resolver`, `dns/promises` — consultas feitas no C++, que serviriam de canal de exfiltração por
  rótulo de subdomínio; `lookup` só aceita IP literal/`localhost`, resolvidos sem consulta).
  Escutar numa porta continua permitido
  (servidores gerados são testados pelo motor a partir do worker). Isso impede o código gerado
  de chamar a própria API local, o gateway ou a internet. Opt-out consciente:
  `MINHAIA_SANDBOX_ALLOW_NETWORK=1`.
- **Links no workspace**: a varredura antes de executar recusa link simbólico quebrado, link que
  resolve para fora do workspace e hardlink; link simbólico que aponta para dentro é aceito
  (ex.: `node_modules` via junction). Diretórios pesados (`node_modules`, `.git`, `dist`, `target`,
  `vendor`…) não são percorridos, mas os filhos diretos do workspace são checados. O preload
  bloqueia **criação** de symlink/hardlink (`fs.symlink(s)Sync/link(s)Sync` e `fs/promises`) com
  `ERR_MINHAIA_LINK_DENIED`, independente de rede. A gravação do motor resolve o caminho real e
  recusa alvo que escape (patch `workspace-realpath-guard`), fechando o furo de junction no
  Windows (`node --permission` não resolve links).
- Fila limitada (`MINHAIA_MAX_PENDING`, padrão 20 → 429).
[CONFIRMADO: cenários adversariais nos testes — escrita/leitura fora, python3, flags de fuga,
conexão TCP, consulta DNS]

### Plataformas: garantias de processo

| Garantia | Linux | macOS | Windows |
|---|---|---|---|
| Grupo de processos próprio (cancelar/timeout/fim mata tudo que o motor criou) | sim (testado) | sim (POSIX) | sim no fluxo normal: `taskkill /PID <pid> /T /F` encerra a árvore (cancelar/fim **testados**; sem prova de netos por falta de `/proc`) |
| Worker se mata com o grupo quando o dono (servidor/CLI) morre | sim (testado) | sim | parcial: ao perder o IPC, o worker roda `taskkill` na própria árvore [INFERIDO por código; sem teste de dono morto à força] |
| Identidade do processo dono = PID + instante de início | sim (testado; `/proc/<pid>/stat`) | **não**: sem `/proc`, só o PID | sim (testado): `procStart` via `[System.Diagnostics.Process]::GetProcessById(pid).StartTime.Ticks` (PowerShell) — dono vivo e PID reaproveitado cobertos |
| Zumbi conta como morto | sim | não se aplica | não se aplica |
| Sandbox do código gerado (permissões do Node + preload de rede) | sim (testado) | [INFERIDO] sim, é do Node | [INFERIDO] sim, é do Node |

No Windows, dono/worker são identificados por **PID + instante de criação** (PowerShell, ~1 chamada
por lançamento/recuperação); recuperação stale mata a árvore com `taskkill /T /F` só quando o dono
segue vivo com o mesmo instante de criação — PID reaproveitado nunca engana (coberto por testes).
Um gerenciador de missões por processo é o uso previsto; com mais de um, cada um ignora as missões
do outro (identidade `owner.id`). macOS segue só por PID [INFERIDO], sem teste nesta máquina.

### Projetos do usuário e chat (§12.1)

A pasta de trabalho é escolhida pelo usuário e **não é copiada**: o motor escreve nela via
`MINHAIA_PROJECT_DIR`, e o patch `project-workspace` faz `pastaWorkspace()` devolver essa pasta.

- **Registro** (`src/projects/store.js`): `data/projetos/projetos.json` (ou
  `MINHAIA_PROJECTS_FILE`). `add` normaliza e recusa raiz de unidade, pasta inexistente/arquivo,
  MASTER (ou dentro dele), qualquer caminho com segmento `.secrets` e duplicata por caminho real.
  Id `prj_` + sha1 do realpath (12 hex) — `/^prj_[a-z0-9]{12}$/`. Remover do registro **nunca**
  apaga arquivos.
- **Missão**: `POST /api/missions` aceita `projectId`; a missão guarda `projectId`/`workspace` e o
  worker recebe `MINHAIA_PROJECT_DIR`. Projeto removido ou pasta ausente → status `BLOQUEADA`
  antes de gastar LLM. Sem `projectId`, o comportamento antigo (workspace da missão) continua.
- **Confinamento**: todo write do motor passa por `assertInside(raiz, alvo)` (`src/missions/scope.js`,
  patch `workspace-realpath-guard`); ferramentas retornam `{ok:false, erro}` em vez de derrubar a
  missão (patch `ferramentas-erro-link`). A navegação da UI (`src/projects/browse.js`) resolve
  realpath em cada nível, ignora links, limita arquivo a 256 KB, 2000 entradas por pasta, 100
  resultados e 50 mil arquivos por busca.
- **Chat** (`src/chat/store.js`): um `.jsonl` por projeto em `data/chat/<projectId>.jsonl` (ou
  `MINHAIA_CHATS_DIR`); texto redigido, ≤ 8000 chars, ids `msg_…`; a UI ignora `missionId` ao
  renderizar. Enviar mensagem cria a missão com preâmbulo das últimas 6 trocas (≤ 1800 chars,
  400 por turno) + `Pedido atual: …`; a mensagem guarda `missionId`. No evento `finished`, o
  servidor grava a resposta-resumo (status, arquivos, motivo). Não é um segundo agente: cada
  resposta é uma missão real do motor.
- **Reconciliação** (`src/chat/reconcile.js`): o `GET /api/projects/:id/chat` fecha pedidos sem
  resposta (missão já terminada, ex.: servidor reiniciado antes do `finished`) gravando o resumo
  agora — idempotente (não duplica), nunca altera a missão e ignora registro corrompido [coberto
  por teste de reinício real].

## 13. Observabilidade

O worker de cada missão instrumenta o motor (sem alterá-lo) e emite eventos: `analysis`,
`phase`, `plan`, `state` (snapshot do grafo a cada persistência), `skills`, `llm.start/end`,
`llm.attempt` (modelo, provider, latência, fallback), `sandbox`, `tool` (comando, exit code,
stdout/stderr), `repair.evaluate/fix/end`, `blocked`, `result`, `finished`. Todos redigidos e
gravados em `data/jobs/<id>/events.jsonl`, transmitidos por SSE.

| Sinal | Onde |
|---|---|
| Eventos da missão (tempo real) | `GET /api/missions/:id/events` (SSE, com replay por `Last-Event-ID`) |
| Painel agregado | `GET /api/observability` + `GET /api/stream` (SSE global) → painel lateral da UI |
| Tentativas por provedor / cooldown | `data/logs/gateway/health-state.json` + eventos `llm.attempt` |
| Estado persistido do motor | `data/missions/<id>/MISSION_STATE.json` |
| Integridade do MASTER/cópias | `minhaia verify`, `GET /api/system`, hook SessionStart |

## 14. Testes e quality gates

- `npm run check` = `typecheck` (TypeScript `checkJs`) + `lint` (ESLint 10) + `npm test`.
- `npm test` (`pretest` roda `sync`) — suítes: sync/lock/verify; registros e seletor; guard
  (50+ casos de bypass); redação; memória e autocorreção do MASTER; gateway real; **API**
  (rotas, SSE, Host/Origin/Content-Type/limite/ids/traversal, CSP); **integração de missão**
  (pipeline real do motor com dublê de LLM só de teste: plano, agentes, Skills no prompt,
  execução, arquivos, resultado, cancelamento, timeout, recusa do dublê fora de teste);
  **sandbox** (código gerado tentando gravar/ler fora do workspace e chamar `python3`);
  **projetos/chat** (registro e validação, confinamento realpath/junction, links internos ×
  externos, bloqueio de criação de link, API de projetos, missão com projeto, bloqueio de projeto
  removido, redação/preâmbulo do chat, resposta do assistente e contexto na missão seguinte);
  **UI no Chromium** (fluxo completo, abas, cancelamento, XSS, zero erros de console;
  **UI do projeto**: pasta real, chat → missão com resposta, navegador de arquivos, busca e
  guia de chaves); **desktop** (Electron real via Playwright: sobe a API em porta efêmera, ponte
  de pasta/segredos exposta, adiciona projeto pela UI, sem erro de página); **pacote**
  (exclusões do electron-builder conferidas contra o manifesto: links de runtime e `.secrets`
  nunca entram no `.exe`; `verify` limitado valida as cópias contra o lock).
- Contagem atual no Windows: 153 testes, 150 passando, 3 pulados (2 dependem de `/proc`/grupos
  POSIX na recuperação; 1 de `/proc` no cancelamento). `npm run dist` gera o `.exe` (electron-builder/NSIS)
  e `npm run smoke:dist` valida o pacote real de ponta a ponta (missão completa com dublê TEST-STUB).
- `minhaia test-master` — as 8 suítes originais do MASTER contra a cópia vendorizada.
- Não há etapa de build: a UI é HTML/CSS/JS servido como está (sem bundler), e o backend é
  Node sem transpilação.
- Gates: `npm run check` verde · `verify` OK · `reviewer` + `security` sem veto.

## 15. CLI

`bin/minhaia.js`: `serve` (UI + API), `sync`, `verify`, `doctor`, `keys` (status dos provedores e
como habilitar; nunca grava chave), `agents`, `skills`, `rules`, `select`,
`run` (`--project=<pasta|prj_id>`), `projects [list|add|remove]`, `missions`, `resume`,
`memory recall|save`, `gateway`, `test-master`; `--json`.

Scripts npm/Windows: `npm run desktop` (Electron), `npm run dist` (instalador NSIS),
`npm run smoke:dist` (valida o `.exe` empacotado de ponta a ponta) e, para duplo clique,
`scripts/serve.cmd`, `scripts/desktop.cmd` e `scripts/check.cmd`.

## 16. API de missões (`node bin/minhaia.js serve` → `http://127.0.0.1:4317`)

| Método | Rota | Função |
|---|---|---|
| GET | `/api/health`, `/api/system` | saúde; integridade do MASTER (`limited` quando a origem não está presente), 25/140, provedores (inclui `envFile`, o caminho do `.env` para a UI) |
| GET | `/api/agents`, `/api/skills?q=`, `/api/rules` | registros |
| POST | `/api/select` | análise determinística de uma tarefa |
| GET/POST | `/api/missions` | listar / criar (`{objective, start?, projectId?}`) |
| POST | `/api/missions/:id/start` · `/cancel` · `/resume` | iniciar, cancelar (encerra o worker e registra FALHA no motor), retomar |
| GET | `/api/projects` · POST · PUT/DELETE `/api/projects/:id` | registro de pastas (`{path}`); DELETE só remove do registro |
| GET | `/api/projects/:id/files?path=` · `/file?path=` · `/search?q=` | navegar, ler (≤256 KB) e buscar no projeto |
| GET/POST | `/api/projects/:id/chat` | histórico (`?limit=`) e envio `{text}` (cria missão) |
| GET | `/api/missions/:id` | job + snapshot do motor + análise + plano |
| GET | `/api/missions/:id/tasks` · `/agents` · `/skills` · `/execution` · `/logs` · `/result` · `/files[?path=]` | visões |
| GET | `/api/missions/:id/events` | SSE com replay |
| GET | `/api/observability`, `/api/stream` | painel agregado + SSE global |

Cada missão roda num **processo worker** (`src/missions/worker.js`, grupo de processos
próprio) — cancelamento real, timeout (padrão 30 min, `MINHAIA_MISSION_TIMEOUT_MS`), no máximo 2
simultâneas (`MINHAIA_MAX_CONCURRENT`), fila limitada (`MINHAIA_MAX_PENDING`). Estados:
CRIADA, NA_FILA, EXECUTANDO, CANCELANDO, CONCLUIDA, FALHA, BLOQUEADA, CANCELADA,
TEMPO_ESGOTADO, INTERROMPIDA (processo dono terminou). Worker que sai sem reportar conclusão é
sempre FALHA; conclusão reportada prevalece sobre cancelamento que chegue depois. Cancelar/timeout **não** marcam FALHA no motor: a missão continua retomável
(`/resume`, só para CANCELADA/TEMPO_ESGOTADO/INTERROMPIDA com estado do motor não terminal); na
retomada, tarefas persistidas como `em_progresso` voltam a `pendente`. Cada job guarda o
processo dono e o worker identificados por **PID + instante de início** (`/proc/<pid>/stat`;
zumbi conta como morto): CLI e servidor simultâneos não interrompem as missões um do outro; na
recuperação, o grupo órfão de um worker morto é encerrado, e um PID reaproveitado por outro
processo nunca é morto. Se o processo dono morrer (até por SIGKILL), o worker percebe a perda do
canal IPC e encerra o próprio grupo — nada do código gerado fica órfão (testado).
`minhaia serve` encerra de verdade com Ctrl+C (fecha SSE e conexões, interrompe workers). O estado das
tarefas é o da máquina de estados do motor; a API não tem motor próprio.
Segurança: só loopback; `Host` de loopback (anti DNS rebinding); escrita exige
`Content-Type: application/json` e `Origin` igual; corpo ≤ 16 KB; ids validados; arquivos do
workspace com resolução de caminho real (sem traversal/symlink), ≤ 256 KB; CSP estrita.
O gateway Anthropic-compatível (:20130) continua disponível à parte.

## 17. Web UI

`ui/` (HTML/CSS/JS sem framework, servido pela API). Card de **projeto** na barra lateral
(adicionar/remover/selecionar pasta; id persistido em `localStorage`), conversa por projeto com
histórico e navegador de arquivos (listar/abrir/buscar). Composer de missão; lista de missões;
cabeçalho com status do job e do motor, nível, rótulo TEST-STUB quando for o caso, progresso,
Cancelar/Retomar habilitados só quando a ação existe; abas **Conversa** (narrativa dos eventos),
**Plano**, **Task Graph** (SVG por camadas de dependência), **Agentes & Skills**, **Execução**
(modelo/provider/latência/fallback, sandbox, terminal, Auto-Repair), **Arquivos** (workspace),
**Testes & Revisão**, **Logs**; painel lateral de **observabilidade ao vivo** (SSE; atualização
por evento, refresh de 15 s só para a contagem de cooldown). Todo dado do motor/LLM entra como
texto (sem `innerHTML`).

**App desktop** (`npm run desktop` → `desktop/main.js`): inicia a mesma API **em processo**
(porta efêmera em loopback) e abre a mesma UI numa `BrowserWindow` com `contextIsolation`,
`sandbox` e **sem** `nodeIntegration`; os únicos privilégios expostos ao renderer são
`minhaiaDesktop.chooseFolder()` (diálogo nativo) e `minhaiaDesktop.openSecretsFolder()` (abre a
pasta `.secrets` no gerenciador de arquivos — nenhum valor de chave cruza a ponte), via IPC.
A UI mostra o botão "Pasta…" quando a ponte existe, e o chip de LLM abre o painel "Configurar
provedor" com o caminho real do `.env`. Navegação externa é bloqueada (só `https:` abre no
navegador do sistema), instância única e, ao fechar, o `shutdown` interrompe missões e fecha a
API. Nada de regra de negócio duplicada: o desktop é só a casca.

**Pacote instalável** (`npm run dist` → electron-builder/NSIS, `dist/MinhaIA Setup 0.1.0.exe`):
`asar: false` (o motor faz `require`/`fork` por caminho real); o pacote leva `src/`, `ui/`,
`bin/`, `desktop/`, `vendor/`, `.claude/{agents,skills}` e o lock — e **nunca** `data/` ou
`.secrets/` (links de runtime são excluídos e recriados no boot por `ensureRuntimeLinks()` para o
`data/` do próprio app). No Electron empacotado, `process.execPath` é o `MinhaIA.exe`; o worker e
o código gerado rodam com `ELECTRON_RUN_AS_NODE=1` (definido pelo `MissionManager` quando
`process.versions.electron`). Sem o MASTER de origem, `verify` cai em **modo limitado**: valida as
cópias contra os hashes do lock (HEAD vem do lock) e a UI mostra "MASTER íntegro (cópias)".
Validação real: `npm run smoke:dist` abre o `.exe`, adiciona uma pasta, roda uma missão completa
com o dublê TEST-STUB e confere o arquivo gerado (instalação per-user, não exige admin).

## 18. Checkpoints e recuperação

O orquestrador persiste `MISSION_STATE.json` a cada transição (escrita atômica .tmp+rename);
`minhaia resume <id>` retoma sem reexecutar tarefas concluídas (coberto pelas suítes do MASTER).
Re-sync nunca apaga `data/`. Backups de estado fora do Git: `data/` e `.secrets/` são do usuário.

## 19. Estrutura de diretórios

```
Minha-ia/
├── CLAUDE.md · package.json · master.manifest.json · master.lock.json · .mcp.json
├── bin/minhaia.js
├── src/{config.js, master/, registry/, selection/, engine/, security/, agents/,
│        skills/, runtime/, missions/{store,manager,worker,instrument,views,scope}.js,
│        projects/{store,browse}.js, chat/{store,reconcile}.js, server/}
├── ui/{index.html, styles.css, app.js, icon.svg}
├── desktop/{main.js, preload.js}
├── scripts/{mcp-playwright.js, smoke-dist.js, serve.cmd, desktop.cmd, check.cmd}
├── .claude/{settings.json, hooks/, rules/}   (+ agents/, skills/ gerados)
├── test/*.test.js · test/fixtures/stub-adapters.js (dublê de LLM, só teste)
├── tsconfig.json · eslint.config.js
├── docs/{ARQUITETURA.md, DECISOES.md, RELATORIO.md}
├── dist/   (gerado por `npm run dist`: app empacotado + instalador NSIS, gitignored)
├── vendor/master/{ai-orchestrator, ia-avancado}   (gerado, gitignored)
├── data/{jobs,missions,memoria,logs,…}   (runtime, gitignored)   · .secrets/ (gitignored)
```

## 20. Contratos/interfaces

- `select(tarefa) → {classification:{level,modality,effort}, agents:[{id,reasons,veto}],
  skills:[{id,score,matched,requires,origin}], rules:[id], governance:{reviewerRequired,
  securityRequired,vetoHolders,teamRecommended}, model:{chosen,tipoTarefa,motivo,fallback:[{id,provider,keyConfigured}]}}`
- `runMission(objetivo) → {status:'CONCLUIDA'|'FALHA'|'BLOQUEADO', missionId, state, events, selection, reason?}`
- `verify() → {ok, problems, masterGit:{clean}, masterDrift, vendorTampered, missingLocal, limited}`
- Projeto: `{id:'prj_…', name, path, addedAt, lastUsedAt}`; validação → 400 `{error}`; missão →
  `{objective, projectId}`; projeto inválido/removido na criação → 404.
- Chat: mensagem `{id:'msg_…', role:'user'|'assistant', text, missionId?, ts}`; `POST` devolve
  `{message, mission}`; `GET` devolve `{messages}` (mais antigas primeiro, `limit` ≤ 200 no servidor).
- Contrato de tarefa do motor (`agentes/core/contrato.js`): INPUT/CONTEXT/OBJECTIVE/TOOLS/
  CONSTRAINTS/EXPECTED_OUTPUT/SUCCESS_CRITERIA.
- Hooks: stdin JSON do Claude Code; `exit 2` + stderr = bloqueio.
- Evento de missão: `{seq, ts, type, jobId, ...}` (tipos na seção 13); SSE `event: mission`, `id: seq`.
- Registro de Skill por tarefa: `{tarefaId, missaoId, agente, skills:[{id, score, motivo, tools,
  requires, linhasRemovidas, origem, chars}], descartadas:[{id, motivo}]}`.

## 21. Pendências (próximas fases)

- Missão real com LLM: **NÃO VALIDADA — PROVIDER INDISPONÍVEL** neste ambiente (sem chave;
  Groq/OpenRouter bloqueados pela rede do container). Pipeline validado com dublê de teste —
  inclusive dentro do `.exe` empacotado (`npm run smoke:dist`).
- Configurar chaves de provedor é manual (por design: a IA nunca grava segredo); `minhaia keys`
  e o painel "Configurar provedor" da UI mostram o que falta e o caminho real do `.env`.
- Perguntas ao usuário: o Planejador do MASTER roda em modo AUTO e só *marca*
  `decisaoUsuario`; a UI mostra, mas não há fluxo de resposta que pause a missão.
- Sandbox cobre só `node` (outros interpretadores são recusados); o bloqueio de rede é na camada
  JS do Node, não do SO — proteção forte continua sendo o SO (namespace de rede/container).
- Windows: identidade de processo usa PID **+ instante de criação** (`procStart` via PowerShell) e
  o encerramento de árvore usa `taskkill /T /F`; a recuperação de órfãos quando o worker já morreu
  (sem raiz de árvore) segue impossível — limitação aceita.
- Pacote desktop: sem ícone próprio (usa o do Electron) e sem assinatura de código (instalador
  sai "unknown publisher"); demais limitações de sandbox valem igual.
- Painel de observabilidade lê as 15 missões mais recentes (sem banco de métricas).
