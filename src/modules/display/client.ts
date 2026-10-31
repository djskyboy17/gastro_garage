/**
 * A konyhai kijelző kliens-scriptje. Szándékosan ES5 (Internet Explorer 11): XMLHttpRequest, var, function;
 * nincs fetch, Promise, nyílfüggvény, let/const, modul. A tests/display.test.mts ES5-ként elemzi.
 *
 * - 20 mp-enként a /kijelzo/lista?v=<változat> címet kérdezi; ha nincs változás, a szerver 204-et ad, és nem cserél semmit.
 * - Gombnyomásra azonnal átállítja a kártyát (optimista), a kérést kapcsolat nélkül is újrapróbálja.
 * - Új rendelést kiemel, és ha be van kapcsolva, hangjelzést ad.
 */
export const DISPLAY_SCRIPT = String.raw`
(function () {
  var C = window.KIJELZO, t = C.t;
  var lista = document.getElementById('lista');
  var sav = document.getElementById('sav');
  var ujJelzes = document.getElementById('uj-jelzes');
  var kapcsolat = document.getElementById('kapcsolat');
  var version = C.v;
  var hang = C.sound;
  var POLL = 20000;
  var kesleltetes = POLL, idozito = null, folyamatban = false, offline = false;
  var fuggo = {};      // rendelés-azonosító -> {a: muvelet, probak: n}
  var ismert = {};     // már látott rendelések
  var friss = {};      // kiemelt új rendelések -> megjelenés ideje
  var indulas = new Date().getTime();

  function vanOsztaly(el, o) { return (' ' + el.className + ' ').indexOf(' ' + o + ' ') >= 0; }
  function osztaly(el, o, be) {
    var van = vanOsztaly(el, o);
    if (be && !van) el.className = el.className + ' ' + o;
    if (!be && van) el.className = (' ' + el.className + ' ').replace(' ' + o + ' ', ' ').replace(/^\s+|\s+$/g, '');
  }
  function kartyak() {
    var ki = [], all = lista.getElementsByTagName('div'), i;
    for (i = 0; i < all.length; i++) if (vanOsztaly(all[i], 'kartya')) ki.push(all[i]);
    return ki;
  }
  function kartya(id) {
    var k = kartyak(), i;
    for (i = 0; i < k.length; i++) if (k[i].getAttribute('data-id') === id) return k[i];
    return null;
  }

  function keres(modszer, url, adat, kesz) {
    var x = new XMLHttpRequest(), vege = false;
    x.open(modszer, url, true);
    x.timeout = 15000;
    x.setRequestHeader('X-Kijelzo', '1');
    if (adat) x.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded');
    x.onreadystatechange = function () {
      if (x.readyState !== 4 || vege) return;
      vege = true;
      kesz(x.status, x.responseText, x);
    };
    x.ontimeout = function () { if (!vege) { vege = true; kesz(0, '', x); } };
    try { x.send(adat || null); } catch (e) { if (!vege) { vege = true; kesz(0, '', x); } }
  }

  function kapcsolatJelzes(van) {
    offline = !van;
    kapcsolat.className = van ? 'elo' : 'nincs';
    kapcsolat.innerHTML = van ? '&#9679; ' + t.live : '&#9679;';
    if (van) { if (sav.getAttribute('data-ok') === 'offline') { sav.className = 'rejtett'; sav.setAttribute('data-ok', ''); } }
    else { sav.innerHTML = t.offline; sav.className = ''; sav.setAttribute('data-ok', 'offline'); }
  }
  var uzenetIdo = null;
  function uzenet(szoveg) {
    sav.innerHTML = '';
    sav.appendChild(document.createTextNode(szoveg));
    sav.className = 'info';
    sav.setAttribute('data-ok', 'uzenet');
    if (uzenetIdo) clearTimeout(uzenetIdo);
    uzenetIdo = setTimeout(function () { if (sav.getAttribute('data-ok') === 'uzenet') { sav.className = 'rejtett'; sav.setAttribute('data-ok', ''); } }, 6000);
  }

  // A függő műveletek és a kiemelések visszaállítása lista-csere után.
  function allapotVissza() {
    var k = kartyak(), i, id, most = new Date().getTime(), vanUj = false;
    for (i = 0; i < k.length; i++) {
      id = k[i].getAttribute('data-id');
      if (fuggo[id]) optimista(k[i], fuggo[id].a);
      if (friss[id] && most - friss[id] < 15 * 60000) { osztaly(k[i], 'uj', true); vanUj = true; }
      else if (friss[id]) delete friss[id];
    }
    ujJelzes.className = vanUj ? '' : 'rejtett';
  }
  function ujakKeresese() {
    var k = kartyak(), i, id, uj = 0, most = new Date().getTime();
    for (i = 0; i < k.length; i++) {
      id = k[i].getAttribute('data-id');
      if (!ismert[id]) { ismert[id] = true; if (!vanOsztaly(k[i], 'all-ready')) { friss[id] = most; uj++; } }
    }
    return uj;
  }
  function csenget() {
    if (!hang) return;
    var a = document.getElementById('csengo');
    try { a.currentTime = 0; } catch (e) {}
    try { a.play(); } catch (e2) {}
  }

  function utemez(ms) {
    if (idozito) clearTimeout(idozito);
    idozito = setTimeout(frissit, ms);
  }
  function frissit() {
    if (folyamatban) return;
    folyamatban = true;
    keres('GET', '/kijelzo/lista?v=' + encodeURIComponent(version) + '&_=' + new Date().getTime(), null, function (s, szoveg, x) {
      folyamatban = false;
      if (s === 401 || s === 403) { window.location.reload(); return; }
      if (s === 200 || s === 204) {
        kapcsolatJelzes(true);
        kesleltetes = POLL;
        if (s === 200) {
          version = x.getResponseHeader('X-Kijelzo-Verzio') || '';
          lista.innerHTML = szoveg;
          if (ujakKeresese() > 0) csenget();
          allapotVissza();
        }
        fuggoKuldese();
      } else {
        kapcsolatJelzes(false);
        kesleltetes = Math.min(kesleltetes === POLL ? 5000 : kesleltetes * 2, 30000);
      }
      utemez(offline ? kesleltetes : POLL);
      // 6 óránként teljes újratöltés (munkamenet-megújítás, friss script), ha nincs függő művelet.
      if (!offline && !vanFuggo() && new Date().getTime() - indulas > 6 * 3600000) window.location.reload();
    });
  }

  function vanFuggo() { var k; for (k in fuggo) if (fuggo.hasOwnProperty(k)) return true; return false; }
  function allapotFelirat(k, szoveg) {
    var s = k.getElementsByTagName('span'), i;
    for (i = 0; i < s.length; i++) if (vanOsztaly(s[i], 'allapot')) s[i].innerHTML = szoveg;
  }
  function optimista(k, a) {
    if (a === 'accept') {
      // Elfogadás: a kártya azonnal „Folyamatban” lesz; az Elkészült gomb a mentés után, a frissítéssel jön.
      osztaly(k, 'all-queued', false); osztaly(k, 'keres', false); osztaly(k, 'all-cooking', true); osztaly(k, 'elfogad-kuld', true);
      allapotFelirat(k, t.cooking);
      var eg = k.getElementsByTagName('button'), j;
      for (j = 0; j < eg.length; j++) { eg[j].disabled = true; eg[j].innerHTML = t.saving; }
    } else if (a === 'cooking') {
      osztaly(k, 'all-queued', false); osztaly(k, 'all-cooking', true); osztaly(k, 'folyamatban-kuld', true);
    } else {
      osztaly(k, 'kesz-kuld', true);
      var gombok = k.getElementsByTagName('button'), i;
      for (i = 0; i < gombok.length; i++) { gombok[i].disabled = true; if (gombok[i].getAttribute('data-muvelet') === 'ready') gombok[i].innerHTML = t.saving; }
    }
  }
  function kuld(id) {
    var f = fuggo[id];
    if (!f || f.kuldes) return;
    f.kuldes = true;
    keres('POST', '/kijelzo/muvelet', 'id=' + encodeURIComponent(id) + '&a=' + encodeURIComponent(f.a), function (s, szoveg) {
      f.kuldes = false;
      if (s === 200) {
        delete fuggo[id];
        kapcsolatJelzes(true);
        version = '';
        utemez(300);
        return;
      }
      if (s === 401) { window.location.reload(); return; }
      var hiba = '';
      try { hiba = JSON.parse(szoveg).error || ''; } catch (e) {}
      if (s === 0 || s >= 502) {
        // Kapcsolat- vagy átmeneti hiba: a művelet megmarad, a következő sikeres frissítéskor újra elküldjük.
        f.probak = (f.probak || 0) + 1;
        kapcsolatJelzes(false);
        utemez(5000);
        return;
      }
      // Végleges hiba: visszaállítjuk a valós állapotot, és jelezzük.
      delete fuggo[id];
      uzenet(t[hiba] || t.error);
      version = '';
      utemez(100);
    });
  }
  function fuggoKuldese() { var id; for (id in fuggo) if (fuggo.hasOwnProperty(id)) kuld(id); }

  lista.onclick = function (e) {
    e = e || window.event;
    var cel = e.target || e.srcElement, gomb = null, k = null;
    while (cel && cel !== lista) {
      if (!gomb && cel.tagName === 'BUTTON') gomb = cel;
      if (vanOsztaly(cel, 'kartya')) { k = cel; break; }
      cel = cel.parentNode;
    }
    if (!k) return;
    var id = k.getAttribute('data-id');
    // Érintés: az új-rendelés kiemelés eltűnik.
    if (friss[id]) { delete friss[id]; osztaly(k, 'uj', false); allapotVissza(); }
    if (!gomb || gomb.disabled) return;
    var a = gomb.getAttribute('data-muvelet');
    if (a !== 'accept' && a !== 'cooking' && a !== 'ready') return;
    // Egy rendelésre egyszerre csak egy művelet lehet úton.
    if (fuggo[id]) return;
    fuggo[id] = { a: a, probak: 0 };
    optimista(k, a);
    kuld(id);
  };

  var hangGomb = document.getElementById('hang');
  hangGomb.onclick = function () {
    hang = !hang;
    hangGomb.innerHTML = hang ? t.soundOn : t.soundOff;
    // Az IE11 a max-age-et nem ismeri, ezért expires.
    document.cookie = 'kijelzo_hang=' + (hang ? '1' : '0') + '; path=/kijelzo; expires=' + new Date(new Date().getTime() + 31536000000).toUTCString();
    if (hang) csenget();
  };

  var ora = document.getElementById('ora');
  function oraFrissites() {
    var d = new Date(), h = d.getHours(), m = d.getMinutes();
    ora.innerHTML = (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }
  oraFrissites();
  setInterval(oraFrissites, 15000);

  ujakKeresese();
  friss = {};
  utemez(POLL);
})();
`;
