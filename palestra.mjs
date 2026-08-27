import fs from 'node:fs';
// palestra.mjs - allenamento automatico su Betfair Exchange, SENZA SOLDI VERI.
// Parte da 15 euro finti, una giocata al giorno, puntata alta (un terzo della cassa).
// Serve a confrontare questo metodo con quello di opencode senza rischiare niente.
const KEY = process.env.ODDSAPI_KEY;
const FILE = 'palestra.json';
const INIZIALE = 15;

const oggiIt = () => new Date(Date.now() + 2 * 3600000).toISOString().slice(0, 10);

let st = { cassa: INIZIALE, iniziale: INIZIALE, aperte: [], storico: [] };
if (fs.existsSync(FILE)) st = JSON.parse(fs.readFileSync(FILE, 'utf8'));

// ---------- 1) chiudo le giocate finite ----------
const perSport = {};
for (const b of st.aperte) (perSport[b.sportKey] = perSport[b.sportKey] || []).push(b);
const restano = [];
for (const [sk, lista] of Object.entries(perSport)) {
  let risultati = [];
  try {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/${sk}/scores/?apiKey=${KEY}&daysFrom=3`);
    if (r.ok) risultati = await r.json();
  } catch { /* se non risponde, la giocata resta aperta */ }
  for (const b of lista) {
    const e = risultati.find(x => x.id === b.idEvento);
    if (!e || !e.completed || !e.scores) { restano.push(b); continue; }
    const gc = Number((e.scores.find(s => s.name === e.home_team) || {}).score);
    const gt = Number((e.scores.find(s => s.name === e.away_team) || {}).score);
    if (!Number.isFinite(gc) || !Number.isFinite(gt)) { restano.push(b); continue; }
    const vero = gc > gt ? '1' : gc < gt ? '2' : 'X';
    const vinta = vero === b.esito;
    const incasso = vinta ? Math.round(b.puntata * b.quota * 100) / 100 : 0;
    st.cassa = Math.round((st.cassa + incasso) * 100) / 100;
    st.storico.push({ ...b, risultato: `${gc}-${gt}`, vinta, incasso, cassaDopo: st.cassa });
    console.log((vinta ? 'VINTA  ' : 'PERSA  ') + b.casa + ' - ' + b.trasf + '  ' + gc + '-' + gt + '  cassa ' + st.cassa);
  }
}
st.aperte = restano;

// ---------- 2) la giocata di oggi ----------
const oggi = oggiIt();
const giaOggi = st.aperte.some(b => b.data === oggi) || st.storico.some(b => b.data === oggi);
if (st.cassa < 1) {
  console.log('Cassa finita: ' + st.cassa + '. La palestra si ferma.');
} else if (giaOggi) {
  console.log('Giocata di oggi gia fatta.');
} else if (!fs.existsSync('schedina.json')) {
  console.log('Manca schedina.json, non scelgo niente.');
} else {
  const sc = JSON.parse(fs.readFileSync('schedina.json', 'utf8'));
  const usati = new Set([...st.aperte, ...st.storico].map(b => b.idEvento));
  const limite = Date.now() + 36 * 3600000;
  const scelte = (sc.betfair || [])
    .filter(b => !usati.has(b.idEvento))
    .filter(b => new Date(b.giorno + 'T' + b.ora + ':00Z').getTime() - 2 * 3600000 < limite)
    .filter(b => b.quota >= 1.45 && b.quota <= 2.40);
  const b = scelte[0];
  if (!b) {
    console.log('Nessuna partita adatta su Betfair oggi.');
  } else {
    const puntata = Math.max(1, Math.min(st.cassa, Math.round((st.cassa / 3) * 100) / 100));
    st.cassa = Math.round((st.cassa - puntata) * 100) / 100;
    st.aperte.push({
      data: oggi, idEvento: b.idEvento, sportKey: b.sportKey,
      casa: b.casa, trasf: b.trasf, campionato: b.campionato, ora: b.ora, giorno: b.giorno,
      esito: b.esito, dice: b.dice, quota: b.quota, quotaMercato: b.quotaMercato,
      prob: b.prob, valore: b.valore, puntata,
    });
    console.log('GIOCO  ' + b.casa + ' - ' + b.trasf + '  ' + b.esito + ' @ ' + b.quota + '  punto ' + puntata + '  cassa ' + st.cassa);
  }
}

// ---------- 3) riassunto ----------
const vinte = st.storico.filter(x => x.vinta).length;
const perse = st.storico.length - vinte;
const impegnato = st.aperte.reduce((a, b) => a + b.puntata, 0);
st.totale = Math.round((st.cassa + impegnato) * 100) / 100;
st.vinte = vinte; st.perse = perse;
st.aggiornato = new Date().toISOString();
fs.writeFileSync(FILE, JSON.stringify(st, null, 2));
console.log('PALESTRA: ' + st.totale + ' euro (partita da ' + st.iniziale + ')  vinte ' + vinte + '  perse ' + perse + '  aperte ' + st.aperte.length);
