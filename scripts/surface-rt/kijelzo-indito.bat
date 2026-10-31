@echo off
setlocal EnableExtensions
rem ======================================================================
rem  Gastro-Garage konyhai kijelzo inditasa (a Konyha fiok bejelentkezesekor
rem  fut, rejtett ablakban). Az IE11-et kioszk modban nyitja meg, es ha
rem  bezarodik vagy osszeomlik, ujrainditja.
rem ======================================================================
set "CIM=https://konyha.veres.no/kijelzo"
set "GEP=konyha.veres.no"
set "IE=%ProgramFiles%\Internet Explorer\iexplore.exe"

rem --- Felhasznaloi beallitasok (minden bejelentkezeskor, igy biztosan ervenyesek) ---
rem Kepernyovedo ki.
reg add "HKCU\Control Panel\Desktop" /v ScreenSaveActive /t REG_SZ /d 0 /f >nul
rem Felugro (toast) ertesitesek ki.
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\PushNotifications" /v ToastEnabled /t REG_DWORD /d 0 /f >nul
rem Bejelentkezes utan az asztal jojjon, ne a Start kepernyo.
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartPage" /v OpenAtLogon /t REG_DWORD /d 0 /f >nul
rem Eger a sarkokban ne nyissa meg a gombsavot / alkalmazasvaltot.
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\EdgeUi" /v DisableTLCorner /t REG_DWORD /d 1 /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\EdgeUi" /v DisableTRCorner /t REG_DWORD /d 1 /f >nul
reg add "HKCU\Software\Microsoft\Windows\CurrentVersion\ImmersiveShell\EdgeUi" /v DisableCharmsHint /t REG_DWORD /d 1 /f >nul
rem IE: ne kerdezze, menti-e a jelszot; ne ajanlja fel az alapertelmezett bongeszot;
rem osszeomlas utan ne kerdezze, visszaallitsa-e a lapokat.
reg add "HKCU\Software\Microsoft\Internet Explorer\Main" /v "FormSuggest PW Ask" /t REG_SZ /d no /f >nul
reg add "HKCU\Software\Microsoft\Internet Explorer\Main" /v Check_Associations /t REG_SZ /d no /f >nul
reg add "HKCU\Software\Microsoft\Internet Explorer\Recovery" /v AutoRecover /t REG_DWORD /d 2 /f >nul
reg add "HKCU\Software\Microsoft\Internet Explorer\Main" /v "Start Page" /t REG_SZ /d "%CIM%" /f >nul

rem Ha a tasklist nem erheto el, az IE bezarasara varunk (start /wait).
set "FIGYEL=tasklist"
where tasklist >nul 2>&1
if errorlevel 1 set "FIGYEL=wait"

rem --- Vegtelen ciklus: ha nem fut az IE, elinditja ---
:ciklus
if "%FIGYEL%"=="wait" goto halozat_elo
tasklist /fi "imagename eq iexplore.exe" 2>nul | find /i "iexplore.exe" >nul
if not errorlevel 1 goto var

:halozat_elo

rem Bekapcsolas utan megvarja a halozatot (legfeljebb kb. 3 percig),
rem kulonben az IE sajat hibaoldala maradna a kepernyon.
set /a PROBA=0
:halozat
ping -n 1 -w 2000 %GEP% >nul 2>&1
if not errorlevel 1 goto indit
set /a PROBA+=1
if %PROBA% geq 60 goto indit
ping -n 4 127.0.0.1 >nul
goto halozat

:indit
if "%FIGYEL%"=="wait" (
  start "" /wait "%IE%" -k "%CIM%"
  ping -n 4 127.0.0.1 >nul
  goto ciklus
)
start "" "%IE%" -k "%CIM%"
ping -n 21 127.0.0.1 >nul
goto ciklus

:var
rem 10 masodperc varakozas (a ping minden Windowson elerheto, a timeout nem mindig).
ping -n 11 127.0.0.1 >nul
goto ciklus
