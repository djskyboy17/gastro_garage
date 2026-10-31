@echo off
setlocal EnableExtensions
title Konyhai kijelzo inditoja - NE ZARD BE
echo Konyhai kijelzo inditoja. Ezt az ablakot ne zard be: ha az IE bezarodik, ujrainditja.
rem ======================================================================
rem  Gastro-Garage konyhai kijelzo inditasa. A Konyha fiok bejelentkezesekor
rem  a Feladatutemezo inditja (normal ablakban; a kioszk modu IE eltakarja).
rem  VBScript nincs: Windows RT-n a WScript.Shell nem hozhato letre.
rem  Az IE11-et kioszk modban nyitja meg, es ha bezarodik vagy osszeomlik,
rem  ujrainditja.
rem  Az IE eloszor a helyi kijelzo-indito.html oldalt nyitja meg: az addig
rem  probalkozik, amig a szerver el nem erheto, utana atvalt a kijelzore.
rem  Igy nem kell a halozatra varni, es nem marad az IE hibaoldalan.
rem ======================================================================
set "INDITO=C:\Konyha\kijelzo-indito.html"
set "IE=%ProgramFiles%\Internet Explorer\iexplore.exe"
rem Naplo hibakereseshez: %TEMP%\kijelzo-indito.log (a Konyha fiok TEMP mappajaban).
set "NAPLO=%TEMP%\kijelzo-indito.log"
echo %DATE% %TIME% bat indul, felhasznalo=%USERNAME% >> "%NAPLO%"
if not exist "%IE%" echo %DATE% %TIME% HIBA: nincs meg az IE: %IE% >> "%NAPLO%"
if not exist "%INDITO%" echo %DATE% %TIME% HIBA: nincs meg: %INDITO% >> "%NAPLO%"

rem Egyszerre csak egy peldany fusson (pl. ha kezzel is elinditjak a feladat mellett):
rem a zarfajlt a futo peldany nyitva tartja, a masodik nem tudja megnyitni, es kilep.
2>nul (9>"%TEMP%\kijelzo-indito.lock" call :fo) || echo %DATE% %TIME% mar fut egy peldany, kilep >> "%NAPLO%"
exit /b

:fo

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
reg add "HKCU\Software\Microsoft\Internet Explorer\Main" /v "Start Page" /t REG_SZ /d "https://konyha.veres.no/kijelzo" /f >nul

rem Ha a tasklist nem erheto el, az IE bezarasara varunk (start /wait).
set "FIGYEL=tasklist"
where tasklist >nul 2>&1
if errorlevel 1 set "FIGYEL=wait"
echo %DATE% %TIME% figyeles=%FIGYEL% >> "%NAPLO%"

rem --- Vegtelen ciklus: ha nem fut az IE, elinditja ---
:ciklus
if "%FIGYEL%"=="wait" goto indit
tasklist /fi "imagename eq iexplore.exe" 2>nul | find /i "iexplore.exe" >nul
if not errorlevel 1 goto var

:indit
echo %DATE% %TIME% IE inditasa >> "%NAPLO%"
if "%FIGYEL%"=="wait" (
  start "" /wait /max "%IE%" -k "%INDITO%"
  ping -n 4 127.0.0.1 >nul
  goto ciklus
)
start "" /max "%IE%" -k "%INDITO%"
ping -n 21 127.0.0.1 >nul
goto ciklus

:var
rem 10 masodperc varakozas (a ping a helyi gepre minden Windowson mukodik, a timeout nem mindig).
ping -n 11 127.0.0.1 >nul
goto ciklus
