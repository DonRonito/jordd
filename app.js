const API_BASE = "/api";
const HISTORY_RANGE_OPTIONS = ["24h", "7d", "30d"];

const state = {
  installPromptEvent: null,
  config: null,
  configLoading: true,
  bootstrapLoading: true,
  savingConfig: false,
  statusLoading: false,
  devicesLoading: false,
  permitJoinBusy: false,
  renameBusy: false,
  homekitBusy: false,
  historyLoading: false,
  systemStatus: null,
  devices: [],
  selectedDeviceId: "",
  historyRange: "24h",
  history: null,
  message: "",
  messageKind: "info",
  pollTimer: null,
};

const elements = {
  pageTitle: document.querySelector("#pageTitle"),
  installButton: document.querySelector("#installButton"),
  settingsButton: document.querySelector("#settingsButton"),
  appMessage: document.querySelector("#appMessage"),
  onboardingView: document.querySelector("#onboardingView"),
  dashboardView: document.querySelector("#dashboardView"),
  deviceView: document.querySelector("#deviceView"),
  settingsView: document.querySelector("#settingsView"),
};

init();

async function init() {
  registerServiceWorker();
  bindGlobalEvents();
  await bootstrap();
}

function bindGlobalEvents() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    state.installPromptEvent = event;
    render();
  });

  window.addEventListener("appinstalled", () => {
    state.installPromptEvent = null;
    render();
  });

  window.addEventListener("hashchange", async () => {
    syncSelectedDeviceFromRoute();
    render();
    if (getRoute().kind === "device") {
      await loadHistoryForSelectedDevice();
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPolling();
      return;
    }

    if (state.config?.configured) {
      startPolling();
    }
  });

  elements.settingsButton.addEventListener("click", () => {
    if (location.hash === "#settings") {
      navigateTo("");
      return;
    }

    navigateTo("#settings");
  });
}

async function bootstrap() {
  state.bootstrapLoading = true;
  state.configLoading = true;
  render();

  try {
    state.config = await apiGet("/config");
    syncSelectedDeviceFromRoute();

    if (state.config.configured) {
      await Promise.all([loadStatus(), loadDevices()]);
      if (getRoute().kind === "device") {
        await loadHistoryForSelectedDevice();
      }
      startPolling();
    } else {
      stopPolling();
    }
  } catch (error) {
    setMessage(getErrorMessage(error), "error");
  } finally {
    state.configLoading = false;
    state.bootstrapLoading = false;
    render();
  }
}

function render() {
  renderHeaderButtons();
  renderGlobalMessage();

  const route = getRoute();
  const isConfigured = Boolean(state.config?.configured);

  elements.onboardingView.hidden = true;
  elements.dashboardView.hidden = true;
  elements.deviceView.hidden = true;
  elements.settingsView.hidden = true;

  if (state.configLoading || state.bootstrapLoading) {
    elements.pageTitle.textContent = "Starter Jordd";
    elements.onboardingView.hidden = false;
    elements.onboardingView.innerHTML = `
      <section class="stack">
        <div class="hero-card">
          <p class="eyebrow">Starter</p>
          <h2>Laster lokal gateway…</h2>
          <p class="muted">Jordd leser lokal konfigurasjon og forbereder Zigbee-oversikten.</p>
        </div>
      </section>
    `;
    return;
  }

  if (!isConfigured) {
    elements.pageTitle.textContent = "Onboarding";
    elements.onboardingView.hidden = false;
    renderOnboardingView();
    return;
  }

  if (route.kind === "settings") {
    elements.pageTitle.textContent = "Innstillinger";
    elements.settingsView.hidden = false;
    renderSettingsView();
    return;
  }

  if (route.kind === "device" && getSelectedDevice()) {
    elements.pageTitle.textContent = getSelectedDevice().friendlyName;
    elements.deviceView.hidden = false;
    renderDeviceView();
    return;
  }

  elements.pageTitle.textContent = "Enheter";
  elements.dashboardView.hidden = false;
  renderDashboardView();
}

function renderHeaderButtons() {
  elements.installButton.hidden = !state.installPromptEvent || isStandalone();
  elements.installButton.onclick = state.installPromptEvent ? triggerInstallPrompt : null;
}

function renderGlobalMessage() {
  if (!state.message) {
    elements.appMessage.hidden = true;
    elements.appMessage.textContent = "";
    elements.appMessage.className = "inline-feedback global-message";
    return;
  }

  elements.appMessage.hidden = false;
  elements.appMessage.textContent = state.message;
  elements.appMessage.className = `inline-feedback global-message ${state.messageKind}`;
}

function renderOnboardingView() {
  const config = state.config || {};
  const instructions = getInstallInstructions();

  elements.onboardingView.innerHTML = `
    <section class="stack">
      <div class="hero-card">
        <p class="eyebrow">Lokal App</p>
        <h2>Koble Jordd til Home Assistant og Zigbee2MQTT</h2>
        <p class="muted">${escapeHtml(instructions.lead)}</p>
        <div class="button-row">
          ${state.installPromptEvent ? '<button id="promptInstallButton" class="primary-button" type="button">Installer nå</button>' : ""}
          <button id="skipInstallButton" class="ghost-button" type="button">Fortsett uten installasjon</button>
        </div>
      </div>

      <div class="grid two-up">
        <article class="card">
          <p class="eyebrow">Installering</p>
          <h3>PWA først, gateway etterpå</h3>
          <ol class="steps">
            ${instructions.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}
          </ol>
        </article>

        <article class="card">
          <p class="eyebrow">V1 Stack</p>
          <h3>Forventet lokal oppsett</h3>
          <ul class="helper-list">
            <li>Home Assistant med long-lived access token</li>
            <li>Zigbee2MQTT koblet til lokal MQTT-broker</li>
            <li>Jordd gateway kjører på samme lokale origin som PWA-en</li>
            <li>HomeKit Bridge valgfritt via Home Assistant service-hook</li>
          </ul>
        </article>
      </div>

      <article class="card">
        <p class="eyebrow">Gateway Setup</p>
        <h3>Legg inn lokal stack én gang</h3>
        <form id="onboardingForm" class="stack">
          ${renderGatewayFields(config, { onboarding: true })}
          <div class="button-row">
            <button class="primary-button" type="submit">${state.savingConfig ? "Lagrer…" : "Lagre og koble til"}</button>
          </div>
        </form>
      </article>
    </section>
  `;

  const promptInstallButton = elements.onboardingView.querySelector("#promptInstallButton");
  const skipInstallButton = elements.onboardingView.querySelector("#skipInstallButton");
  const onboardingForm = elements.onboardingView.querySelector("#onboardingForm");

  if (promptInstallButton) {
    promptInstallButton.addEventListener("click", triggerInstallPrompt);
  }

  skipInstallButton.addEventListener("click", () => {
    setMessage("Du kan installere appen senere fra nettleseren.", "info");
    render();
  });

  onboardingForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitConfigForm(onboardingForm, { reload: true });
  });
}

function renderDashboardView() {
  const status = state.systemStatus || {};

  elements.dashboardView.innerHTML = `
    <section class="stack">
      <div class="hero-card">
        <p class="eyebrow">Oversikt</p>
        <h2>Zigbee-enheter, historikk og HomeKit</h2>
        <p class="muted">
          Jordd samler Zigbee2MQTT og Home Assistant på ett sted. Bruk permit join for å legge til nye enheter,
          åpne en enhet for historikk, og velg om den skal deles videre til HomeKit.
        </p>
        <div class="button-row">
          <button id="permitJoinButton" class="primary-button" type="button">
            ${state.permitJoinBusy ? "Åpner pairing…" : "Legg til Zigbee-enhet"}
          </button>
          <button id="refreshButton" class="secondary-button" type="button">
            ${state.devicesLoading || state.statusLoading ? "Oppdaterer…" : "Oppdater nå"}
          </button>
        </div>
      </div>

      <section class="status-grid">
        ${renderStatusCard("Home Assistant", status.homeAssistant)}
        ${renderStatusCard("MQTT", status.mqtt)}
        ${renderStatusCard("Zigbee2MQTT", status.zigbee2mqtt)}
        ${renderStatusCard("HomeKit", status.homekit)}
      </section>

      <article class="card">
        <div class="split-head">
          <div>
            <p class="eyebrow">Enheter</p>
            <h3>${state.devices.length} registrerte Zigbee-enheter</h3>
          </div>
          <span class="muted">${state.devicesLoading ? "Laster…" : "Oppdatert fra lokal gateway"}</span>
        </div>
        <div class="device-grid">
          ${state.devices.length ? state.devices.map(renderDeviceCard).join("") : '<p class="muted">Fant ingen Zigbee-enheter ennå. Start permit join for å legge til en ny.</p>'}
        </div>
      </article>
    </section>
  `;

  elements.dashboardView.querySelector("#permitJoinButton").addEventListener("click", handlePermitJoin);
  elements.dashboardView.querySelector("#refreshButton").addEventListener("click", async () => {
    await Promise.all([loadStatus(true), loadDevices(true)]);
  });

  for (const button of elements.dashboardView.querySelectorAll("[data-device-open]")) {
    button.addEventListener("click", () => {
      navigateTo(`#device/${encodeURIComponent(button.dataset.deviceOpen)}`);
    });
  }
}

function renderDeviceView() {
  const device = getSelectedDevice();
  if (!device) {
    navigateTo("");
    return;
  }

  const history = state.history;
  const historyMarkup = history?.series?.length
    ? history.series.map(renderHistoryCard).join("")
    : '<p class="muted">Ingen historiske serier tilgjengelig for denne enheten ennå.</p>';

  elements.deviceView.innerHTML = `
    <section class="stack">
      <div class="hero-card">
        <div class="split-head">
          <div>
            <p class="eyebrow">Enhet</p>
            <h2>${escapeHtml(device.friendlyName)}</h2>
          </div>
          <button id="backToDevicesButton" class="secondary-button" type="button">Tilbake til oversikt</button>
        </div>
        <p class="muted">${escapeHtml(device.vendorModel)}</p>
        <div class="pill-row">
          ${renderPill(device.availabilityLabel, device.availability === "online" ? "ok" : "warn")}
          ${renderPill(device.interviewLabel, device.interviewing ? "warn" : "ok")}
          ${renderPill(device.powerSource || "Ukjent strømkilde", "neutral")}
          ${renderPill(device.homekit.supported ? "HomeKit-støttet" : "Ikke HomeKit-støttet", device.homekit.supported ? "ok" : "neutral")}
        </div>
      </div>

      <div class="grid two-up">
        <article class="card">
          <p class="eyebrow">Detaljer</p>
          <h3>Status og mål</h3>
          <dl class="meta-list">
            <div><dt>ID</dt><dd>${escapeHtml(device.id)}</dd></div>
            <div><dt>IEEE</dt><dd>${escapeHtml(device.ieeeAddress || "Ukjent")}</dd></div>
            <div><dt>Batteri</dt><dd>${escapeHtml(device.batteryLabel)}</dd></div>
            <div><dt>Rom</dt><dd>${escapeHtml(device.area || "Ikke satt")}</dd></div>
          </dl>
        </article>

        <article class="card">
          <p class="eyebrow">Handlinger</p>
          <h3>Rename og HomeKit</h3>
          <form id="renameForm" class="stack compact-stack">
            <label class="field">
              <span>Visningsnavn</span>
              <input name="friendlyName" type="text" value="${escapeAttribute(device.friendlyName)}" required />
            </label>
            <div class="button-row">
              <button class="secondary-button" type="submit">${state.renameBusy ? "Lagrer…" : "Lagre navn"}</button>
            </div>
          </form>
          <div class="inline-toggle">
            <div>
              <strong>Del til HomeKit</strong>
              <p class="muted">${escapeHtml(device.homekit.message)}</p>
            </div>
            <button id="homekitToggleButton" class="${device.homekit.shared ? "primary-button" : "secondary-button"}" type="button" ${device.homekit.supported ? "" : "disabled"}>
              ${state.homekitBusy ? "Oppdaterer…" : device.homekit.shared ? "Delt" : "Ikke delt"}
            </button>
          </div>
        </article>
      </div>

      <article class="card">
        <div class="split-head">
          <div>
            <p class="eyebrow">Historikk</p>
            <h3>Sensorserier fra Home Assistant Recorder</h3>
          </div>
          <label class="range-picker">
            <span>Periode</span>
            <select id="historyRangeSelect">
              ${HISTORY_RANGE_OPTIONS.map((option) => `<option value="${option}" ${option === state.historyRange ? "selected" : ""}>${option}</option>`).join("")}
            </select>
          </label>
        </div>
        ${state.historyLoading ? '<p class="muted">Laster historikk…</p>' : historyMarkup}
      </article>

      <article class="card">
        <p class="eyebrow">Entities</p>
        <h3>Relevante Home Assistant-entities</h3>
        <div class="entity-list">
          ${device.entities.length ? device.entities.map(renderEntityRow).join("") : '<p class="muted">Ingen relevante entities ble matchet for denne enheten.</p>'}
        </div>
      </article>
    </section>
  `;

  elements.deviceView.querySelector("#backToDevicesButton").addEventListener("click", () => navigateTo(""));
  elements.deviceView.querySelector("#renameForm").addEventListener("submit", handleRename);
  elements.deviceView.querySelector("#homekitToggleButton").addEventListener("click", handleHomeKitToggle);
  elements.deviceView.querySelector("#historyRangeSelect").addEventListener("change", async (event) => {
    state.historyRange = event.target.value;
    await loadHistoryForSelectedDevice();
  });
}

function renderSettingsView() {
  const config = state.config || {};

  elements.settingsView.innerHTML = `
    <section class="stack">
      <div class="hero-card">
        <p class="eyebrow">Innstillinger</p>
        <h2>Lokal gateway-konfigurasjon</h2>
        <p class="muted">
          Jordd holder tokens og MQTT-detaljer på gatewayen. Frontenden får bare status og normaliserte enhetsdata tilbake.
        </p>
      </div>

      <article class="card">
        <form id="settingsForm" class="stack">
          ${renderGatewayFields(config, { onboarding: false })}
          <div class="button-row">
            <button class="primary-button" type="submit">${state.savingConfig ? "Lagrer…" : "Lagre gateway-oppsett"}</button>
            <button id="backFromSettingsButton" class="secondary-button" type="button">Tilbake</button>
          </div>
        </form>
      </article>
    </section>
  `;

  elements.settingsView.querySelector("#settingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitConfigForm(event.currentTarget, { reload: true });
  });
  elements.settingsView.querySelector("#backFromSettingsButton").addEventListener("click", () => navigateTo(""));
}

function renderGatewayFields(config, options) {
  const onboardingCopy = options.onboarding
    ? "Fyll inn det lokale oppsettet ditt. Tomme passord/token-felt blir lagret som nye verdier første gang."
    : "La token- og passordfeltene stå tomme hvis du vil beholde de som allerede er lagret på gatewayen.";

  return `
    <p class="muted">${escapeHtml(onboardingCopy)}</p>
    <div class="field-grid">
      <label class="field">
        <span>Home Assistant URL</span>
        <input name="haUrl" type="text" value="${escapeAttribute(config.haUrl || "")}" placeholder="http://homeassistant.local:8123" required />
      </label>
      <label class="field">
        <span>Home Assistant token ${config.hasHaToken ? "(lagret)" : ""}</span>
        <input name="haToken" type="password" value="" placeholder="${config.hasHaToken ? "La stå tomt for å beholde" : "Long-lived access token"}" ${options.onboarding && !config.hasHaToken ? "required" : ""} />
      </label>
      <label class="field">
        <span>MQTT host</span>
        <input name="mqttHost" type="text" value="${escapeAttribute(config.mqttHost || "")}" placeholder="localhost" required />
      </label>
      <label class="field">
        <span>MQTT port</span>
        <input name="mqttPort" type="number" min="1" max="65535" value="${escapeAttribute(String(config.mqttPort || 1883))}" required />
      </label>
      <label class="field">
        <span>MQTT bruker</span>
        <input name="mqttUser" type="text" value="${escapeAttribute(config.mqttUser || "")}" placeholder="Valgfritt" />
      </label>
      <label class="field">
        <span>MQTT passord ${config.hasMqttPassword ? "(lagret)" : ""}</span>
        <input name="mqttPassword" type="password" value="" placeholder="${config.hasMqttPassword ? "La stå tomt for å beholde" : "Valgfritt"}" />
      </label>
      <label class="field">
        <span>Zigbee2MQTT topic prefix</span>
        <input name="mqttTopicPrefix" type="text" value="${escapeAttribute(config.mqttTopicPrefix || "zigbee2mqtt")}" placeholder="zigbee2mqtt" required />
      </label>
      <label class="field">
        <span>HomeKit sync service</span>
        <input name="homekitSyncService" type="text" value="${escapeAttribute(config.homekitSyncService || "")}" placeholder="script.jordd_sync_homekit (valgfritt)" />
      </label>
    </div>
  `;
}

function renderStatusCard(title, status) {
  const healthy = Boolean(status?.ok);
  return `
    <article class="status-card ${healthy ? "ok" : "warn"}">
      <p class="eyebrow">${escapeHtml(title)}</p>
      <strong>${healthy ? "Klar" : "Problem"}</strong>
      <p class="muted">${escapeHtml(status?.message || "Ingen status ennå")}</p>
    </article>
  `;
}

function renderDeviceCard(device) {
  return `
    <button class="device-card" type="button" data-device-open="${escapeAttribute(device.id)}">
      <div class="split-head">
        <div>
          <strong>${escapeHtml(device.friendlyName)}</strong>
          <p class="muted">${escapeHtml(device.vendorModel)}</p>
        </div>
        <span class="availability ${escapeAttribute(device.availability)}">${escapeHtml(device.availabilityLabel)}</span>
      </div>
      <div class="pill-row compact-row">
        ${renderPill(device.batteryLabel, "neutral")}
        ${renderPill(device.powerSource || "Ukjent strøm", "neutral")}
        ${renderPill(device.homekit.shared ? "Delt til HomeKit" : "Ikke delt", device.homekit.shared ? "ok" : "neutral")}
      </div>
      <p class="muted">${escapeHtml(device.summary)}</p>
    </button>
  `;
}

function renderPill(label, tone) {
  return `<span class="pill ${tone}">${escapeHtml(label)}</span>`;
}

function renderHistoryCard(series) {
  return `
    <article class="history-card">
      <div class="split-head">
        <div>
          <strong>${escapeHtml(series.name)}</strong>
          <p class="muted">${escapeHtml(series.entityId)}</p>
        </div>
        <span class="muted">${escapeHtml(series.latestLabel)}</span>
      </div>
      ${renderSparkline(series.points, series.unit)}
    </article>
  `;
}

function renderSparkline(points, unit) {
  if (!points.length) {
    return '<p class="muted">Ingen punkter i valgt periode.</p>';
  }

  const width = 520;
  const height = 140;
  const padding = 16;
  const values = points.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const path = points
    .map((point, index) => {
      const x = padding + (index / Math.max(points.length - 1, 1)) * (width - padding * 2);
      const y = height - padding - ((point.value - min) / span) * (height - padding * 2);
      return `${index === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  return `
    <div class="chart-wrap">
      <svg viewBox="0 0 ${width} ${height}" class="sparkline" role="img" aria-label="Historikk for ${escapeAttribute(unit || "verdi")}">
        <path d="${path}" />
      </svg>
      <div class="chart-scale">
        <span>${escapeHtml(formatNumber(max, unit))}</span>
        <span>${escapeHtml(formatNumber(min, unit))}</span>
      </div>
    </div>
  `;
}

function renderEntityRow(entity) {
  return `
    <div class="entity-row">
      <strong>${escapeHtml(entity.name)}</strong>
      <code>${escapeHtml(entity.entityId)}</code>
      <span class="muted">${escapeHtml(entity.stateLabel)}</span>
    </div>
  `;
}

async function submitConfigForm(form, options = {}) {
  const formData = new FormData(form);
  const payload = {
    haUrl: normalizeUrl(formData.get("haUrl")),
    haToken: String(formData.get("haToken") || "").trim(),
    mqttHost: String(formData.get("mqttHost") || "").trim(),
    mqttPort: Number(formData.get("mqttPort") || 1883),
    mqttUser: String(formData.get("mqttUser") || "").trim(),
    mqttPassword: String(formData.get("mqttPassword") || ""),
    mqttTopicPrefix: String(formData.get("mqttTopicPrefix") || "").trim(),
    homekitSyncService: String(formData.get("homekitSyncService") || "").trim(),
  };

  if (!payload.haUrl || !payload.mqttHost || !payload.mqttTopicPrefix || !payload.mqttPort) {
    setMessage("Fyll inn Home Assistant URL, MQTT host, port og Zigbee2MQTT topic prefix.", "error");
    render();
    return;
  }

  state.savingConfig = true;
  render();

  try {
    state.config = await apiPost("/config", payload);
    setMessage("Gateway-konfigurasjon lagret.", "success");
    if (options.reload) {
      await bootstrap();
      navigateTo("");
    }
  } catch (error) {
    setMessage(getErrorMessage(error), "error");
  } finally {
    state.savingConfig = false;
    render();
  }
}

async function loadStatus(forceMessage = false) {
  state.statusLoading = true;
  render();

  try {
    state.systemStatus = await apiGet("/system/status");
    if (forceMessage) {
      setMessage("Systemstatus oppdatert.", "success");
    }
  } catch (error) {
    setMessage(getErrorMessage(error), "error");
  } finally {
    state.statusLoading = false;
    render();
  }
}

async function loadDevices(forceMessage = false) {
  state.devicesLoading = true;
  render();

  try {
    const response = await apiGet("/devices");
    state.devices = response.items || [];
    syncSelectedDeviceFromRoute();
    if (forceMessage) {
      setMessage("Enhetslisten er oppdatert.", "success");
    }
  } catch (error) {
    setMessage(getErrorMessage(error), "error");
  } finally {
    state.devicesLoading = false;
    render();
  }
}

async function loadHistoryForSelectedDevice() {
  const device = getSelectedDevice();
  if (!device) {
    state.history = null;
    render();
    return;
  }

  state.historyLoading = true;
  render();

  try {
    state.history = await apiGet(`/devices/${encodeURIComponent(device.id)}/history?range=${encodeURIComponent(state.historyRange)}`);
  } catch (error) {
    state.history = null;
    setMessage(getErrorMessage(error), "error");
  } finally {
    state.historyLoading = false;
    render();
  }
}

async function handlePermitJoin() {
  state.permitJoinBusy = true;
  render();

  try {
    const response = await apiPost("/zigbee/permit-join", { seconds: 254 });
    setMessage(response.message || "Permit join aktivert.", "success");
    await Promise.all([loadStatus(), loadDevices()]);
  } catch (error) {
    setMessage(getErrorMessage(error), "error");
  } finally {
    state.permitJoinBusy = false;
    render();
  }
}

async function handleRename(event) {
  event.preventDefault();
  const device = getSelectedDevice();
  if (!device) {
    return;
  }

  const formData = new FormData(event.currentTarget);
  const nextName = String(formData.get("friendlyName") || "").trim();
  if (!nextName) {
    setMessage("Skriv inn et nytt navn for enheten.", "error");
    render();
    return;
  }

  state.renameBusy = true;
  render();

  try {
    const response = await apiPost(`/devices/${encodeURIComponent(device.id)}/rename`, { name: nextName });
    setMessage(response.message || "Navn oppdatert.", "success");
    await Promise.all([loadDevices(), loadStatus()]);
    navigateTo(`#device/${encodeURIComponent(response.deviceId || nextName)}`);
  } catch (error) {
    setMessage(getErrorMessage(error), "error");
  } finally {
    state.renameBusy = false;
    render();
  }
}

async function handleHomeKitToggle() {
  const device = getSelectedDevice();
  if (!device || !device.homekit.supported) {
    return;
  }

  state.homekitBusy = true;
  render();

  try {
    const response = await apiPost(`/devices/${encodeURIComponent(device.id)}/homekit`, {
      enabled: !device.homekit.shared,
    });
    setMessage(response.message || "HomeKit-status oppdatert.", response.synced === false ? "warn" : "success");
    await loadDevices();
    if (getRoute().kind === "device") {
      await loadHistoryForSelectedDevice();
    }
  } catch (error) {
    setMessage(getErrorMessage(error), "error");
  } finally {
    state.homekitBusy = false;
    render();
  }
}

function startPolling() {
  stopPolling();
  state.pollTimer = window.setInterval(async () => {
    if (document.hidden) {
      return;
    }

    await Promise.all([loadStatus(), loadDevices()]);
    if (getRoute().kind === "device") {
      await loadHistoryForSelectedDevice();
    }
  }, 15000);
}

function stopPolling() {
  if (state.pollTimer) {
    window.clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function syncSelectedDeviceFromRoute() {
  const route = getRoute();
  if (route.kind === "device") {
    state.selectedDeviceId = route.id;
    return;
  }

  state.selectedDeviceId = "";
}

function getSelectedDevice() {
  return state.devices.find((device) => device.id === state.selectedDeviceId) || null;
}

function getRoute() {
  const hash = location.hash || "";
  if (hash === "#settings") {
    return { kind: "settings" };
  }

  if (hash.startsWith("#device/")) {
    return { kind: "device", id: decodeURIComponent(hash.slice("#device/".length)) };
  }

  return { kind: "dashboard" };
}

function navigateTo(hash) {
  if (hash) {
    location.hash = hash;
    return;
  }

  history.replaceState(null, "", `${location.pathname}${location.search}`);
  syncSelectedDeviceFromRoute();
  render();
}

function setMessage(message, kind = "info") {
  state.message = message;
  state.messageKind = kind;
}

async function apiGet(path) {
  return apiRequest(path, { method: "GET" });
}

async function apiPost(path, body) {
  return apiRequest(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function apiRequest(path, options) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
    cache: "no-store",
  });

  const data = await safeJson(response);
  if (!response.ok) {
    const error = new Error(data?.error || `Request failed with ${response.status}`);
    error.payload = data;
    throw error;
  }

  return data;
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function triggerInstallPrompt() {
  if (!state.installPromptEvent) {
    return;
  }

  const promptEvent = state.installPromptEvent;
  await promptEvent.prompt();
  await promptEvent.userChoice;
  state.installPromptEvent = null;
  render();
}

function getInstallInstructions() {
  const userAgent = navigator.userAgent.toLowerCase();

  if (/iphone|ipad|ipod/.test(userAgent)) {
    return {
      lead: "Åpne den lokale Jordd-adressen i Safari, og legg appen til på Hjem-skjermen før du kobler den til gatewayen.",
      steps: [
        "Åpne Jordd på lokal adresse i Safari.",
        "Velg «Legg til på Hjem-skjerm».",
        "Fyll inn Home Assistant-, MQTT- og Zigbee2MQTT-innstillingene.",
      ],
    };
  }

  if (/android/.test(userAgent)) {
    return {
      lead: state.installPromptEvent
        ? "Trykk på installeringsknappen for å lagre Jordd lokalt som app."
        : "Installer Jordd fra Chrome eller Edge på den lokale gateway-adressen.",
      steps: [
        "Åpne Jordd på lokal adresse i Chrome eller Edge.",
        "Installer appen fra nettleseren.",
        "Koble deretter appen til Home Assistant og Zigbee2MQTT.",
      ],
    };
  }

  return {
    lead: state.installPromptEvent
      ? "Trykk på installeringsknappen for å lagre Jordd som skrivebordsapp."
      : "Installer Jordd fra lokal gateway-adresse i Chrome eller Edge.",
    steps: [
      "Åpne lokal Jordd-adresse i Chrome eller Edge.",
      "Installer appen fra adressefeltet.",
      "Bruk onboarding til å koble appen til Home Assistant og Zigbee2MQTT.",
    ],
  };
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function normalizeUrl(value) {
  const rawValue = typeof value === "string" ? value.trim() : "";
  if (!rawValue) {
    return "";
  }

  const candidate = rawValue.match(/^https?:\/\//i) ? rawValue : `http://${rawValue}`;
  try {
    return new URL(candidate).toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function formatNumber(value, unit = "") {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "Ingen data";
  }

  return `${value.toFixed(Math.abs(value) >= 10 ? 0 : 1)}${unit ? ` ${unit}` : ""}`;
}

function getErrorMessage(error) {
  if (error?.payload?.error) {
    return error.payload.error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Noe gikk galt.";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  try {
    await navigator.serviceWorker.register("/sw.js");
  } catch (error) {
    console.warn("Kunne ikke registrere service worker", error);
  }
}
