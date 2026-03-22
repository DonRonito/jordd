# Jordd Factory Firmware

Dette er nå en ren onboarding- og test-firmware for ESP32 uten sensordrivere.

Den gjør dette:

- starter eget setup-Wi-Fi ved første oppstart
- viser captive portal for Wi-Fi-passord, claim code og API-base
- claimer seg mot Jordd
- sender en enkel heartbeat med batteridata
- går i deep sleep mellom opplastinger
- kan factory-resettes uten reflashing

## Ingen sensordependenser

Denne varianten bruker ingen Adafruit- eller sensorbiblioteker. Den er laget for å teste:

- captive portal
- claiming
- lagring av credentials
- reset-flyt
- periodisk opplasting

Temperatur og luftfuktighet er derfor ikke med i denne builden.

## Bygg

```bash
pio run
```

## Flash

```bash
pio run --target upload
```

## Setup-Wi-Fi

- SSID: `Jordd-Setup-XXXX`
- passord: `jorddsetup`

## Jordd API

I feltet `Jordd API` oppgir du normalt Supabase-prosjektets URL, for eksempel:

```text
https://abc123.supabase.co
```

Firmwareen bygger da selv videre til:

- `/functions/v1/device-claim`
- `/functions/v1/device-readings`

Du kan også skrive inn en full functions-base direkte hvis du vil.

## Factory reset

Du har tre måter å slette all lagret config på:

1. Serial Monitor:
   - restart ESP-en
   - innen de første sekundene, skriv `reset` eller `factory-reset`

2. BOOT-knapp:
   - restart ESP-en
   - hold inne BOOT-knappen i omtrent 4 sekunder under oppstart

3. Captive portal:
   - åpne setup-portalen
   - trykk `Factory reset`

Factory reset sletter:

- Wi‑Fi SSID
- Wi‑Fi-passord
- claim code
- `device_token`
- `sensor_id`
- `api_base`
- lagret opplastingsintervall

Etter reset starter enheten opp igjen i setup-modus.

## Viktig om HTTPS

Firmwareen bruker `setInsecure()` for HTTPS-klienten for å gjøre testflyten enkel. For produksjon bør dette byttes til sertifikat-pinning eller eksplisitt CA-støtte.
