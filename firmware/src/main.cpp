#include <Arduino.h>
#include <DNSServer.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WebServer.h>
#include <WiFi.h>
#include <WiFiClient.h>
#include <WiFiClientSecure.h>

#include <memory>

#ifndef JORDD_API_BASE
#define JORDD_API_BASE "https://aaqrxluybkwgizrvappo.supabase.co"
#endif

namespace {
constexpr char kPrefsNamespace[] = "jordd";
constexpr char kApPassword[] = "jorddsetup";
constexpr char kDefaultApiBase[] = JORDD_API_BASE;
constexpr uint64_t kMicrosPerMinute = 60ULL * 1000ULL * 1000ULL;
constexpr uint32_t kWifiConnectTimeoutMs = 20000;
constexpr uint32_t kRetryDelayMs = 3000;
constexpr uint32_t kSerialCommandWindowMs = 8000;
constexpr uint32_t kBootButtonHoldMs = 4000;
constexpr uint8_t kDnsPort = 53;
constexpr uint8_t kBootButtonPin = 0;
constexpr int kBatteryAdcPin = 34;
constexpr float kBatteryDividerRatio = 2.0f;
constexpr int kDefaultUploadIntervalMinutes = 60;
}  // namespace

Preferences preferences;
DNSServer dnsServer;
WebServer portalServer(80);

struct DeviceConfig {
  String wifiSsid;
  String wifiPassword;
  String claimCode;
  String deviceToken;
  String sensorId;
  String apiBase;
  String deviceUid;
  String firmwareVersion;
  uint16_t uploadIntervalMinutes = kDefaultUploadIntervalMinutes;
};

DeviceConfig config;

String normalizeApiBase(String value) {
  value.trim();
  while (value.endsWith("/")) {
    value.remove(value.length() - 1);
  }
  if (value.endsWith("/functions/v1")) {
    value.remove(value.length() - String("/functions/v1").length());
  }
  if (!value.isEmpty()) {
    return value;
  }
  return String(kDefaultApiBase);
}

String functionEndpoint(const String& functionName) {
  return normalizeApiBase(config.apiBase) + "/functions/v1/" + functionName;
}

String chipIdSuffix() {
  uint64_t chipId = ESP.getEfuseMac();
  char buffer[9];
  snprintf(buffer, sizeof(buffer), "%08llX", static_cast<unsigned long long>(chipId & 0xffffffffULL));
  return String(buffer);
}

String defaultSetupSsid() {
  return "Jordd-Setup-" + chipIdSuffix().substring(4);
}

String htmlPage(const String& title, const String& content) {
  return String(F(
             "<!doctype html><html><head><meta charset='utf-8'><meta name='viewport' "
             "content='width=device-width,initial-scale=1'><title>")) +
         title +
         String(F(
             "</title><style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;"
             "margin:0;padding:24px;background:#0b1720;color:#eef7f8}main{max-width:560px;"
             "margin:0 auto}form{display:grid;gap:14px}input{padding:12px 14px;border-radius:12px;"
             "border:1px solid #2f4a56;background:#13232d;color:#eef7f8}button{padding:14px 16px;"
             "border:none;border-radius:999px;background:#ffb44d;color:#102129;font-weight:700}"
             ".card{background:#12232d;border:1px solid #26414d;border-radius:24px;padding:20px}"
             ".ghost{background:#203744;color:#eef7f8}.actions{display:flex;gap:12px;flex-wrap:wrap}"
             ".network-list{display:grid;gap:10px;margin:18px 0}.network-choice{text-align:left}"
             ".hint{font-size:14px;color:#9fb8c0}.advanced{border-top:1px solid #26414d;padding-top:14px}"
             "details summary{cursor:pointer;color:#eef7f8;font-weight:600}p{line-height:1.5;color:#bdd1d8}"
             "h1,h2{line-height:1.1}</style></head><body><main>")) +
         content +
         String(F(
             "<script>"
             "document.querySelectorAll('[data-ssid]').forEach(function(button){"
             "button.addEventListener('click', function(){"
             "var target=document.getElementById('wifi_ssid');"
             "if(target){target.value=this.dataset.ssid || '';target.focus();}"
             "});});"
             "</script></main></body></html>"));
}

String jsonEscape(const String& value) {
  String escaped = value;
  escaped.replace("\\", "\\\\");
  escaped.replace("\"", "\\\"");
  escaped.replace("\n", "\\n");
  escaped.replace("\r", "\\r");
  return escaped;
}

String htmlEscape(const String& value) {
  String escaped = value;
  escaped.replace("&", "&amp;");
  escaped.replace("<", "&lt;");
  escaped.replace(">", "&gt;");
  escaped.replace("\"", "&quot;");
  escaped.replace("'", "&#39;");
  return escaped;
}

String extractJsonString(const String& json, const String& key) {
  const String needle = "\"" + key + "\":";
  int keyIndex = json.indexOf(needle);
  if (keyIndex < 0) {
    return "";
  }

  int firstQuote = json.indexOf('"', keyIndex + needle.length());
  if (firstQuote < 0) {
    return "";
  }

  int secondQuote = firstQuote + 1;
  while (secondQuote < json.length()) {
    secondQuote = json.indexOf('"', secondQuote);
    if (secondQuote < 0) {
      return "";
    }
    if (json.charAt(secondQuote - 1) != '\\') {
      break;
    }
    secondQuote++;
  }

  if (secondQuote < 0) {
    return "";
  }

  String result = json.substring(firstQuote + 1, secondQuote);
  result.replace("\\\"", "\"");
  result.replace("\\n", "\n");
  result.replace("\\r", "\r");
  result.replace("\\\\", "\\");
  return result;
}

long extractJsonLong(const String& json, const String& key, long fallback) {
  const String needle = "\"" + key + "\":";
  int keyIndex = json.indexOf(needle);
  if (keyIndex < 0) {
    return fallback;
  }

  int valueStart = keyIndex + needle.length();
  while (valueStart < json.length() && (json.charAt(valueStart) == ' ' || json.charAt(valueStart) == '\n')) {
    valueStart++;
  }

  int valueEnd = valueStart;
  while (valueEnd < json.length() && isDigit(json.charAt(valueEnd))) {
    valueEnd++;
  }

  if (valueEnd <= valueStart) {
    return fallback;
  }

  return json.substring(valueStart, valueEnd).toInt();
}

void loadConfig() {
  config.wifiSsid = preferences.getString("wifi_ssid", "");
  config.wifiPassword = preferences.getString("wifi_pass", "");
  config.claimCode = preferences.getString("claim_code", "");
  config.deviceToken = preferences.getString("device_token", "");
  config.sensorId = preferences.getString("sensor_id", "");
  config.apiBase = normalizeApiBase(preferences.getString("api_base", kDefaultApiBase));
  config.uploadIntervalMinutes = preferences.getUShort("upload_min", kDefaultUploadIntervalMinutes);
  config.deviceUid = chipIdSuffix();
  config.firmwareVersion = "jordd-factory-setup-0.2.0";
}

void clearStoredConfig() {
  preferences.clear();
  WiFi.disconnect(true, true);
  config = DeviceConfig();
}

void saveProvisioning(const String& wifiSsid, const String& wifiPassword, const String& claimCode, const String& apiBase) {
  preferences.putString("wifi_ssid", wifiSsid);
  preferences.putString("wifi_pass", wifiPassword);
  preferences.putString("claim_code", claimCode);
  preferences.putString("api_base", normalizeApiBase(apiBase));
  config.wifiSsid = wifiSsid;
  config.wifiPassword = wifiPassword;
  config.claimCode = claimCode;
  config.apiBase = normalizeApiBase(apiBase);
}

void saveClaimResult(const String& sensorId, const String& deviceToken, uint16_t uploadIntervalMinutes) {
  preferences.putString("sensor_id", sensorId);
  preferences.putString("device_token", deviceToken);
  preferences.putString("claim_code", "");
  preferences.putUShort("upload_min", uploadIntervalMinutes);
  config.sensorId = sensorId;
  config.deviceToken = deviceToken;
  config.claimCode = "";
  config.uploadIntervalMinutes = uploadIntervalMinutes;
}

bool hasProvisioning() {
  return !config.wifiSsid.isEmpty() && !config.deviceToken.isEmpty() && !config.sensorId.isEmpty();
}

bool connectToWifi(const String& ssid, const String& password, uint32_t timeoutMs) {
  WiFi.mode(WIFI_AP_STA);
  WiFi.begin(ssid.c_str(), password.c_str());

  const uint32_t startedAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startedAt < timeoutMs) {
    delay(250);
  }

  return WiFi.status() == WL_CONNECTED;
}

std::unique_ptr<WiFiClient> createClientForUrl(const String& url) {
  if (url.startsWith("https://")) {
    auto secureClient = std::make_unique<WiFiClientSecure>();
    secureClient->setInsecure();
    return secureClient;
  }

  return std::make_unique<WiFiClient>();
}

bool claimDevice(String* errorMessage = nullptr) {
  const String endpoint = functionEndpoint("device-claim");
  std::unique_ptr<WiFiClient> client = createClientForUrl(endpoint);
  HTTPClient http;
  if (!http.begin(*client, endpoint)) {
    if (errorMessage) {
      *errorMessage = "Kunne ikke starte claim-request.";
    }
    return false;
  }

  const String body =
      "{\"claim_code\":\"" + jsonEscape(config.claimCode) + "\","
      "\"device_uid\":\"" + jsonEscape(config.deviceUid) + "\","
      "\"firmware_version\":\"" + jsonEscape(config.firmwareVersion) + "\","
      "\"capabilities\":[\"setup-test\",\"battery\"]}";

  http.addHeader("Content-Type", "application/json");
  const int statusCode = http.POST(body);
  const String responseBody = http.getString();
  http.end();

  if (statusCode < 200 || statusCode >= 300) {
    if (errorMessage) {
      *errorMessage = responseBody.length() ? responseBody : "Claim feilet.";
    }
    return false;
  }

  const String sensorId = extractJsonString(responseBody, "sensor_id");
  const String deviceToken = extractJsonString(responseBody, "device_token");
  const uint16_t uploadIntervalMinutes = static_cast<uint16_t>(extractJsonLong(responseBody, "upload_interval_minutes", kDefaultUploadIntervalMinutes));

  if (sensorId.isEmpty() || deviceToken.isEmpty()) {
    if (errorMessage) {
      *errorMessage = "Klarte ikke lese claim-svaret fra Jordd.";
    }
    return false;
  }

  saveClaimResult(sensorId, deviceToken, uploadIntervalMinutes);
  return true;
}

String renderWifiScanResults() {
  String markup = String(F("<div class='network-list'>"));
  const int networkCount = WiFi.scanNetworks(false, true);
  if (networkCount <= 0) {
    markup += String(F("<p class='hint'>Fant ingen nett akkurat nå. Du kan fortsatt skrive SSID manuelt.</p>"));
  } else {
    for (int index = 0; index < networkCount; index++) {
      const String ssid = WiFi.SSID(index);
      if (ssid.isEmpty()) {
        continue;
      }
      const String signal = String(WiFi.RSSI(index));
      const bool encrypted = WiFi.encryptionType(index) != WIFI_AUTH_OPEN;
      markup += String(F("<button class='ghost network-choice' type='button' data-ssid='")) + htmlEscape(ssid) +
                String(F("'><strong>")) + htmlEscape(ssid) + String(F("</strong><br><span class='hint'>")) +
                signal + String(F(" dBm")) + (encrypted ? String(F(" · sikret")) : String(F(" · åpent"))) +
                String(F("</span></button>"));
    }
  }
  WiFi.scanDelete();
  markup += String(F("</div>"));
  return markup;
}

uint16_t readBatteryMillivolts() {
  analogReadResolution(12);
  const uint16_t rawMv = analogReadMilliVolts(kBatteryAdcPin);
  return static_cast<uint16_t>(rawMv * kBatteryDividerRatio);
}

uint8_t batteryPercentFromMillivolts(uint16_t mv) {
  if (mv <= 3000) {
    return 0;
  }
  if (mv >= 4200) {
    return 100;
  }
  return static_cast<uint8_t>(((mv - 3000) * 100) / 1200);
}

bool uploadHeartbeat(uint16_t batteryMv, uint8_t batteryPct) {
  const String endpoint = functionEndpoint("device-readings");
  std::unique_ptr<WiFiClient> client = createClientForUrl(endpoint);
  HTTPClient http;
  if (!http.begin(*client, endpoint)) {
    return false;
  }

  const String body =
      "{\"sensor_id\":\"" + jsonEscape(config.sensorId) + "\","
      "\"firmware_version\":\"" + jsonEscape(config.firmwareVersion) + "\","
      "\"battery_mv\":" + String(batteryMv) + ","
      "\"battery_pct\":" + String(batteryPct) + "}";

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + config.deviceToken);
  const int statusCode = http.POST(body);
  const String responseBody = http.getString();
  http.end();

  if (statusCode < 200 || statusCode >= 300) {
    return false;
  }

  const uint16_t nextInterval = static_cast<uint16_t>(extractJsonLong(responseBody, "next_upload_interval_minutes", config.uploadIntervalMinutes));
  preferences.putUShort("upload_min", nextInterval);
  config.uploadIntervalMinutes = nextInterval;
  return true;
}

void goToSleep(uint16_t minutes) {
  const uint16_t intervalMinutes = minutes > 0 ? minutes : kDefaultUploadIntervalMinutes;
  Serial.printf("Sover i %u minutter.\n", intervalMinutes);
  esp_sleep_enable_timer_wakeup(static_cast<uint64_t>(intervalMinutes) * kMicrosPerMinute);
  delay(100);
  esp_deep_sleep_start();
}

void performFactoryReset(const char* reason) {
  Serial.printf("Factory reset starter: %s\n", reason);
  clearStoredConfig();
  preferences.end();
  delay(200);
  ESP.restart();
}

void printStoredStatus() {
  Serial.println("Jordd setup-test firmware");
  Serial.printf("Device UID: %s\n", config.deviceUid.c_str());
  Serial.printf("Wi-Fi SSID lagret: %s\n", config.wifiSsid.isEmpty() ? "nei" : config.wifiSsid.c_str());
  Serial.printf("Claim code lagret: %s\n", config.claimCode.isEmpty() ? "nei" : "ja");
  Serial.printf("Claimed: %s\n", hasProvisioning() ? "ja" : "nei");
  Serial.printf("Sensor ID: %s\n", config.sensorId.isEmpty() ? "-" : config.sensorId.c_str());
  Serial.printf("API-base: %s\n", normalizeApiBase(config.apiBase).c_str());
  Serial.println("Serial-kommandoer de neste sekundene: status, reset, factory-reset");
}

void handleStartupResetWindow() {
  pinMode(kBootButtonPin, INPUT_PULLUP);
  printStoredStatus();

  const uint32_t startedAt = millis();
  uint32_t bootButtonPressedAt = 0;
  String commandBuffer;

  while (millis() - startedAt < kSerialCommandWindowMs) {
    if (digitalRead(kBootButtonPin) == LOW) {
      if (bootButtonPressedAt == 0) {
        bootButtonPressedAt = millis();
        Serial.println("BOOT hold oppdaget. Hold inne for factory reset.");
      }
      if (millis() - bootButtonPressedAt >= kBootButtonHoldMs) {
        performFactoryReset("BOOT-knapp holdt inne");
      }
    } else {
      bootButtonPressedAt = 0;
    }

    while (Serial.available() > 0) {
      const char next = static_cast<char>(Serial.read());
      if (next == '\r' || next == '\n') {
        commandBuffer.trim();
        if (commandBuffer.equalsIgnoreCase("reset") || commandBuffer.equalsIgnoreCase("factory-reset")) {
          performFactoryReset("serial kommando");
        } else if (commandBuffer.equalsIgnoreCase("status")) {
          printStoredStatus();
        }
        commandBuffer = "";
      } else {
        commandBuffer += next;
      }
    }
    delay(20);
  }
}

void handlePortalRoot() {
  String content =
      String(F("<section class='card'><p>Jordd Setup</p><h1>Koble enheten til Wi-Fi</h1><p>"
               "Dette er en test-firmware for onboarding. Fyll inn hjemmets Wi-Fi og claim code fra Jordd-appen."
               "</p><p>Velg gjerne nettverket ditt fra listen under, eller skriv inn SSID manuelt.</p>")) +
      renderWifiScanResults() +
      String(F("<div class='actions'><button class='ghost' type='button' onclick='location.href=\"/\"'>Søk på nytt</button></div>"
               "<form method='post' action='/configure'>"
               "<label>Wi-Fi navn (SSID)<input id='wifi_ssid' name='wifi_ssid' value='")) +
      htmlEscape(config.wifiSsid) +
      String(F("' required></label>"
               "<label>Wi-Fi passord<input name='wifi_password' type='password' required></label>"
               "<label>Claim code<input name='claim_code' value='")) +
      htmlEscape(config.claimCode) +
      String(F("' required></label>"
               "<details class='advanced'><summary>Avansert</summary>"
               "<label>Jordd API<input name='api_base' value='")) +
      htmlEscape(config.apiBase.isEmpty() ? normalizeApiBase(kDefaultApiBase) : config.apiBase) +
      String(F("'></label><p class='hint'>Trenger normalt ikke endres.</p></details>"
               "<button type='submit'>Koble til</button></form>"
               "<div class='actions' style='margin-top:16px'>"
               "<form method='post' action='/reset'><button class='ghost' type='submit'>Factory reset</button></form>"
               "</div></section>"));
  portalServer.send(200, "text/html", htmlPage("Jordd Setup", content));
}

void handlePortalReset() {
  portalServer.send(200, "text/html", htmlPage("Resetter", "<section class='card'><h1>Sletter lagret oppsett…</h1><p>Enheten restartes nå og kommer opp igjen i setup-modus.</p></section>"));
  delay(300);
  performFactoryReset("portal reset");
}

void handlePortalConfigure() {
  const String wifiSsid = portalServer.arg("wifi_ssid");
  const String wifiPassword = portalServer.arg("wifi_password");
  const String claimCode = portalServer.arg("claim_code");
  String apiBase = portalServer.arg("api_base");
  if (apiBase.isEmpty()) {
    apiBase = kDefaultApiBase;
  }

  if (wifiSsid.isEmpty() || wifiPassword.isEmpty() || claimCode.isEmpty()) {
    portalServer.send(400, "text/html", htmlPage("Feil", "<section class='card'><h1>Mangler felter</h1><p>Alle feltene må fylles ut.</p></section>"));
    return;
  }

  saveProvisioning(wifiSsid, wifiPassword, claimCode, apiBase);

  if (!connectToWifi(wifiSsid, wifiPassword, kWifiConnectTimeoutMs)) {
    portalServer.send(500, "text/html", htmlPage("Wi-Fi-feil", "<section class='card'><h1>Kunne ikke koble til Wi-Fi</h1><p>Sjekk passordet og prøv igjen.</p></section>"));
    return;
  }

  String errorMessage;
  if (!claimDevice(&errorMessage)) {
    portalServer.send(500, "text/html", htmlPage("Claim-feil", String(F("<section class='card'><h1>Claim feilet</h1><p>")) + errorMessage + String(F("</p></section>"))));
    return;
  }

  portalServer.send(200, "text/html", htmlPage("Klar", "<section class='card'><h1>Enheten er koblet til</h1><p>Bytt tilbake til internett og oppdater Jordd-appen for å se enheten på dashboardet.</p></section>"));
  delay(1500);
  ESP.restart();
}

void startCaptivePortal() {
  Serial.printf("Starter setup-Wi-Fi: %s / %s\n", defaultSetupSsid().c_str(), kApPassword);
  WiFi.mode(WIFI_AP_STA);
  WiFi.softAP(defaultSetupSsid().c_str(), kApPassword);
  dnsServer.start(kDnsPort, "*", WiFi.softAPIP());

  portalServer.on("/", HTTP_GET, handlePortalRoot);
  portalServer.on("/configure", HTTP_POST, handlePortalConfigure);
  portalServer.on("/reset", HTTP_POST, handlePortalReset);
  portalServer.onNotFound(handlePortalRoot);
  portalServer.begin();

  for (;;) {
    dnsServer.processNextRequest();
    portalServer.handleClient();
    delay(2);
  }
}

void setup() {
  Serial.begin(115200);
  delay(200);

  preferences.begin(kPrefsNamespace, false);
  loadConfig();
  handleStartupResetWindow();
  loadConfig();

  if (!hasProvisioning()) {
    startCaptivePortal();
  }

  if (!connectToWifi(config.wifiSsid, config.wifiPassword, kWifiConnectTimeoutMs)) {
    startCaptivePortal();
  }

  const uint16_t batteryMv = readBatteryMillivolts();
  const uint8_t batteryPct = batteryPercentFromMillivolts(batteryMv);

  bool uploaded = uploadHeartbeat(batteryMv, batteryPct);
  if (!uploaded) {
    delay(kRetryDelayMs);
    uploaded = uploadHeartbeat(batteryMv, batteryPct);
  }

  if (!uploaded) {
    Serial.println("Upload feilet. Går i sleep til neste syklus.");
  }

  goToSleep(config.uploadIntervalMinutes);
}

void loop() {
}
