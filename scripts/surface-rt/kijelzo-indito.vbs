' Gastro-Garage konyhai kijelzo: a kijelzo-indito.bat rejtett ablakban inditasa.
' Minden bejelentkezeskor lefut (HKLM Run), de csak a "Konyha" fiokban csinal valamit.
Option Explicit
Dim sh, nev
Set sh = CreateObject("WScript.Shell")
nev = sh.ExpandEnvironmentStrings("%USERNAME%")
If LCase(nev) = "konyha" Then
  sh.Run "cmd.exe /c """ & "C:\Konyha\kijelzo-indito.bat" & """", 0, False
End If
