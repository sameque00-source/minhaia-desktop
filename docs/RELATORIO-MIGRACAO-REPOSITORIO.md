# Relatório de migração do repositório

Data: 21/10/2026
Origem preservada: `sameque00-source/Minha-ia`
Destino oficial: `sameque00-source/minhaia-desktop`

## Autenticação e repositórios

- `gh auth status`: sessão válida de `sameque00-source`, escopo `repo`.
- A origem era pública e a conta tem `ADMIN`; sua branch padrão era `claude/elegant-lovelace-slefxv`.
- A consulta autenticada mostrou que o destino não existia. Ele foi criado público para manter a mesma visibilidade e está acessível com permissão `ADMIN`.
- Commit de migração enviado sem force push para a branch `main`: `682fba334b0477c03e19f97d64ba8e8e7daa9bd6` (`Migra interface e execução para fluxo desktop de programação`). Inclui 57 arquivos locais modificados/adicionados e mantém como ancestrais o histórico já presente na origem.
- GitHub confirma `main` como branch padrão do novo repositório.

## Auditoria de publicação

- Revisão de nomes sensíveis rastreados e busca por padrões comuns de credenciais nos arquivos candidatos: nenhum achado.
- `.mcp.json` foi inspecionado e contém configuração sem credenciais. `.secrets/`, `data/`, `node_modules/`, `dist/` e `vendor/` gerado não foram publicados. O `.gitignore` confirma a exclusão local desses caminhos.
- `gitleaks` não está instalado. A busca manual não é uma certificação de ausência total de segredos; por isso a exclusão da origem antiga não passou pelo gate conservador.
- `npm ci` na clonagem informou 8 vulnerabilidades moderadas na árvore geral. `npm audit --omit=dev` reportou zero vulnerabilidade de produção; as ocorrências listadas são dependências de ferramenta de build/desenvolvimento.
- A origem já era pública, portanto o histórico anterior enviado ao destino já estava publicado. Nenhum force push foi executado.

## Backup

- Caminho: `C:\Users\sameq\Downloads\MinhaIA-backups\minhaia-20261021-001034Z-migration`.
- Cópia `working-tree/`: 311 arquivos, sem dados locais/segredos, dependências, `dist/` ou `vendor/` gerado.
- `historico-git.bundle`: 411856 bytes; `git bundle verify` confirmou histórico completo. `manifest.txt` registra origem, branch, contagem e exclusões.

## Clonagem limpa e verificações

- Clone: `C:\Users\sameq\Downloads\MinhaIA-migration-check`, `main` em `682fba334b0477c03e19f97d64ba8e8e7daa9bd6`, árvore limpa após clone.
- Foram encontrados os três relatórios, a captura `docs/estado-atual.png` e o HTML `docs/referencia-interface-minhaia.html`.
- `npm ci`: concluído; 352 pacotes instalados. Auditoria npm reportou 8 moderadas (zero em dependências de produção).
- `npm run check`: TypeScript e ESLint passaram; testes 158, aprovados 152, falhas 0, ignorados 6. Três casos ignorados dependem de `/proc`/grupos POSIX; três testes de browser requerem Chromium externo ausente. O teste Electron/Playwright embutido passou.
- `npm run sync`: passou, 363 arquivos materializados a partir do MASTER.
- `npm run verify`: passou, MASTER limpo, zero drift/alterações/ausências.
- `npm run doctor`: verificou Node, MASTER, agentes e Skills; apontou que a clonagem não possui chave local de provedor. Chaves não foram copiadas, e missões reais nesse clone ficam bloqueadas até configuração local autorizada.

## Estado do `origin` e da origem antiga

- Após a validação da clonagem, o checkout de trabalho foi renomeado para `main`, configurado para acompanhar `origin/main`, e o `origin` foi confirmado em `https://github.com/sameque00-source/minhaia-desktop.git`. `git status` ficou limpo e `git ls-remote` confirmou `HEAD`/`main` no commit `c46a6a7106760c71ed101adb44b5e8087c2118fb`.
- **A origem antiga não foi excluída e permanece intacta.** O gate faltante é uma varredura com ferramenta dedicada de segredos, indisponível neste ambiente. Manter a origem preserva reversibilidade; não há necessidade operacional de apagá-la para que o novo repositório seja oficial.

## Histórico de execuções

A execução de 20/10 e seu estado anterior estão preservados em `docs/HISTORICO-EXECUCOES.md`. Esta migração foi acrescentada ali sem substituir os registros anteriores.
