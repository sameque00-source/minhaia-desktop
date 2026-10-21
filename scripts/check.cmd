@echo off
rem MinhaIA — verificação completa: typecheck + lint + testes (inclui UI/desktop).
cd /d "%~dp0.."
call npm.cmd run check %*
