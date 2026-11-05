@echo off
setlocal
set "GASTRO_TREMOL_SOURCE=%~dp0"
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "%GASTRO_TREMOL_SOURCE%Telepites.ps1"
pause
