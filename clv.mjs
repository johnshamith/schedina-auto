// clv.mjs — il voto vero sulle nostre scelte.
//
// La community di chi scommette da anni e concorde su una cosa: il numero che
// conta non e quanto hai vinto, ma se hai preso una quota MIGLIORE di quella
// finale (la "quota di chiusura"). Quella e la piu precisa che esista: dentro
// ci sono formazioni, infortuni e tutti i soldi entrati fino all'ultimo.
//
// Con 5 giocate i soldi non dicono niente: e troppa fortuna. Il CLV invece
// dice SUBITO se stiamo scegliendo bene.
//
// Gira la sera, poco prima delle partite. Costa 1 chiamata per gamba.
import fs from 'node:fs';

const KEY = process.env.ODDSAPI_KEY;
if (!fs.existsSync('schedina.json')) { console.log('Nessuna schedina.'); process.exit(0); }
const sch = JSON.parse(fs.readFileSync('schedina.json', 'utf8'));
if (!sch.gioca) { console.log('Oggi si saltava: niente da votare.'); process.exit(0); }

const storico = fs.existsSync('storico-clv.json') ? JSON.parse(fs.readFileSync('storico-clv.json', 'utf8')) : [];
if (storico.some(x => x.giorno === sch.giorno && x.quandoScelta === sch.quando)) { console.log('Gia registrata.'); process.exit(0); }

const mediana = v => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };

const righe = [];
for (const g of sch.gambe) {
  if (!g.idEvento || !g.sportKey) { righe.push({ ...g, errore: 'manca il codice partita' }); continue; }
  try {
    const r = await fetch(`https://api.the-odds-api.com/v4/sports/${g.sportKey}/events/${g.idEvento}/odds?apiKey=${KEY}&regions=eu&markets=h2h&oddsFormat=decimal`);
    if (!r.ok) { righe.push({ ...g, errore: `HTTP ${r.status}` }); continue; }
    const j = await r.json();
    const per = {};
    for (const b of (j.bookmakers || [])) {
      const mk = (b.markets || []).find(m => m.key === 'h2h');
      if (mk) for (const o of mk.outcomes) (per[o.name] = per[o.name] || []).push(o.price);
    }
    const nomi = Object.keys(per);
    if (nomi.length < 2) { righe.push({ ...g, errore: 'nessuna quota' }); continue; }
    const med = nomi.map(n => mediana(per[n]));
    const iCasa = nomi.indexOf(g.casa), iTrasf = nomi.indexOf(g.trasf);
    const iX = nomi.findIndex(n => /^draw$/i.test(n));
    // ricostruisco la quota di chiusura per il nostro esito
    let chiusura = null;
    const inv = i => i >= 0 ? 1 / med[i] : 0;
    if (g.esito === '1') chiusura = med[iCasa];
    else if (g.esito === '2') chiusura = med[iTrasf];
    else if (g.esito === 'X') chiusura = med[iX];
    else if (g.esito === '1X') chiusura = 1 / (inv(iCasa) + inv(iX));
    else if (g.esito === 'X2') chiusura = 1 / (inv(iX) + inv(iTrasf));
    else if (g.esito === '12') chiusura = 1 / (inv(iCasa) + inv(iTrasf));
    if (!chiusura || !(chiusura > 1)) { righe.push({ ...g, errore: 'esito non ricostruibile' }); continue; }
    chiusura = Math.round(chiusura * 100) / 100;
    righe.push({ casa: g.casa, trasf: g.trasf, esito: g.esito, nostra: g.quota, chiusura, clv: Math.round((g.quota / chiusura - 1) * 1000) / 10 });
  } catch (e) { righe.push({ ...g, errore: e.message }); }
  await new Promise(x => setTimeout(x, 400));
}

const buone = righe.filter(x => typeof x.clv === 'number');
const medio = buone.length ? Math.round(buone.reduce((a, x) => a + x.clv, 0) / buone.length * 10) / 10 : null;
storico.push({ giorno: sch.giorno, quandoScelta: sch.quando, quandoControllo: new Date().toISOString(), tipo: sch.tipo, quota: sch.quota, gambe: righe, clvMedio: medio });
fs.writeFileSync('storico-clv.json', JSON.stringify(storico, null, 1));

console.log(`\nVOTO SULLE SCELTE — ${sch.giorno}\n`);
for (const x of righe) {
  if (x.errore) { console.log(`  ${x.casa} - ${x.trasf}: ${x.errore}`); continue; }
  console.log(`  ${(x.casa + ' - ' + x.trasf).slice(0, 34).padEnd(36)} ${x.esito.padEnd(3)} nostra ${x.nostra}  chiusura ${x.chiusura}  ->  ${x.clv >= 0 ? '+' : ''}${x.clv}%`);
}
if (medio !== null) {
  console.log(`\nMedia: ${medio >= 0 ? '+' : ''}${medio}%`);
  console.log(medio > 0 ? 'Positivo: prendiamo quote migliori di quelle finali. Buon segno.' : 'Negativo: prendiamo quote peggiori di quelle finali. Da tenere d occhio.');
}
const tutte = storico.flatMap(x => x.gambe).filter(x => typeof x.clv === 'number');
if (tutte.length) {
  const m = tutte.reduce((a, x) => a + x.clv, 0) / tutte.length;
  console.log(`\nDall inizio: ${tutte.length} gambe, media ${m >= 0 ? '+' : ''}${m.toFixed(1)}%`);
  console.log('(serve un centinaio di gambe perche il numero voglia dire qualcosa)');
}
