# Relatório de migração do repositório

Data: 21/10/2026
Origem preservada: `sameque00-source/Minha-ia`
Destino oficial: `sameque00-source/minhaia-desktop`

## Autenticação e repositórios

- `gh auth status`: sessão válida de `sameque00-source`, escopo `repo`.
- A origem era pública e a conta tem `ADMIN`; sua branch padrão era `claude/elegant-lovelace-slefxv`.
- A consulta autenticada mostrou que o destino não existia. Ele foi criado público para manter a mesma visibilidade e está acessível com permissão `ADMIN`.
- Commit de migração enviado sem force push para a branch `main`: `682fba334b0477c03e19f97d64ba8e8e7daa9bd6` (`Migra interface e execução para fluxo desktop de programação`). Inclui 57 arquivos locais modificados/adicionados e mantém como ancestrais o histórico já presente na origem. Os commits de documentação posteriores também foram enviados.
- GitHub confirma `main` como branch padrão do novo repositório.
- As duas branches da origem foram recriadas no destino com os mesmos nomes e SHAs: `claude/elegant-lovelace-slefxv` (`78cae09bf9d3d8cc6ce3dfa1d7c450d381afef2d`) e `reference/minhaia-ui-visual` (`8f03b7739b92ea7ae0bb2a82cd6a1a1be19ba74b`). A branch de referência tem um commit exclusivo e foi preservada. `main` contém a versão de trabalho validada.
- A origem tinha zero tags, releases, issues/PRs; a wiki não existe. Não há metadados GitHub adicionais conhecidos que precisem de migração.

## Auditoria de publicação

- Revisão de nomes sensíveis rastreados e busca por padrões comuns de credenciais nos arquivos candidatos: nenhum achado.
- `.mcp.json` foi inspecionado e contém configuração sem credenciais. `.secrets/`, `data/`, `node_modules/`, `dist/` e `vendor/` gerado não foram publicados. O `.gitignore` confirma a exclusão local desses caminhos.
- `gitleaks` v8.30.1 foi baixado do release oficial para uma pasta temporária fora do projeto. `gitleaks git` no histórico/refspec local retornou zero achados. `gitleaks dir` numa extração `git archive` da árvore exatamente publicada retornou zero achados (82 arquivos). O Secret Scanning do GitHub e Push Protection estão habilitados no destino e na origem; a API retornou zero alertas para ambos.
- Uma varredura da árvore local ampla encontrou padrões em arquivos locais ignorados de `.secrets/` e em conteúdo gerado de Skills/vendor/dist; esses caminhos não aparecem no `git archive`, não foram enviados e não devem ser copiados para o remoto. Nenhum valor de segredo foi exibido ou registrado aqui.
- `npm ci` na clonagem informou 8 vulnerabilidades moderadas na árvore geral. `npm audit --omit=dev` reportou zero vulnerabilidade de produção; as ocorrências listadas são dependências de ferramenta de build/desenvolvimento.
- A origem já era pública, portanto o histórico anterior enviado ao destino já estava publicado. Nenhum force push foi executado.

## Backup

- Backup pré-publicação: `C:\Users\sameq\Downloads\MinhaIA-backups\minhaia-20261021-001034Z-migration` (311 arquivos e bundle de 411856 bytes, bundle validado).
- Backup final com todas as branches e commits de migração: `C:\Users\sameq\Downloads\MinhaIA-backups\minhaia-final-migration-20261021`; a contagem, o commit e o bundle Git estão registrados no `manifest.txt`, e `git bundle verify` passou. Cópia exclui `.secrets/`, `data/`, dependências, `dist/` e `vendor/` gerado.

## Clonagem limpa e verificações

- Clone: `C:\Users\sameq\Downloads\MinhaIA-migration-check`, sincronizado com o `main` publicado, sem alterações persistentes após restaurar o `master.lock.json` regenerado pelo teste.
- Foram encontrados os três relatórios, a captura `docs/estado-atual.png` e o HTML `docs/referencia-interface-minhaia.html`.
- `npm ci`: concluído; 352 pacotes instalados. Auditoria npm reportou 8 moderadas (zero em dependências de produção).
- `npm run check`: TypeScript e ESLint passaram; testes 158, aprovados 152, falhas 0, ignorados 6. Três casos ignorados dependem de `/proc`/grupos POSIX; três testes de browser requerem Chromium externo ausente. O teste Electron/Playwright embutido passou no clone.
- `npm run sync`: passou, 363 arquivos materializados a partir do MASTER.
- `npm run verify`: passou, MASTER limpo, zero drift/alterações/ausências.
- `npm run doctor`: verificou Node, MASTER, agentes e Skills; apontou que a clonagem não possui chave local de provedor. Chaves não foram copiadas, e missões reais nesse clone ficam bloqueadas até configuração local autorizada.

## Estado do `origin` e da origem antiga

- Após a validação da clonagem, o checkout de trabalho foi alinhado à branch `main`, configurado para acompanhar `origin/main`, e `origin` aponta para `https://github.com/sameque00-source/minhaia-desktop.git`. `git status` está limpo e o destino confirma `main` como HEAD padrão.
- Todos os gates técnicos foram comprovados: backup final, branches/histórico, Gitleaks, GitHub Secret Scanning, clone e verificações. A tentativa de exclusão recebeu HTTP 403 porque o token `gh` não possui o escopo `delete_repo`; `gh auth refresh -h github.com -s delete_repo` está aguardando confirmação no fluxo de device login. Nenhuma exclusão foi efetuada. A origem continua intacta enquanto esse escopo não for concedido.

## Histórico de execuções

A execução de 20/10 e seu estado anterior estão preservados em `docs/HISTORICO-EXECUCOES.md`. Esta migração foi acrescentada ali sem substituir os registros anteriores.
