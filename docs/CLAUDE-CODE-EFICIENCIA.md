# Eficiência no Claude Code — rotina curta (Astra Code)

Complementa `docs/design-toolkit/TOKEN-BUDGET.md` (existe no checkout principal; não repete). Nenhuma economia percentual foi provada.

## Regras por pedido (estilo Karpathy, enxutas)
1. Esclareça só ambiguidade real; senão, assuma o padrão do repositório e diga qual.
2. Menor mudança completa; reutilize padrões existentes; não toque em arquivos não relacionados.
3. Busca direcionada (mapa → `Grep`/`vault-search.js` → `Read` com offset/limit). Sem varredura ampla nem releitura.
4. Um agente (a sessão principal) por padrão. Subagente só com pergunta estreita, arquivos listados e saída curta. Os 25 agentes do app não são workers do Claude Code.
5. Teste focado no que mudou (`node --test test/<arquivo>.test.js`); suíte completa/`dist` só antes de release.
6. Preserve MASTER, dados do usuário, modelos, segredos e a proteção de junctions do instalador. Nunca commit/push sem aprovação.
7. Reporte o que não foi testado.

## Modelo e esforço (conforme o que a conta oferece)
Padrão: **Sonnet, esforço Medium** (sessão atual confirmada assim via metadados). Tarefa trivial: esforço menor, se o seletor oferecer. Subir esforço/modelo só depois de uma tentativa focada falhar. A troca é pelo seletor do app (Code → caixa de mensagem → modelo/esforço); não foi alterada por mim. Não substitua por outros provedores.

## Checkpoint / handoff (curto; só em marco relevante)
Salvar via `log_session`/nota Obsidian, ou arquivo local. Sem segredos, sem transcrição.
```
Objetivo/aceite:
Ponteiros (caminhos):
Arquivos alterados / NÃO alterados:
Decisões (só as materiais):
Testes (real/simulado → resultado):
Riscos / próximo passo exato:
```
Nova sessão: aponte só este bloco + `docs/ASTRA_QUICK_CONTEXT_MAP.md`. `/compact` só quando o contexto crescer; contexto % não é cota semanal.

## Registro de uso (manual, leve)
Medir pelo painel de uso do app (5 h / semana) no início e fim de um bloco de trabalho útil; anotar tarefa, modelo/esforço, testes. Valores arredondados: nunca inferir % economizado de variação pequena.

| Data | Tarefa | Modelo/esforço | 5h antes→depois | Semana antes→depois | Contexto | Testes | Obs. |
|---|---|---|---|---|---|---|---|
| 2026-10-24 | Fase 1 (baseline, início) | Sonnet 5.5 / medium | 2% → (ver fim) | 0% → (ver fim) | 12% (~125k tok) | — | sem mudança ainda |
