# Tremol telepítő

Indítás: `Telepites.cmd`, a kasszás saját Windows-fiókjával. A `tremol-bridge-installer` és `tremol-bridge` mappát együtt kell átmásolni, egymás mellé.

A telepítő a meglévő PowerShell-hídhoz készült. A program helye: `%LOCALAPPDATA%\GastroGarage\Tremol\program`. A settings.json és journal frissítéskor érintetlen marad. Az előző programváltozat program-backup-* mappában marad; ezeket ne tedd Gitbe és ne küldd el forráscsomagban. Új konfiguráció preview módú, UTF-8 BOM nélkül.

Csak portlista, változtatás nélkül:
```powershell
.\setup.ps1 -DiagnoseOnly
```
Kiválasztott, ténylegesen csatlakoztatott port ellenőrzése:
```powershell
.\setup.ps1 -ComPort COM3
```
Ez a portot az installation.json tájékoztató fájlban tárolja. **A soros kapcsolatot továbbra is a hivatalos román ZFPLabServerben kell beállítani**, az eszköz saját adatsebességével. Nem feltételezünk automatikusan 115200-at vagy COM1-et. Egy általános FTDI/USB/ST név nem igazolja, hogy az adott eszköz a kassza.

Opcionális drivertelepítés rendszergazda PowerShellből:
```powershell
.\setup.ps1 -DriverDirectory 'C:\Drivers\Tremol'
```
Teljes, megbízható gyártói, aláírt csomag szükséges INF/CAT/SYS állományokkal. Nincs automatikus letöltés, aláírás-ellenőrzés kikapcsolása vagy újraindítás. Másik adminisztrátori fiókkal végzett drivertelepítés után a saját kasszás fiókban is futtasd a normál telepítőt: a telepítés felhasználónkénti.

A telepítés után: hivatalos RO ZFPLabServer telepítése/beállítása → Kasszateszt parancsikon → sorozatszám, fizetésihelyek, TVA-besorolások és kezelő beállítása a meglévő híd README szerint. A telepítő nem indít tesztnyugtát. A program telepítése nem igazolja a hardver működését.

## Eltérés a szolgáltatásos tervtől

A jelenlegi híd kezelői ablakokat használ és fájlokat fogad; Windows-szolgáltatásból ezek nem használhatók. Nincs tremol-bridge.exe, NSSM vagy kész, hitelesített feladatlekérő API. Emiatt a telepítő nem állít be látszólag működő szolgáltatást, autoConfirm-ot vagy nyitott 8080-as tűzfalportot. A helyi ZFP-kapcsolat loopback marad. Az automatikus háttérműködés külön fejlesztés: interaktív felülettől leválasztott worker, eszközazonosítás, hitelesített feladatátadás, tartós nyugtanapló és bizonytalan eredmény egyeztetése szükséges hozzá.

Források: [ADPOS driverközpont](https://adpos.ro/adpos-download-center), [ST Windows driver](https://www.st.com/en/development-tools/stsw-stm32102.html), [PnPUtil](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/pnputil), [hivatalos RO SDK](https://tremol.bg/en/support/zfplab/RO/2601151250).
