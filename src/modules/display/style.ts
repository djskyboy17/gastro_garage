/**
 * A konyhai kijelző stílusa. Internet Explorer 11-re: nincs grid és CSS-változó, a flexbox -ms- előtaggal is szerepel.
 * Nagy betűk és legalább 64 px magas érintőgombok (1366×768-as Surface RT kijelzőre méretezve).
 */
export const DISPLAY_CSS = `
html{-ms-content-zooming:none;-ms-touch-action:pan-y;touch-action:pan-y;-ms-text-size-adjust:100%}
*{box-sizing:border-box}
body{margin:0;background:#eef2e8;color:#1d2b20;font-family:"Segoe UI",Tahoma,Arial,sans-serif;font-size:20px;-ms-user-select:none;user-select:none}
h1,h2,p{margin:0}
a{color:inherit;text-decoration:none}
.rejtett{display:none}
.gomb{display:inline-block;border:2px solid #c9d4bd;background:#fff;color:#24402d;border-radius:10px;font-family:inherit;font-weight:700;font-size:20px;padding:10px 16px;min-height:52px;line-height:28px;text-align:center;cursor:pointer;-ms-touch-action:manipulation;touch-action:manipulation;vertical-align:middle}
.gomb.kicsi{font-size:18px;padding:8px 14px;min-height:48px}
.gomb.nagy{font-size:24px;min-height:72px;padding:18px 12px}
.gomb.elsodleges{background:#24402d;border-color:#24402d;color:#fff;width:100%}
.gomb.valasztott{background:#24402d;border-color:#24402d;color:#fff}
.gomb[disabled]{cursor:default}
#fejlec{display:-ms-flexbox;display:flex;-ms-flex-align:center;align-items:center;background:#1f3b2f;color:#fff;padding:8px 16px;position:relative;z-index:5}
#fejlec img{margin-right:12px}
#fejlec .cim{-ms-flex:1 1 auto;flex:1 1 auto;min-width:0}
#fejlec h1{font-size:30px;line-height:34px;font-weight:700}
#fejlec .alcim{font-size:17px;color:#c3d4b8}
#fejlec .gomb{background:#ffffff;margin-left:10px}
#fejlec .gomb.valasztott{background:#d9ed9e;border-color:#d9ed9e;color:#1f3b2f}
#ora{font-size:34px;font-weight:700;margin:0 18px;letter-spacing:1px}
#kapcsolat{font-size:17px;font-weight:700;color:#a8e07a;margin-right:6px;white-space:nowrap}
#kapcsolat.nincs{color:#ff9d8a}
.nyelv{white-space:nowrap}
.nyelv .gomb{margin-left:6px}
.kilepes{display:inline;margin:0}
#sav{background:#b3261e;color:#fff;font-size:24px;font-weight:700;padding:14px 20px;text-align:center}
#sav.info{background:#7a5a00}
#uj-jelzes{background:#f2a900;color:#1d2b20;font-size:28px;font-weight:800;padding:12px 20px;text-align:center}
#lista{padding:12px 16px 40px}
h2{font-size:26px;margin:14px 4px 10px}
h2 .szam{display:inline-block;background:#24402d;color:#fff;border-radius:16px;padding:0 12px;font-size:22px;line-height:32px;margin-left:6px}
.ures{font-size:26px;color:#5d6d58;padding:40px 8px}
.osszesites{background:#fff;border:2px solid #d6dfcb;border-radius:12px;padding:10px 14px;font-size:20px;line-height:36px}
.ossz-cim{font-weight:700;margin-right:10px}
.ossz-tetel{display:inline-block;margin-right:18px;white-space:nowrap}
.ossz-tetel b{font-size:24px}
.kartyak{display:-ms-flexbox;display:flex;-ms-flex-wrap:wrap;flex-wrap:wrap;margin:0 -6px}
.kartya{width:32.2%;margin:0 0.55% 12px;background:#fff;border:3px solid #d6dfcb;border-left-width:12px;border-radius:12px;padding:12px 14px;position:relative}
.kartya.all-queued{border-left-color:#e07a1f}
.kartya.all-cooking{border-left-color:#e3b400;background:#fffbea}
.kartya.all-ready{border-left-color:#3f8f3a}
.kartya.keso{border-color:#d0453a;border-left-color:#d0453a}
.kartya.uj{border-color:#f2a900;-ms-animation:villan 1.2s ease-in-out infinite alternate;animation:villan 1.2s ease-in-out infinite alternate}
@keyframes villan{from{box-shadow:0 0 0 0 rgba(242,169,0,.9)}to{box-shadow:0 0 0 10px rgba(242,169,0,.15)}}
.kfej{font-size:18px;color:#4a5a46;line-height:30px}
.kfej span{margin-right:10px}
.ido{font-size:32px;font-weight:800;color:#1d2b20}
.kod{font-weight:700}
.cimke{display:inline-block;background:#eef2e8;border-radius:6px;padding:0 8px;font-size:16px;line-height:26px}
.cimke.piros{background:#fbe0dc;color:#9c2b20;font-weight:700}
.allapot{float:right;font-weight:700;margin-right:0}
.all-cooking .allapot{color:#8a6a00}
.all-ready .allapot{color:#2f7a2b}
.nev{font-size:22px;font-weight:700;margin:4px 0 6px}
.tetelek{width:100%;border-collapse:collapse;font-size:22px}
.tetelek td{padding:5px 4px;border-top:1px solid #e6ece0;vertical-align:top}
.tetelek .db{width:60px;font-weight:800;font-size:26px;white-space:nowrap}
.tetelek small{display:block;font-size:15px;color:#7a6a2a}
.tetelek .pipa{width:30px;color:#2f7a2b;font-weight:800;font-size:24px}
.tetelek tr.kesz td{color:#7c8a78}
.tetelek tr.kesz .etel{text-decoration:line-through}
.megj{margin-top:8px;background:#fff6d6;border-radius:8px;padding:8px 10px;font-size:19px}
.gombok{display:-ms-flexbox;display:flex;margin-top:12px}
.gombok .gomb{-ms-flex:1 1 0px;flex:1 1 0px;margin:0 4px}
.gomb.folyamatban.aktiv{background:#e3b400;border-color:#e3b400;color:#1d2b20}
.gomb.elkeszult{background:#2f7a2b;border-color:#2f7a2b;color:#fff}
.kartya.folyamatban-kuld .gomb.folyamatban{background:#e3b400;border-color:#e3b400;color:#1d2b20}
.kartya.kesz-kuld{opacity:.6}
.kartya.kesz-kuld .gomb.elkeszult{background:#1e5a1b}
.kesz-lista .kartya{width:24.4%;margin:0 0.3% 10px;padding:8px 12px;opacity:.75}
.kesz-lista .ido{font-size:24px}
.kesz-lista .tetelek{font-size:18px}
.kesz-lista .tetelek .db{font-size:20px}
.belepes{max-width:560px;margin:40px auto;background:#fff;border-radius:16px;padding:28px;border:2px solid #d6dfcb}
.belepes-fej{display:-ms-flexbox;display:flex;-ms-flex-pack:justify;justify-content:space-between;-ms-flex-align:center;align-items:center;margin-bottom:16px}
.belepes h1{font-size:30px;margin-bottom:8px}
.belepes p{margin-bottom:16px;color:#4a5a46}
.belepes label{display:block;font-weight:700;margin-bottom:16px}
.belepes input{display:block;width:100%;font-size:24px;padding:12px;margin-top:6px;border:2px solid #c9d4bd;border-radius:10px;font-family:inherit}
.uzenet{font-size:22px}
.hiba-uzenet{background:#fbe0dc;color:#9c2b20;border-radius:10px;padding:12px}
.belepes .kilepes{display:block;margin-top:16px}
@media (max-width:1150px){.kartya{width:48.9%}.kesz-lista .kartya{width:32.6%}}
@media (max-width:760px){.kartya,.kesz-lista .kartya{width:98.9%}#ora{display:none}#fejlec{-ms-flex-wrap:wrap;flex-wrap:wrap}}
`;
