# MinhaIA

Assistente de programação para Windows, feito com Electron e apoiado no motor de agentes já integrado ao projeto. A MinhaIA conversa por pasta de trabalho, mantém sessões locais e executa missões com progresso, arquivos, testes e erros observáveis.

## O que oferece

- Seleção de pasta pelo seletor nativo do Windows e validação do escopo de arquivos.
- Conversas persistentes e isoladas por projeto.
- Missões reais pelo orquestrador existente, com eventos, detalhes e cancelamento quando suportado.
- Seletor ligado ao catálogo local de modelos: escolha manual validada na API, prioridade encaminhada ao roteador e fallback registrado quando o modelo falha.
- Interface Electron escura, responsiva e focada na conversa.
- Proteções de sandbox, caminhos, IPC restrita, contexto isolado e API local em loopback.

## Requisitos

- Windows 10/11 (a aplicação desktop é empacotada como NSIS).
- Node.js 22 ou superior e npm.
- O repositório fonte MASTER configurado para sincronização do motor.
- Pelo menos um provedor elegível configurado para executar missões com modelo real.

## Instalação e desenvolvimento

```powershell
npm install
npm run sync
npm run desktop
```

O servidor web local também pode ser iniciado com `node bin/minhaia.js serve`. A API escuta somente em loopback. Para testes de interface pelo navegador, `node bin/minhaia.js serve` fornece a mesma UI e API usadas pelo Electron.

## Provedores

Configure as credenciais localmente em `.secrets/.env`, uma variável por linha, no formato `NOME_DA_VARIAVEL=valor`. Não coloque esse arquivo em commits ou relatórios. O projeto aceita as variáveis `GROQ_API_KEY`, `GOOGLE_API_KEY`, `OPENROUTER_API_KEY` e `NINEROUTER_API_KEY`. O catálogo respeita a política existente de modelos gratuitos sem exigência de cartão. Modelos sem adaptador ou credencial ficam indisponíveis no seletor.

O modo Automático usa o roteamento do orquestrador. A opção manual prioriza o modelo escolhido quando ele é elegível e mantém a cadeia de fallback do roteador; o resultado informa o modelo pedido e o fallback real. O nível de raciocínio por solicitação ainda não é transmitido pelos adaptadores atuais e aparece indisponível na interface.

## Verificações

```powershell
npm.cmd run check
npm.cmd run sync
npm.cmd run verify
npm.cmd run doctor
npm.cmd run dist
npm.cmd run smoke:dist
```

`check` executa TypeScript, ESLint e testes automatizados. Os outros comandos confirmam integridade do MASTER, ambiente e empacotamento; consulte `package.json` para a definição atual.

## Empacotamento

```powershell
npm.cmd run dist
npm.cmd run smoke:dist
```

O instalador NSIS é gerado em `dist/`. A compilação do instalador não faz parte de uma verificação local até que seja executada com sucesso.

## Limitações conhecidas

- Não existe modo Cowork nesta arquitetura.
- O esforço de raciocínio não pode ser configurado pela UI porque o motor/adaptadores não encaminham esse parâmetro.
- Tokens de uso não são registrados de forma confiável e não são apresentados como estimativa.
- Provedores podem limitar chamadas ou retirar modelos; erros e fallbacks são registrados.
- Um provedor real só está validado após uma chamada real, distinta dos testes com `TEST-STUB`.
- A migração para o repositório GitHub de destino está documentada em `docs/RELATORIO-MIGRACAO-REPOSITORIO.md` e requer autenticação GitHub.

## Documentação e evidências

- Arquitetura: `docs/ARQUITETURA.md`
- Decisões: `docs/DECISOES.md`
- Referência visual: `docs/referencia-interface-minhaia.html`
- Relatório completo: `docs/RELATORIO-COMPLETO.md`
- Histórico de execuções: `docs/HISTORICO-EXECUCOES.md`
- Migração: `docs/RELATORIO-MIGRACAO-REPOSITORIO.md`
- Captura da aplicação: `docs/estado-atual.png`
