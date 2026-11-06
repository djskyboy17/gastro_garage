# Installer boundary

Installs the existing interactive Windows PowerShell bridge for the current user. Does not change application, database, fiscal configuration, device settings or cloud deployment. Driver installation is optional and administrator-only, through Windows PnPUtil with normal signature enforcement.

Rules: no receipt commands, no guessed COM1, no automatic recognition from generic chipset identities, no automatic live activation. Existing settings and journal remain byte-for-byte unchanged. Missing bridge files and invalid existing configuration fail before replacement. Program replacement uses staging and keeps the previous version. Setup requires exclusive access: close bridge windows before upgrade. Concurrent installers are unsupported.

Acceptance: no connected device permits preview installation with an explicit hardware warning; multiple serial ports require operator selection; requested missing port fails; upgrade preserves settings/journal; fresh settings are UTF-8 without BOM and preview; diagnostics never installs files/drivers; no service is advertised as working.
