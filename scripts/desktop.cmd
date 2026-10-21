@echo off
rem MinhaIA — abre o app desktop (Electron) com a mesma UI/API.
cd /d "%~dp0.."
call npm.cmd run desktop %*
