@echo off
setlocal EnableExtensions
rem ======================================================================
rem  Gastro-Garage konyhai kijelzo - a beallitasok visszavonasa.
rem  Rendszergazdakent futtasd, a SAJAT (rendszergazdai) fiokodbol.
rem ======================================================================
set "FIOK=Konyha"
set "WINLOGON=HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"

net session >nul 2>&1
if errorlevel 1 (
  echo HIBA: rendszergazdakent kell futtatni.
  pause
  exit /b 1
)

echo Automatikus bejelentkezes kikapcsolasa...
reg add "%WINLOGON%" /v AutoAdminLogon /t REG_SZ /d 0 /f >nul
reg delete "%WINLOGON%" /v DefaultPassword /f >nul 2>&1

echo Inditas bejelentkezeskor torlese...
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" /v GastroGarageKijelzo /f >nul 2>&1

echo Szabalyzatok visszaallitasa...
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Windows\Personalization" /v NoLockScreen /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" /v NoAutoRebootWithLoggedOnUsers /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v HideSCAHealth /f >nul 2>&1
reg delete "HKLM\SOFTWARE\Policies\Microsoft\Internet Explorer\Main" /v DisableFirstRunCustomize /f >nul 2>&1
for %%V in (DisableHelpSticker DisableTLcorner DisableTRcorner DisableCharmsHint AllowEdgeSwipe) do reg delete "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v %%V /f >nul 2>&1

echo Energiagazdalkodas: kepernyo 10 perc, alvas 30 perc (halozatrol)...
powercfg /change monitor-timeout-ac 10
powercfg /change monitor-timeout-dc 5
powercfg /change standby-timeout-ac 30
powercfg /change standby-timeout-dc 15
powercfg /setacvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 1 >nul 2>&1
powercfg /setdcvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 1 >nul 2>&1
powercfg /setactive SCHEME_CURRENT >nul 2>&1

echo.
set "TOROL="
set /p "TOROL=Toroljem a %FIOK% fiokot is? [i/n]: "
if /i "%TOROL%"=="i" (
  net user "%FIOK%" /delete
  echo A C:\Users\%FIOK% profilmappat a Vezerlopult - Rendszer - Specialis - Felhasznaloi profilok resznel torolheted.
)
if exist "C:\Konyha" rmdir /s /q "C:\Konyha"

echo.
echo Kesz. Ujrainditas utan a szokasos bejelentkezes jon.
pause
endlocal
