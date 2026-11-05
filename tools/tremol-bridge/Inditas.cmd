@echo off
powershell.exe -NoProfile -STA -ExecutionPolicy RemoteSigned -File "%~dp0GastroGarage-Tremol.ps1" %*
