# Schedina automatica

Ogni mattina alle 8 (ora italiana) questo programma:

1. scarica le quote di 25 siti per 7 campionati
2. calcola la probabilita vera di ogni partita
3. sceglie le 3 piu sicure dello stesso giorno
4. scrive il risultato in `schedina.json`

Poi Claude legge quel file e manda l'email.

Le regole sono le stesse misurate su 407 giorni di partite vere:
gambe con quota 1,25-1,60 e probabilita sopra il 62%, almeno 6 partite
fra cui scegliere, quota totale 1,70-3,60, costo massimo 6%.
Mai coppe.
