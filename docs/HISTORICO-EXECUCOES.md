# Histórico de execuções — MinhaIA

## 2026-10-20 — Simplificação da interface, seleção de modelo, testes e preparação de migração

- **Objetivo:** aplicar a missão anexada, substituir a abertura focada em métricas por uma experiência de conversa baseada na referência, conectar escolhas ao motor real, validar o Electron e preparar a migração para `sameque00-source/minhaia-desktop`.
- **Mudanças:** sidebar/pasta/conversas/composer simplificados; referência HTML copiada; catálogo e modelo selecionado ligados à missão/worker/roteador; fallback informado no resumo; botão de menu móvel; README e relatórios; smoke test do instalador atualizado.
- **Verificações:** `npm.cmd run check` — 151 passou, 0 falhou, 7 ignorados; `sync`, `verify`, `doctor` OK; chamada real curta ao adaptador OpenRouter OK; `npm.cmd run dist` OK; `npm.cmd run smoke:dist` OK; Electron com viewport 720/1024 e E2E `TEST-STUB` OK.
- **Interface:** comparação visual feita com a referência local; captura Electron em `docs/estado-atual.png`. A captura antiga do dashboard foi preservada em `docs/estado-dashboard-anterior.png`.
- **Segurança:** MASTER permaneceu limpo; não houve edição manual de `vendor/master`; IPC/isolamento existentes mantidos; varredura de padrões retornou zero matches, mas gitleaks não está instalado.
- **Git:** sem commits/push; estado local final preservado em backup `C:\Users\sameq\Downloads\MinhaIA-backups\minhaia-20261021-000352Z-final` (contagem e bundle validados no `manifest.txt`).
- **Migração:** parada por falta de autenticação GitHub. O destino não foi confirmado/criado; o antigo não foi excluído; `origin` continua apontando ao antigo. Detalhes e gates em `docs/RELATORIO-MIGRACAO-REPOSITORIO.md`.
- **Pendências:** autenticar GitHub, migrar/clonar/verificar o novo destino antes de exclusão; implementar esforço de raciocínio apenas com suporte real nos adaptadores; testar missão completa com provedor real.
