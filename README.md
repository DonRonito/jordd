# Jordd

Jordd er en enkel PWA-launcher for Home Assistant.

Den gjør tre ting:

- viser instruksjoner for å installere appen som PWA første gang
- lar brukeren lagre en Home Assistant-URL lokalt i nettleseren
- viser en tydelig knapp for å åpne Home Assistant neste gang appen åpnes

## Lokal testing

```bash
cd /Users/htpc/Documents/GitHub/jordd
python3 -m http.server 4173
```

Åpne deretter `http://localhost:4173`.

## Viktig å vite

- Nettleseren kan ikke gjøre full skanning av hele lokalnettet.
- Derfor foreslår Jordd bare de vanligste lokale Home Assistant-adressene.
- Selve appen embedder ikke Home Assistant. Den fungerer bare som en launcher som sender brukeren videre til lagret URL.
