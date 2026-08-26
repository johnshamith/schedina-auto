// scegli.mjs — gira ogni mattina su GitHub (che ha internet libero).
// Scarica le quote, sceglie la tripla e scrive schedina.json.
// Poi Claude nel cloud legge quel file e manda l'email a John.
const KEY = process.env.ODDSAPI_KEY;
// Calcio: campionati fissi. Tennis e basket: li cerco da solo, perche
// cambiano ogni settimana (un torneo di tennis dura pochi giorni).
// Misurato su 14.239 partite: nel tennis il sito si tiene 1,39% contro il
// 2,12% del calcio. Piu sport = piu scelta = schedine migliori.
const CALCIO = [
  'soccer_italy_serie_a', 'soccer_epl', 'soccer_spain_la_liga',
  'soccer_france_ligue_one', 'soccer_germany_bundesliga',
  'soccer_portugal_primeira_liga', 'soccer_netherlands_eredivisie',
];
const BASKET = ['basketball_wnba', 'basketball_euroleague', 'basketball_nba'];

// questa chiamata non consuma il piano: dice quali sono vivi adesso
let SPORT = [...CALCIO];
const GRUPPO = {};
const TITOLO = {};
try {
  const rs = await fetch("https://api.the-odds-api.com/v4/sports/?apiKey=" + KEY);
  if (rs.ok) {
    const lista = await rs.json();
    const vivi = new Set(lista.filter(x => x.active).map(x => x.key));
    SPORT = CALCIO.filter(k => vivi.has(k));
    for (const k of BASKET) if (vivi.has(k)) SPORT.push(k);
    for (const x of lista) if (x.active && x.group === "Tennis") SPORT.push(x.key);
    for (const x of lista) TITOLO[x.key] = x.title;
    for (const x of lista) GRUPPO[x.key] = x.group === "Tennis" ? "tennis" : x.group === "Basketball" ? "basket" : "calcio";
  }
} catch { /* se non risponde, resto sul calcio */ }
const R = {
  probGambaMin: 0.62, quotaGambaMin: 1.25, quotaGambaMax: 1.60,
  gambeMinimeGiornata: 6, quotaTotaleMin: 1.70, quotaTotaleMax: 3.60,
  // Se nessun giorno ha 6 partite sicure, invece di saltare si prova una DOPPIA
  // con le due piu sicure, purche ci siano almeno 3 partite fra cui scegliere.
  // Il controllo del costo (max 6%) decide comunque se si gioca o no.
  gambeMinimeDoppia: 3, quotaDoppiaMin: 1.45,
  costoMassimo: 0.06, puntata: 5, sitiMinimi: 15,
};

const mediana = v => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

// toglie il guadagno del sito: metodo Shin
function togliMargine(quote) {
  const inv = quote.map(q => 1 / q);
  const somma = inv.reduce((a, b) => a + b, 0);
  let z = 0;
  for (let i = 0; i < 60; i++) {
    const p = inv.map(x => (Math.sqrt(z * z + 4 * (1 - z) * (x * x) / somma) - z) / (2 * (1 - z)));
    z += (p.reduce((a, b) => a + b, 0) - 1) * 0.5;
    z = Math.max(0, Math.min(0.2, z));
  }
  const p = inv.map(x => (Math.sqrt(z * z + 4 * (1 - z) * (x * x) / somma) - z) / (2 * (1 - z)));
  const s = p.reduce((a, b) => a + b, 0);
  return { prob: p.map(x => x / s), margine: somma - 1 };
}

const NOMI = {
  soccer_italy_serie_a: 'Serie A', soccer_epl: 'Premier League',
  soccer_spain_la_liga: 'Liga', soccer_france_ligue_one: 'Ligue 1',
  soccer_germany_bundesliga: 'Bundesliga', soccer_portugal_primeira_liga: 'Portogallo',
  soccer_netherlands_eredivisie: 'Olanda',
};


// Il link diretto al campionato su 888: cosi John non deve cercare la partita.
// Il modello e  #/filter/{sport}/{paese}/{campionato}  (provato a mano uno per uno).
// Le partite del giorno con le quote si vedono subito in quella pagina.
const LINK888 = {
  soccer_italy_serie_a: 'football/italy/serie_a',
  soccer_epl: 'football/england/premier_league',
  soccer_spain_la_liga: 'football/spain/la_liga',
  soccer_france_ligue_one: 'football/france/ligue_1',
  soccer_germany_bundesliga: 'football/germany/bundesliga',
  soccer_portugal_primeira_liga: 'football/portugal/primeira_liga',
  soccer_netherlands_eredivisie: 'football/netherlands/eredivisie',
  basketball_nba: 'basketball/usa/nba',
  basketball_euroleague: 'basketball/europe/euroleague',
  basketball_wnba: 'basketball/usa/wnba',
};
const linkDi = k => LINK888[k] ? 'https://sport.888casino.it/#/filter/' + LINK888[k] : 'https://sport.888casino.it/#/home';
const eventi = [];
const problemi = [];
let rimaste = null;
for (const s of SPORT) {
  try {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/${s}/odds/?apiKey=${KEY}&regions=eu&markets=h2h&oddsFormat=decimal`);
    rimaste = r.headers.get('x-requests-remaining') ?? rimaste;
    if (!r.ok) { problemi.push(`${s}: HTTP ${r.status}`); continue; }
    const j = await r.json();
    if (Array.isArray(j)) for (const e of j) eventi.push({ ...e, campionato: NOMI[s] || TITOLO[s] || s, sport: GRUPPO[s] || "calcio", link: linkDi(s), sportKey: s });
  } catch (e) { problemi.push(`${s}: ${e.message}`); }
  await new Promise(x => setTimeout(x, 500));
}

const ora = Date.now();
const cand = [];
for (const e of eventi) {
  const inizio = new Date(e.commence_time);
  if (inizio - ora < 45 * 60000) continue;
  const per = {};
  for (const b of (e.bookmakers || [])) {
    const mk = (b.markets || []).find(m => m.key === 'h2h');
    if (mk) for (const o of mk.outcomes) (per[o.name] = per[o.name] || []).push(o.price);
  }
  const nomi = Object.keys(per);
  if (nomi.length < 2) continue;
  const nSiti = Math.min(...nomi.map(n => per[n].length));
  if (nSiti < R.sitiMinimi) continue;

  const med = nomi.map(n => mediana(per[n]));
  const migl = nomi.map(n => Math.max(...per[n]));
  const dev = togliMargine(med);
  if (dev.margine < 0 || dev.margine > 0.14) continue;

  const it = new Date(inizio.getTime() + 2 * 3600000);
  const base = {
    sport: e.sport,
    link: e.link,
    idEvento: e.id,
    sportKey: e.sportKey,
    casa: e.home_team || nomi[0], trasf: e.away_team || nomi[1],
    campionato: e.campionato, nSiti,
    giorno: it.toISOString().slice(0, 10),
    ora: it.toISOString().slice(11, 16),
  };
  const duePossibili = e.sport !== 'calcio';
  const opz = nomi.map((n, i) => ({
    esito: duePossibili ? (n === e.home_team ? '1' : '2') : (n === e.home_team ? '1' : n === e.away_team ? '2' : 'X'),
    dice: duePossibili ? ('vince ' + n) : n,
    prob: dev.prob[i], quota: migl[i],
  }));
  const iX = nomi.findIndex(n => /^draw$/i.test(n));
  if (iX >= 0) {
    for (let i = 0; i < nomi.length; i++) {
      if (i === iX) continue;
      opz.push({
        esito: nomi[i] === e.home_team ? '1X' : 'X2', dice: `${nomi[i]} o pareggio`,
        prob: dev.prob[i] + dev.prob[iX],
        quota: 1 / (1 / migl[i] + 1 / migl[iX]),
      });
    }
    const altri = nomi.map((n, i) => i).filter(i => i !== iX);
    opz.push({ esito: '12', dice: 'no pareggio', prob: altri.reduce((a, i) => a + dev.prob[i], 0), quota: 1 / altri.reduce((a, i) => a + 1 / migl[i], 0) });
  }
  for (const o of opz) {
    if (o.prob < R.probGambaMin) continue;
    const q = Math.round(o.quota * 100) / 100;
    if (q < R.quotaGambaMin || q > R.quotaGambaMax) continue;
    cand.push({ ...base, ...o, quota: q });
  }
}

cand.sort((a, b) => b.prob - a.prob);
const viste = new Set(), tutte = [];
for (const c of cand) { const k = c.casa + c.trasf; if (viste.has(k)) continue; viste.add(k); tutte.push(c); }

const perGiorno = {};
for (const g of tutte) (perGiorno[g.giorno] = perGiorno[g.giorno] || []).push(g);
const giorni = Object.keys(perGiorno).sort();
// Si gioca il PRIMO giorno buono, non il primo giorno pieno.
// Con 6+ partite sicure si fa la tripla, con 3-5 la doppia (meno scelta = meno gambe).
// Cosi si gioca quasi ogni giorno invece di aspettare il weekend.
const giornoUsato = giorni.find(k => perGiorno[k].length >= R.gambeMinimeDoppia);
const nGambe = giornoUsato && perGiorno[giornoUsato].length >= R.gambeMinimeGiornata ? 3 : 2;

const out = {
  quando: new Date().toISOString(),
  chiamateRimaste: rimaste,
  problemi,
  giorniVisti: giorni.map(k => ({ giorno: k, gambe: perGiorno[k].length })),
};

if (!giornoUsato) {
  out.gioca = false;
  out.motivo = `Nessun giorno con almeno ${R.gambeMinimeGiornata} partite sicure.`;
} else {
  const g = perGiorno[giornoUsato].slice(0, nGambe);
  const quota = Math.round(g.reduce((a, x) => a * x.quota, 1) * 100) / 100;
  const prob = g.reduce((a, x) => a * x.prob, 1);
  const costo = 1 - prob * quota;
  const minimo = nGambe === 3 ? R.quotaTotaleMin : R.quotaDoppiaMin;
  if (quota < minimo || quota > R.quotaTotaleMax) {
    out.gioca = false;
    out.motivo = `Quota totale ${quota.toFixed(2)}, fuori dalla fascia ${minimo}-${R.quotaTotaleMax}.`;
  } else if (costo > R.costoMassimo) {
    out.gioca = false;
    out.motivo = `Costa troppo: ${(costo * 100).toFixed(1)}%, il limite e ${(R.costoMassimo * 100).toFixed(0)}%.`;
  } else {
    out.gioca = true;
    out.giorno = giornoUsato;
    out.tipo = nGambe === 3 ? "TRIPLA" : "DOPPIA";
    out.quota = quota;
    out.probabilita = Math.round(prob * 1000) / 1000;
    out.costo = Math.round(costo * 1000) / 1000;
    out.puntata = R.puntata;
    out.vincita = Math.round(quota * R.puntata * 100) / 100;
    out.minimo888 = Math.round(quota * 0.93 * 100) / 100;
    // entro quando puntare: mezz ora prima della PRIMA partita della schedina.
    // (misurato su 2.493 casi: la quota sale o scende quasi uguale, 44% e 44%.
    //  Non c e un orario migliore, conta solo non arrivare tardi.)
    const ore = g.map(x => x.ora).sort();
    const [hh, mm] = ore[0].split(":").map(Number);
    const t = hh * 60 + mm - 30;
    out.puntaEntro = String(Math.floor(((t % 1440) + 1440) % 1440 / 60)).padStart(2, "0") + ":" + String(t % 60 < 0 ? t % 60 + 60 : t % 60).padStart(2, "0");
    out.primaPartita = ore[0];
    out.gambe = g.map(x => ({ idEvento: x.idEvento, sportKey: x.sportKey, link: x.link, casa: x.casa, trasf: x.trasf, campionato: x.campionato, ora: x.ora, esito: x.esito, dice: x.dice, quota: x.quota, prob: Math.round(x.prob * 1000) / 1000, nSiti: x.nSiti }));
    out.altre = perGiorno[giornoUsato].slice(nGambe, nGambe + 5).map(x => ({ link: x.link, casa: x.casa, trasf: x.trasf, campionato: x.campionato, ora: x.ora, esito: x.esito, dice: x.dice, quota: x.quota, prob: Math.round(x.prob * 1000) / 1000, nSiti: x.nSiti }));
  }
}

const fs = await import('node:fs');
fs.writeFileSync('schedina.json', JSON.stringify(out, null, 1));
console.log(out.gioca ? `${out.tipo} del ${out.giorno}, quota ${out.quota}` : `SI SALTA: ${out.motivo}`);
