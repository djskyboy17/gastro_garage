@echo off
setlocal EnableExtensions
rem ======================================================================
rem  Gastro-Garage konyhai kijelzo - Surface RT (Windows RT 8.1) beallitasa
rem  Rendszergazdakent futtasd (jobb klikk / hosszan nyomva: Futtatas
rem  rendszergazdakent). A PowerShell RT-n korlatozott, ezert csak
rem  cmd, reg, net es powercfg parancsokat hasznal.
rem  Visszaallitas: kijelzo-visszaallitas.bat
rem ======================================================================

set "FIOK=Konyha"
set "MAPPA=C:\Konyha"
set "WINLOGON=HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon"

rem Rendszergazdai jog ellenorzese. A "net session" Windows RT-n nem megbizhato (a Kiszolgalo
rem szolgaltatas gyakran nem fut), ezert olyat nezunk, ami csak emelt joggal sikerul.
set "ADMIN="
reg query "HKU\S-1-5-19" >nul 2>&1 && set "ADMIN=1"
if not defined ADMIN fsutil dirty query %SystemDrive% >nul 2>&1 && set "ADMIN=1"
if not defined ADMIN (
  echo.
  echo HIBA: rendszergazdakent kell futtatni.
  echo Jobb klikk a fajlon ^(erinto: hosszan nyomva^) - Futtatas rendszergazdakent.
  echo Ha a Windows jelszot ker, a bejelentkezett fiok nem rendszergazda:
  echo add meg egy rendszergazdai fiok jelszavat, vagy lepj be azzal.
  echo.
  pause
  exit /b 1
)

set "HIANYZIK="
for %%F in (kijelzo-indito.bat kijelzo-indito.html kijelzo-feladat.xml) do if not exist "%~dp0%%F" set "HIANYZIK=%%F"
if defined HIANYZIK (
  echo HIBA: a %HIANYZIK% nincs ebben a mappaban: %~dp0
  pause
  exit /b 1
)

echo.
echo Gastro-Garage konyhai kijelzo beallitasa
echo ----------------------------------------
echo Letrejon egy "%FIOK%" nevu helyi fiok, amely bekapcsolaskor automatikusan
echo bejelentkezik, es teljes kepernyon megnyitja a konyhai kijelzot.
echo.
echo A "%FIOK%" fiok jelszava (csak betuk es szamok, legalabb 8 karakter).
echo FIGYELEM: az automatikus bejelentkezes miatt a jelszo a rendszerleiro
echo adatbazisba kerul (csak rendszergazda olvashatja). Ne hasznald mashol.
echo.
set "JELSZO="
set /p "JELSZO=Jelszo: "
if not defined JELSZO (
  echo HIBA: ures jelszo.
  pause
  exit /b 1
)
echo %JELSZO%| findstr /r "^[A-Za-z0-9][A-Za-z0-9]*$" >nul
if errorlevel 1 (
  echo HIBA: a jelszoban csak betuk es szamok lehetnek.
  pause
  exit /b 1
)

echo.
echo [1/7] "%FIOK%" helyi fiok...
net user "%FIOK%" >nul 2>&1
if errorlevel 1 (
  net user "%FIOK%" "%JELSZO%" /add /fullname:"Konyhai kijelzo" /comment:"Gastro-Garage konyhai kijelzo" /passwordchg:no >nul
) else (
  net user "%FIOK%" "%JELSZO%" /passwordchg:no >nul
)
if errorlevel 1 (
  echo HIBA: a fiok letrehozasa nem sikerult.
  pause
  exit /b 1
)
rem A jelszo ne jarjon le (ha a wmic elerheto). Az uj fiok normal felhasznalo, nem rendszergazda.
wmic useraccount where "name='%FIOK%'" set PasswordExpires=false >nul 2>&1

echo [2/7] Indito fajlok masolasa: %MAPPA%
if not exist "%MAPPA%" mkdir "%MAPPA%"
copy /y "%~dp0kijelzo-indito.bat" "%MAPPA%\kijelzo-indito.bat" >nul
copy /y "%~dp0kijelzo-indito.html" "%MAPPA%\kijelzo-indito.html" >nul
rem Korabbi valtozatok VBScript-es inditoi: Windows RT-n a WScript.Shell nem hozhato letre,
rem ezek csak hibaablakot dobnanak fel, ezert torljuk oket.
del /q "%MAPPA%\kijelzo-indito.vbs" "%MAPPA%\kijelzo-ie.vbs" >nul 2>&1
del /q "%ProgramData%\Microsoft\Windows\Start Menu\Programs\StartUp\GastroGarageKijelzo.vbs" >nul 2>&1
reg delete "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Run" /v GastroGarageKijelzo /f >nul 2>&1
rem A Konyha fiok olvashatja, de nem modosithatja. SID-ekkel, mert a csoportnevek nyelvfuggok
rem (Administrators / Rendszergazdak, Users / Felhasznalok).
icacls "%MAPPA%" /inheritance:r /grant:r "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F" "*S-1-5-32-545:(OI)(CI)RX" >nul 2>&1

echo [3/7] Inditas bejelentkezeskor (csak a %FIOK% fiokban fut)...
rem Feladatutemezo: a Konyha fiok bejelentkezesekor (10 mp kesleltetessel) inditja a kijelzo-indito.bat-ot.
rem Elsodlegesen XML-bol: csak a bejelentkezett Konyha fiokban fut, jelszot nem tarol,
rem es nem kell hozza kotegelt bejelentkezesi jog.
schtasks /create /tn "GastroGarage Kijelzo" /xml "%~dp0kijelzo-feladat.xml" /f
if errorlevel 1 schtasks /create /tn "GastroGarage Kijelzo" /tr "cmd.exe /c \"%MAPPA%\kijelzo-indito.bat\"" /sc onlogon /delay 0000:10 /ru "%COMPUTERNAME%\%FIOK%" /rp "%JELSZO%" /it /f
if errorlevel 1 (
  echo HIBA: az utemezett feladat letrehozasa nem sikerult. Fenykepezd le ezt az ablakot.
  pause
)

echo [4/7] Automatikus bejelentkezes...
reg add "%WINLOGON%" /v AutoAdminLogon /t REG_SZ /d 1 /f >nul
reg add "%WINLOGON%" /v DefaultUserName /t REG_SZ /d "%FIOK%" /f >nul
reg add "%WINLOGON%" /v DefaultDomainName /t REG_SZ /d "%COMPUTERNAME%" /f >nul
reg add "%WINLOGON%" /v DefaultPassword /t REG_SZ /d "%JELSZO%" /f >nul
reg delete "%WINLOGON%" /v AutoLogonCount /f >nul 2>&1
set "JELSZO="

echo [5/7] Alvas, kepernyo kikapcsolas es ebresztesi jelszo tiltasa...
powercfg /change monitor-timeout-ac 0
powercfg /change monitor-timeout-dc 0
powercfg /change standby-timeout-ac 0
powercfg /change standby-timeout-dc 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 0 >nul 2>&1
powercfg /setdcvalueindex SCHEME_CURRENT SUB_NONE CONSOLELOCK 0 >nul 2>&1
powercfg /setactive SCHEME_CURRENT >nul 2>&1

echo [6/7] Zarolasi kepernyo, frissitesi ujrainditas es ertesitesek...
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\Personalization" /v NoLockScreen /t REG_DWORD /d 1 /f >nul
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\WindowsUpdate\AU" /v NoAutoRebootWithLoggedOnUsers /t REG_DWORD /d 1 /f >nul
reg add "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\Explorer" /v HideSCAHealth /t REG_DWORD /d 1 /f >nul
reg add "HKLM\SOFTWARE\Policies\Microsoft\Internet Explorer\Main" /v DisableFirstRunCustomize /t REG_DWORD /d 1 /f >nul

echo [7/7] Kepernyoszeli huzasok korlatozasa (amennyire Windows RT 8.1-en lehet)...
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v DisableHelpSticker /t REG_DWORD /d 1 /f >nul
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v DisableTLcorner /t REG_DWORD /d 1 /f >nul
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v DisableTRcorner /t REG_DWORD /d 1 /f >nul
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v DisableCharmsHint /t REG_DWORD /d 1 /f >nul
rem Ujabb Windowson ez tiltja az erintos szelso huzast; RT 8.1 figyelmen kivul hagyhatja.
reg add "HKLM\SOFTWARE\Policies\Microsoft\Windows\EdgeUI" /v AllowEdgeSwipe /t REG_DWORD /d 0 /f >nul

echo.
set "IDOZONA="
set /p "IDOZONA=Allitsam az idozonat Bukarestre (GTB Standard Time)? [i/n]: "
if /i "%IDOZONA%"=="i" tzutil /s "GTB Standard Time"

echo.
echo Kesz. Ujrainditas utan a "%FIOK%" fiok automatikusan bejelentkezik,
echo es megnyilik a https://konyha.veres.no/kijelzo oldal teljes kepernyon.
echo Az elso inditaskor egyszer be kell lepni a konyhai dolgozoi fiokkal.
echo.
echo Kilepes a kioszk modbol: Ctrl+Alt+Del (billentyuzettel), vagy
echo Windows-gomb + kijelentkezes; utana a sajat fiokoddal lepj be.
echo.
set "UJRA="
set /p "UJRA=Ujrainditas most? [i/n]: "
if /i "%UJRA%"=="i" shutdown /r /t 5
endlocal
