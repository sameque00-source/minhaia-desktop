@echo off
rem MinhaIA — sobe a Web UI + API (http://127.0.0.1:4317) e mantém o terminal aberto.
cd /d "%~dp0.."
node bin\minhaia.js serve %*
pause
