# Jordd

Jordd er nå satt opp som en statisk PWA med:

- frontend som snakker direkte med Supabase Auth og Edge Functions
- Postgres-datamodell for brukere, sensorer, claim codes og readings
- ESP32 factory firmware med captive portal, claiming og deep sleep

## Lokal kjøring

1. Opprett et Supabase-prosjekt.
2. Kjør SQL-en i [schema.sql](/Users/htpc/Documents/GitHub/jordd/supabase/schema.sql) i Supabase SQL Editor, eller bruk migration-filen i [20260322130000_init.sql](/Users/htpc/Documents/GitHub/jordd/supabase/migrations/20260322130000_init.sql).
3. Kopier [config.example.js](/Users/htpc/Documents/GitHub/jordd/config.example.js) til `config.js`.
4. Fyll inn:
   - `supabaseUrl`
   - `supabaseAnonKey`
   - eventuelt `deviceApiBase` hvis du vil overstyre standarden
5. Start lokal statisk server:

```bash
cd /Users/htpc/Documents/GitHub/jordd
python3 server.py
```

Åpne deretter:

- `http://localhost:8090`

## Supabase Functions

Legg inn disse functionene i prosjektet ditt:

- `auth-register`
- `auth-change-password`
- `app-dashboard`
- `app-account`
- `app-account-update`
- `app-claim-codes`
- `app-delete-sensor`
- `device-claim`
- `device-readings`

Function-kode ligger i:

- [supabase/functions](/Users/htpc/Documents/GitHub/jordd/supabase/functions)

Sett denne secret-en i Supabase:

- `JORDD_INVITE_CODE=testpilot26`

I [config.toml](/Users/htpc/Documents/GitHub/jordd/supabase/config.toml) er `auth-register`, `device-claim` og `device-readings` satt til `verify_jwt = false`.

Kontosiden i PWA-en lar nå brukeren slette egne sensorer manuelt. Sletting fjerner også tilhørende readings via database-cascade.

Når en fysisk sensor factory-resettes og claimes på nytt med samme `device_uid`, overføres den nå automatisk til den nye claimen. Tidligere readings for sensoren slettes, og sensoren forsvinner dermed fra forrige konto uten manuell opprydding.

Repoet inneholder også en GitHub Actions-workflow for Supabase i:

- [.github/workflows/deploy-supabase.yml](/Users/htpc/Documents/GitHub/jordd/.github/workflows/deploy-supabase.yml)

Denne krever GitHub-secrets:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`

## GitHub Pages

Repoet inneholder en Pages-workflow i:

- [.github/workflows/deploy-pages.yml](/Users/htpc/Documents/GitHub/jordd/.github/workflows/deploy-pages.yml)

For at deployen skal fungere må du legge inn disse GitHub-secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `JORDD_DEVICE_API_BASE`

`JORDD_DEVICE_API_BASE` kan normalt være samme verdi som `SUPABASE_URL`.

Workflowen genererer:

- `config.js` med produksjonsverdier
- `CNAME` for `jordd.com`

## Domain

Når GitHub Pages er aktivert for repoet, peker du `jordd.com` til GitHub Pages i DNS hos domeneregistraren din. Deretter lar du sensorene bruke Supabase-prosjektets URL i feltet `Jordd API`.

## Firmware

Factory firmware ligger i:

- [platformio.ini](/Users/htpc/Documents/GitHub/jordd/platformio.ini)
- [main.cpp](/Users/htpc/Documents/GitHub/jordd/firmware/src/main.cpp)
- [firmware/README.md](/Users/htpc/Documents/GitHub/jordd/firmware/README.md)

Firmwareen forventer nå at `Jordd API` peker til Supabase-prosjektets URL. Den bygger selv videre til `/functions/v1/device-claim` og `/functions/v1/device-readings`.
