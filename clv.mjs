// clv.mjs — il voto vero sulle nostre scelte.
//
// Non conta quanto vinci: conta se hai preso una quota MIGLIORE di quella
// FINALE (l'ultima prima del fischio d'inizio). Quella e la piu precisa che
// esista: dentro ci sono formazioni, infortuni e tutti i soldi entrati.
// Con 5 giocate i soldi non dicono niente, e troppa fortuna. Il CLV dice
// SUBITO se stiamo scegliendo bene.
//
// Gira piu volte al giorno. Ogni volta guarda solo le partite che stanno per
// cominciare (fra 15 e 120 minuti) e che non ha ancora votato. Cosi funziona
// anche per le partite di mezzogiorno, e costa pochissime chiamate.
import fs from 'node:fs';

const KEY = process.env.ODDSAPI_KEY;
if (!fs.existsSync('schedina.json')) { console.log('Nessuna schedina.'); process.exit(0); }
const sch = JSON.parse(fs.readFileSync('schedina.json', 'utf8'));
if (!sch.gioca) { console.log('Si saltava: niente da votare.'); process.exit(0); }

const F = 'storico-clv.json';
const storico = fs.existsSync(F) ? JSON.parse(fs.readFileSync(F, 'utf8')) : [];
const gia = new Set(storico.map(x => x.chiave));
const mediana = v => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

// l'ora nella schedina e italiana (UTC+2): la riporto a ora universale
function inizioDi(g) {
  const [hh, mm] = (g.ora || '00:00').split(':').map(Number);
  const [a, m, d] = sch.giorno.split('-').map(Number);
  return Date.UTC(a, m - 1, d, hh - 2, mm);
}

let fatte = 0, saltate = 0;
for (const g of sch.gambe) {
  const chiave = sch.giorno + '|' + g.casa + '|' + g.trasf + '|' + g.esito;
  if (gia.has(chiave)) continue;
  const fra = (inizioDi(g) - Date.now()) / 60000;
  if (fra > 120 || fra < 10) { saltate++; continue; }   // troppo presto o gia iniziata
  if (!g.idEvento || !g.sportKey) { console.log(`  ${g.casa}: manca il codice partita`); continue; }
  try {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/${g.sportKey}/events/${g.idEvento}/odds?apiKey=${KEY}&regions=eu&markets=h2h&oddsFormat=decimal`);
    if (!r.ok) { console.log(`  ${g.casa}: HTTP ${r.status}`); continue; }
    const j = await r.json();
    const per = {};
    for (const b of (j.bookmakers || [])) {
      const mk = (b.markets || []).find(m => m.key === 'h2h');
      if (mk) for (const o of mk.outcomes) (per[o.name] = per[o.name] || []).push(o.price);
    }
    const nomi = Object.keys(per);
    if (nomi.length < 2) { console.log(`  ${g.casa}: nessuna quota`); continue; }
    const med = nomi.map(n => mediana(per[n]));
    const iC = nomi.indexOf(g.casa), iT = nomi.indexOf(g.trasf), iX = nomi.findIndex(n => /^draw$/i.test(n));
    const inv = i => i >= 0 ? 1 / med[i] : 0;
    let ch = null;
    if (g.esito === '1') ch = med[iC];
    else if (g.esito === '2') ch = med[iT];
    else if (g.esito === 'X') ch = med[iX];
    else if (g.esito === '1X') ch = 1 / (inv(iC) + inv(iX));
    else if (g.esito === 'X2') ch = 1 / (inv(iX) + inv(iT));
    else if (g.esito === '12') ch = 1 / (inv(iC) + inv(iT));
    if (!ch || !(ch > 1)) { console.log(`  ${g.casa}: esito non ricostruibile`); continue; }
    ch = Math.round(ch * 100) / 100;
    const clv = Math.round((g.quota / ch - 1) * 1000) / 10;
    storico.push({ chiave, giorno: sch.giorno, casa: g.casa, trasf: g.trasf, esito: g.esito, nostra: g.quota, chiusura: ch, clv, minutiPrima: Math.round(fra), quando: new Date().toISOString() });
    fatte++;
    console.log(`  ${(g.casa + ' - ' + g.trasf).slice(0, 34).padEnd(36)} ${g.esito.padEnd(3)} nostra ${g.quota}  chiusura ${ch}  ->  ${clv >= 0 ? '+' : ''}${clv}%   (${Math.round(fra)} min prima)`);
  } catch (e) { console.log(`  ${g.casa}: ${e.message}`); }
  await new Promise(x => setTimeout(x, 400));
}

if (fatte) fs.writeFileSync(F, JSON.stringify(storico, null, 1));
console.log(fatte ? `\n${fatte} gambe votate.` : `Niente da votare adesso (${saltate} partite non ancora vicine).`);

if (storico.length) {
  const m = storico.reduce((a, x) => a + x.clv, 0) / storico.length;
  const sopra = storico.filter(x => x.clv > 0).length;
  console.log(`\nDALL INIZIO: ${storico.length} gambe  ·  media ${m >= 0 ? '+' : ''}${m.toFixed(1)}%  ·  quote battute ${sopra} su ${storico.length}`);
  console.log(m > 0 ? 'Positivo: prendiamo quote migliori di quelle finali.' : 'Negativo: prendiamo quote peggiori di quelle finali.');
  if (storico.length < 100) console.log('(serve un centinaio di gambe perche voglia dire qualcosa)');
}
