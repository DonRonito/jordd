# Jordd v3

Jordd er nå en PWA og sky-orientert sensorplattform for batteridrevne ESP32-sensorer som snakker direkte med `jordd.com`.

Denne repo-versjonen inneholder:

- en lokal dev-server for kontoer, sessions, claim codes, sensorer og readings
- en statisk PWA med login, dashboard, add-sensor-flyt og kontoside
- en første factory firmware-mal for ESP32 med captive portal, claiming og deep sleep

## Lokal kjøring

```bash
cd /Users/htpc/Documents/GitHub/jordd
python3 server.py
```

Åpne deretter:

- `http://localhost:8090`

## V1-flyt

1. Opprett konto eller logg inn i Jordd.
2. Generer en claim code i `Legg til`.
3. Koble telefonen til sensorens setup-Wi-Fi.
4. Fyll inn hjemmets Wi-Fi og claim code i sensorens captive portal.
5. Gå tilbake til Jordd og oppdater dashboardet.

## Demo-konto

Dev-serveren seeder automatisk en demo-konto med tre sensorer:

- brukernavn: `test`
- passord: `test`

## API-er i dev-serveren

- `GET /api/auth/session`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `POST /api/auth/change-password`
- `GET /api/app/dashboard`
- `POST /api/app/claim-codes`
- `GET /api/app/account`
- `PATCH /api/app/account`
- `POST /api/device/claim`
- `POST /api/device/readings`

## Datamodell

Dev-serveren lagrer data i `jordd-data.json` med disse hovedsamlingene:

- `users`
- `sessions`
- `sensors`
- `sensor_readings`
- `sensor_claim_codes`

Dette speiler modellen som senere kan flyttes til Supabase/Postgres i produksjon.

## Firmware

Factory firmware ligger i:

- [platformio.ini](/Users/htpc/Documents/GitHub/jordd/platformio.ini)
- [main.cpp](/Users/htpc/Documents/GitHub/jordd/firmware/src/main.cpp)
- [firmware/README.md](/Users/htpc/Documents/GitHub/jordd/firmware/README.md)

Firmwareen er satt opp for:

- ESP32
- captive portal over sensorens eget Wi-Fi
- claim mot Jordd over HTTPS
- deep sleep mellom opplastinger
- factory reset via serial, BOOT-knapp eller portal

Denne firmware-varianten er en ren setup-/test-build uten sensordrivere, slik at onboardingflyten kan verifiseres før faktiske sensorer legges til.

## Viktig om produksjon

Planen peker mot Supabase for auth og database på `jordd.com`, men denne repo-implementasjonen bruker en dependency-fri lokal Python-server for å gjøre hele flyten kjørbar og testbar uten ekstern infrastruktur.
