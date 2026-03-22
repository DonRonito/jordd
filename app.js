const API_BASE = "/api";

const state = {
  installPromptEvent: null,
  sessionLoading: true,
  authBusy: false,
  session: null,
  dashboardLoading: false,
  dashboard: null,
  accountLoading: false,
  account: null,
  accountSaving: false,
  passwordSaving: false,
  claimCodeBusy: false,
  pollTimer: null,
  message: "",
  messageKind: "info",
  authMode: "login",
};

const elements = {
  pageTitle: document.querySelector("#pageTitle"),
  installButton: document.querySelector("#installButton"),
  primaryNav: document.querySelector("#primaryNav"),
  topbarActions: document.querySelector(".topbar-actions"),
  appMessage: document.querySelector("#appMessage"),
  appView: document.querySelector("#appView"),
};

init();

async function init() {
  registerServiceWorker();
  bindEvents();
  await bootstrap();
}

function bindEvents() {
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
    render();
    await loadRouteData({ silent: true });
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopPolling();
      return;
    }
    syncPolling();
  });

  elements.primaryNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-route]");
    if (!button) {
      return;
    }
    navigateTo(button.dataset.route);
  });
}

async function bootstrap() {
  state.sessionLoading = true;
  render();

  try {
    const response = await apiGet("/auth/session");
    state.session = response.user || null;
    if (state.session) {
      if (!location.hash) {
        navigateTo("dashboard", { replace: true });
      }
      await loadRouteData({ silent: true });
    }
  } catch (error) {
    setMessage(getErrorMessage(error), "error");
  } finally {
    state.sessionLoading = false;
    syncPolling();
    render();
  }
}

function getRoute() {
  const hash = location.hash.replace(/^#/, "");
  if (!hash) {
    return state.session ? "dashboard" : "landing";
  }
  if (["dashboard", "add-sensor", "account"].includes(hash)) {
    return hash;
  }
  return state.session ? "dashboard" : "landing";
}

function navigateTo(route, options = {}) {
  const nextHash = route ? `#${route}` : "";
  if (options.replace) {
    history.replaceState(null, "", `${location.pathname}${location.search}${nextHash}`);
  } else {
    location.hash = nextHash;
  }
  render();
  syncPolling();
}

async function loadRouteData(options = {}) {
  if (!state.session) {
    return;
  }

  const route = getRoute();
  if (route === "dashboard" || route === "add-sensor") {
    await loadDashboard(options);
  }
  if (route === "account") {
    await loadAccount(options);
  }
}

function syncPolling() {
  stopPolling();
  if (!state.session || document.hidden) {
    return;
  }
  if (!["dashboard", "add-sensor"].includes(getRoute())) {
    return;
  }

  state.pollTimer = window.setInterval(async () => {
    await loadDashboard({ silent: true });
  }, 15000);
}

function stopPolling() {
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
}

function render() {
  renderHeader();
  renderMessage();

  if (state.sessionLoading) {
    elements.pageTitle.textContent = "Starter Jordd";
    elements.appView.innerHTML = `
      <section class="stack">
        <div class="hero-card">
          <p class="eyebrow">Starter</p>
          <h2>Laster skyplattformen…</h2>
          <p class="muted">Jordd gjør klart konto, sensorer og onboardingflyt.</p>
        </div>
      </section>
    `;
    return;
  }

  if (!state.session) {
    elements.pageTitle.textContent = "ESP32-sensorer direkte til jordd.com";
    renderLanding();
    return;
  }

  const route = getRoute();
  if (route === "account") {
    elements.pageTitle.textContent = "Konto";
    renderAccount();
    return;
  }

  if (route === "add-sensor") {
    elements.pageTitle.textContent = "Legg til sensor";
    renderAddSensor();
    return;
  }

  elements.pageTitle.textContent = "Sensorer";
  renderDashboard();
}

function renderHeader() {
  const authenticated = Boolean(state.session);
  const showInstallButton = Boolean(state.installPromptEvent) && !isStandalone();

  elements.topbarActions.hidden = !authenticated && !showInstallButton;
  elements.installButton.hidden = !showInstallButton;
  elements.installButton.onclick = state.installPromptEvent ? triggerInstallPrompt : null;

  if (authenticated) {
    const currentRoute = getRoute();
    elements.primaryNav.hidden = false;
    elements.primaryNav.innerHTML = `
      <button data-route="dashboard" class="ghost-button" data-active="${String(currentRoute === "dashboard")}" type="button">Sensorer</button>
      <button data-route="add-sensor" class="ghost-button" data-active="${String(currentRoute === "add-sensor")}" type="button">Legg til</button>
      <button data-route="account" class="ghost-button" data-active="${String(currentRoute === "account")}" type="button">Konto</button>
    `;
  } else {
    elements.primaryNav.hidden = true;
    elements.primaryNav.innerHTML = "";
  }
}

function renderMessage() {
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

function renderLanding() {
  const install = getInstallInstructions();
  const loginActive = state.authMode === "login";

  elements.appView.innerHTML = `
    <section class="stack">
      <div class="hero-card compact-stack">
        <p class="eyebrow">Kom I Gang</p>
        <h2>Logg inn og legg til ESP32-sensorer med claim code</h2>
        <p class="muted">
          Jordd kobler batteridrevne sensorer direkte til kontoen din. Sensoren settes opp via sitt eget Wi-Fi,
          får hjemmenett og claim code, og sender deretter målinger til jordd.com.
        </p>
        <ul class="helper-list">
          <li>Opprett konto eller logg inn.</li>
          <li>Generer claim code i appen.</li>
          <li>Koble telefonen til sensorens setup-Wi-Fi og fyll inn kode + Wi-Fi-passord.</li>
        </ul>
        <p class="muted"><strong>Demo:</strong> brukernavn <code>test</code> og passord <code>test</code>.</p>
        <p class="muted">${escapeHtml(install.lead)}</p>
        <div class="button-row">
          ${state.installPromptEvent ? '<button id="landingInstallButton" class="primary-button" type="button">Installer PWA</button>' : ""}
          <button id="showRegisterButton" class="secondary-button" type="button">Opprett konto</button>
        </div>
      </div>

      <section class="auth-shell">
        <article class="card">
          <div class="split-head">
            <div>
              <p class="eyebrow">Autentisering</p>
              <h3>${loginActive ? "Logg inn" : "Opprett konto"}</h3>
            </div>
            <div class="tab-row">
              <button id="loginTabButton" class="${loginActive ? "tab-button active" : "tab-button"}" type="button">Login</button>
              <button id="registerTabButton" class="${!loginActive ? "tab-button active" : "tab-button"}" type="button">Register</button>
            </div>
          </div>

          <form id="${loginActive ? "loginForm" : "registerForm"}" class="stack">
            ${loginActive ? renderLoginFields() : renderRegisterFields()}
            <button class="primary-button" type="submit">${state.authBusy ? "Jobber…" : loginActive ? "Logg inn" : "Opprett konto"}</button>
          </form>
        </article>
      </section>
    </section>
  `;

  const installButton = elements.appView.querySelector("#landingInstallButton");
  if (installButton) {
    installButton.addEventListener("click", triggerInstallPrompt);
  }
  elements.appView.querySelector("#showRegisterButton").addEventListener("click", () => {
    state.authMode = "register";
    render();
  });
  elements.appView.querySelector("#loginTabButton").addEventListener("click", () => {
    state.authMode = "login";
    render();
  });
  elements.appView.querySelector("#registerTabButton").addEventListener("click", () => {
    state.authMode = "register";
    render();
  });

  const loginForm = elements.appView.querySelector("#loginForm");
  const registerForm = elements.appView.querySelector("#registerForm");
  if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
  }
  if (registerForm) {
    registerForm.addEventListener("submit", handleRegister);
  }
}

function renderLoginFields() {
  return `
    <label class="field">
      <span>E-post eller brukernavn</span>
      <input name="email" type="text" autocomplete="username" required />
    </label>
    <label class="field">
      <span>Passord</span>
      <input name="password" type="password" autocomplete="current-password" required />
    </label>
  `;
}

function renderRegisterFields() {
  return `
    <label class="field">
      <span>Navn</span>
      <input name="displayName" type="text" autocomplete="name" required />
    </label>
    <label class="field">
      <span>E-post</span>
      <input name="email" type="email" autocomplete="email" required />
    </label>
    <label class="field">
      <span>Passord</span>
      <input name="password" type="password" autocomplete="new-password" minlength="8" required />
    </label>
  `;
}

function renderDashboard() {
  const dashboard = state.dashboard || { items: [] };
  const count = dashboard.items?.length || 0;

  elements.appView.innerHTML = `
    <section class="stack">
      <div class="hero-card hero-grid">
        <div class="compact-stack">
          <p class="eyebrow">Dashboard</p>
          <h2>${count ? `${count} sensor${count === 1 ? "" : "er"} på kontoen din` : "Ingen sensorer enda"}</h2>
          <p class="muted">
            Sensorene dine sender siste temperatur, luftfuktighet og batteristatus direkte til Jordd.
          </p>
          <div class="button-row">
            <button id="dashboardRefreshButton" class="primary-button" type="button">${state.dashboardLoading ? "Oppdaterer…" : "Oppdater nå"}</button>
            <button id="dashboardAddSensorButton" class="secondary-button" type="button">Legg til sensor</button>
          </div>
        </div>

        <article class="card compact-stack">
          <p class="eyebrow">Konto</p>
          <h3>${escapeHtml(state.session.displayName)}</h3>
          <p class="muted">${escapeHtml(state.session.email)}</p>
          <p class="muted">Sensorer blir markert offline når de ikke har sendt data på over to rapporteringsintervaller.</p>
        </article>
      </div>

      <article class="card">
        <div class="split-head">
          <div>
            <p class="eyebrow">Sensorer</p>
            <h3>Latest reading cards</h3>
          </div>
          <span class="muted">${state.dashboardLoading ? "Laster…" : "Direkte fra Jordd backend"}</span>
        </div>
        <div class="device-grid">
          ${count ? dashboard.items.map(renderSensorCard).join("") : renderEmptySensors()}
        </div>
      </article>
    </section>
  `;

  elements.appView.querySelector("#dashboardRefreshButton").addEventListener("click", async () => {
    await loadDashboard({ successMessage: "Dashboard oppdatert." });
  });
  elements.appView.querySelector("#dashboardAddSensorButton").addEventListener("click", () => navigateTo("add-sensor"));
}

function renderEmptySensors() {
  return `
    <article class="empty-state">
      <strong>Ingen sensorer er koblet til enda.</strong>
      <p class="muted">Gå til «Legg til» for å generere en claim code og onboarde den første ESP32-sensoren din.</p>
    </article>
  `;
}

function renderSensorCard(sensor) {
  const reading = sensor.latestReading || {};
  return `
    <article class="device-card">
      <div class="split-head">
        <div>
          <strong>${escapeHtml(sensor.name)}</strong>
          <p class="muted">${escapeHtml(sensor.deviceUid)}</p>
        </div>
        <span class="availability ${sensor.online ? "online" : "offline"}">${escapeHtml(sensor.online ? "Online" : "Offline")}</span>
      </div>

      <div class="metrics-grid">
        <div class="metric">
          <span class="metric-label">Temperatur</span>
          <strong>${formatTemperature(reading.temperatureC)}</strong>
        </div>
        <div class="metric">
          <span class="metric-label">Fukt</span>
          <strong>${formatHumidity(reading.humidityPct)}</strong>
        </div>
        <div class="metric">
          <span class="metric-label">Batteri</span>
          <strong>${formatBattery(reading)}</strong>
        </div>
        <div class="metric">
          <span class="metric-label">Sist sett</span>
          <strong>${formatRelativeTime(sensor.lastSeenAt)}</strong>
        </div>
      </div>

      <p class="muted">Firmware ${escapeHtml(sensor.firmwareVersion || "ukjent")} · rapporterer hvert ${escapeHtml(String(sensor.uploadIntervalMinutes || 60))}. minutt</p>
    </article>
  `;
}

function renderAddSensor() {
  const dashboard = state.dashboard || { items: [], activeClaimCode: null };
  const claimCode = dashboard.activeClaimCode;

  elements.appView.innerHTML = `
    <section class="stack">
      <div class="hero-card">
        <p class="eyebrow">Onboarding</p>
        <h2>Legg en ESP32-sensor til kontoen din</h2>
        <p class="muted">
          Generer en engangs claim code, ta skjermbilde av den, og koble deg deretter til sensorens setup-Wi-Fi for å legge inn hjemmenett og code.
        </p>
        <div class="button-row">
          <button id="createClaimCodeButton" class="primary-button" type="button">${state.claimCodeBusy ? "Lager code…" : claimCode ? "Lag ny claim code" : "Generer claim code"}</button>
          <button id="refreshSensorsButton" class="secondary-button" type="button">${state.dashboardLoading ? "Oppdaterer…" : "Sjekk etter ny sensor"}</button>
        </div>
      </div>

      <section class="grid two-up">
        <article class="card compact-stack">
          <p class="eyebrow">Aktiv Claim Code</p>
          ${
            claimCode
              ? `
                <div class="claim-code-card">
                  <span class="claim-code">${escapeHtml(claimCode.code)}</span>
                  <p class="muted">Utløper ${escapeHtml(formatDateTime(claimCode.expiresAt))}</p>
                </div>
                <p class="muted">Ta skjermbilde før du bytter Wi-Fi på telefonen.</p>
              `
              : `
                <p class="muted">Ingen aktiv code akkurat nå. Generer en ny når du er klar til å onboarde en sensor.</p>
              `
          }
        </article>

        <article class="card">
          <p class="eyebrow">Steg For Steg</p>
          <ol class="steps">
            <li>Trykk «Generer claim code» i Jordd.</li>
            <li>Ta skjermbilde av koden.</li>
            <li>Skru på sensoren og koble telefonen til dens setup-Wi-Fi.</li>
            <li>Åpne portal-siden på sensoren, skriv inn hjemmets Wi-Fi-passord og claim code.</li>
            <li>Bytt tilbake til internett og trykk «Sjekk etter ny sensor».</li>
          </ol>
        </article>
      </section>

      <article class="card">
        <div class="split-head">
          <div>
            <p class="eyebrow">Sensorer På Kontoen</p>
            <h3>${dashboard.items?.length || 0} registrert</h3>
          </div>
          <button id="backToDashboardButton" class="ghost-button" type="button">Til oversikten</button>
        </div>
        <div class="device-grid">
          ${dashboard.items?.length ? dashboard.items.map(renderSensorCard).join("") : renderEmptySensors()}
        </div>
      </article>
    </section>
  `;

  elements.appView.querySelector("#createClaimCodeButton").addEventListener("click", createClaimCode);
  elements.appView.querySelector("#refreshSensorsButton").addEventListener("click", async () => {
    await loadDashboard({ successMessage: "Sensorlisten er oppdatert." });
  });
  elements.appView.querySelector("#backToDashboardButton").addEventListener("click", () => navigateTo("dashboard"));
}

function renderAccount() {
  const account = state.account || { user: state.session, stats: { sensorCount: state.dashboard?.items?.length || 0 } };
  const user = account.user || state.session;

  elements.appView.innerHTML = `
    <section class="stack">
      <div class="hero-card hero-grid">
        <div class="compact-stack">
          <p class="eyebrow">Konto</p>
          <h2>${escapeHtml(user.displayName)}</h2>
          <p class="muted">${escapeHtml(user.email)}</p>
        </div>
        <article class="card compact-stack">
          <p class="eyebrow">Status</p>
          <h3>${escapeHtml(String(account.stats?.sensorCount || 0))} sensorer</h3>
          <p class="muted">Denne siden lar deg oppdatere navn, e-post og passord uten å forlate PWA-en.</p>
        </article>
      </div>

      <section class="grid two-up">
        <article class="card">
          <p class="eyebrow">Profil</p>
          <h3>Oppdater kontoopplysninger</h3>
          <form id="accountForm" class="stack">
            <label class="field">
              <span>Navn</span>
              <input name="displayName" type="text" value="${escapeAttribute(user.displayName || "")}" required />
            </label>
            <label class="field">
              <span>E-post</span>
              <input name="email" type="email" value="${escapeAttribute(user.email || "")}" required />
            </label>
            <button class="primary-button" type="submit">${state.accountSaving ? "Lagrer…" : "Lagre konto"}</button>
          </form>
        </article>

        <article class="card">
          <p class="eyebrow">Sikkerhet</p>
          <h3>Endre passord</h3>
          <form id="passwordForm" class="stack">
            <label class="field">
              <span>Nåværende passord</span>
              <input name="currentPassword" type="password" autocomplete="current-password" required />
            </label>
            <label class="field">
              <span>Nytt passord</span>
              <input name="newPassword" type="password" autocomplete="new-password" minlength="8" required />
            </label>
            <button class="secondary-button" type="submit">${state.passwordSaving ? "Oppdaterer…" : "Bytt passord"}</button>
          </form>
          <button id="logoutButton" class="ghost-button full-width" type="button">Logg ut</button>
        </article>
      </section>
    </section>
  `;

  elements.appView.querySelector("#accountForm").addEventListener("submit", saveAccount);
  elements.appView.querySelector("#passwordForm").addEventListener("submit", changePassword);
  elements.appView.querySelector("#logoutButton").addEventListener("click", logout);
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  await authenticate("/auth/login", {
    email: String(formData.get("email") || "").trim(),
    password: String(formData.get("password") || ""),
  });
}

async function handleRegister(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  await authenticate("/auth/register", {
    displayName: String(formData.get("displayName") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    password: String(formData.get("password") || ""),
  });
}

async function authenticate(path, payload) {
  state.authBusy = true;
  render();

  try {
    const response = await apiPost(path, payload);
    state.session = response.user;
    setMessage(path.endsWith("register") ? "Konto opprettet." : "Innlogging vellykket.", "success");
    navigateTo("dashboard", { replace: true });
    await loadDashboard({ silent: true });
  } catch (error) {
    setMessage(getErrorMessage(error), "error");
  } finally {
    state.authBusy = false;
    syncPolling();
    render();
  }
}

async function loadDashboard(options = {}) {
  state.dashboardLoading = true;
  if (!options.silent) {
    render();
  }

  try {
    state.dashboard = await apiGet("/app/dashboard");
    if (options.successMessage) {
      setMessage(options.successMessage, "success");
    }
  } catch (error) {
    setMessage(getErrorMessage(error), "error");
  } finally {
    state.dashboardLoading = false;
    render();
  }
}

async function loadAccount(options = {}) {
  state.accountLoading = true;
  if (!options.silent) {
    render();
  }

  try {
    state.account = await apiGet("/app/account");
  } catch (error) {
    setMessage(getErrorMessage(error), "error");
  } finally {
    state.accountLoading = false;
    render();
  }
}

async function createClaimCode() {
  state.claimCodeBusy = true;
  render();

  try {
    const response = await apiPost("/app/claim-codes", {});
    state.dashboard = state.dashboard || { items: [] };
    state.dashboard.activeClaimCode = response.claimCode;
    setMessage("Ny claim code generert. Ta skjermbilde før du bytter Wi-Fi.", "success");
  } catch (error) {
    setMessage(getErrorMessage(error), "error");
  } finally {
    state.claimCodeBusy = false;
    render();
  }
}

async function saveAccount(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  state.accountSaving = true;
  render();

  try {
    const response = await apiPatch("/app/account", {
      displayName: String(formData.get("displayName") || "").trim(),
      email: String(formData.get("email") || "").trim(),
    });
    state.session = response.user;
    state.account = {
      ...(state.account || {}),
      user: response.user,
      stats: state.account?.stats || { sensorCount: state.dashboard?.items?.length || 0 },
    };
    setMessage("Kontoopplysninger lagret.", "success");
  } catch (error) {
    setMessage(getErrorMessage(error), "error");
  } finally {
    state.accountSaving = false;
    render();
  }
}

async function changePassword(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  state.passwordSaving = true;
  render();

  try {
    await apiPost("/auth/change-password", {
      currentPassword: String(formData.get("currentPassword") || ""),
      newPassword: String(formData.get("newPassword") || ""),
    });
    event.currentTarget.reset();
    setMessage("Passord oppdatert.", "success");
  } catch (error) {
    setMessage(getErrorMessage(error), "error");
  } finally {
    state.passwordSaving = false;
    render();
  }
}

async function logout() {
  try {
    await apiPost("/auth/logout", {});
  } catch {
    // Best effort logout.
  }
  stopPolling();
  state.session = null;
  state.dashboard = null;
  state.account = null;
  setMessage("Du er logget ut.", "info");
  navigateTo("", { replace: true });
  render();
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

async function apiPatch(path, body) {
  return apiRequest(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function apiRequest(path, options) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
    cache: "no-store",
  });

  const data = await safeJson(response);
  if (!response.ok) {
    const error = new Error(data?.error || `Request feilet med ${response.status}`);
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

function setMessage(message, kind = "info") {
  state.message = message;
  state.messageKind = kind;
}

async function triggerInstallPrompt() {
  if (!state.installPromptEvent) {
    return;
  }
  const installPrompt = state.installPromptEvent;
  await installPrompt.prompt();
  await installPrompt.userChoice;
  state.installPromptEvent = null;
  render();
}

function getInstallInstructions() {
  const userAgent = navigator.userAgent.toLowerCase();

  if (/iphone|ipad|ipod/.test(userAgent)) {
    return {
      lead: "Åpne jordd.com i Safari og velg «Legg til på Hjem-skjerm» før du begynner å onboarde sensorer.",
    };
  }

  if (/android/.test(userAgent)) {
    return {
      lead: state.installPromptEvent
        ? "Installer PWA-en med knappen over før du begynner å bytte mellom internett og sensorens setup-Wi-Fi."
        : "Bruk Chrome eller Edge og installer appen fra adressefeltet for den enkleste onboardingflyten.",
    };
  }

  return {
    lead: "Installer Jordd som skrivebords- eller mobilapp for å ha claim code og instruksjoner lett tilgjengelig under onboarding.",
  };
}

function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

function formatTemperature(value) {
  return typeof value === "number" ? `${value.toFixed(1)} °C` : "Ingen data";
}

function formatHumidity(value) {
  return typeof value === "number" ? `${value.toFixed(0)} %` : "Ingen data";
}

function formatBattery(reading) {
  if (typeof reading?.batteryPct === "number") {
    return `${reading.batteryPct.toFixed(0)} %`;
  }
  if (typeof reading?.batteryMv === "number") {
    return `${reading.batteryMv.toFixed(0)} mV`;
  }
  return "Ingen data";
}

function formatDateTime(value) {
  if (!value) {
    return "ukjent tid";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "ukjent tid";
  }
  return new Intl.DateTimeFormat("nb-NO", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatRelativeTime(value) {
  if (!value) {
    return "Aldri";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Ukjent";
  }

  const deltaMs = date.getTime() - Date.now();
  const rtf = new Intl.RelativeTimeFormat("nb-NO", { numeric: "auto" });
  const minutes = Math.round(deltaMs / 60000);
  if (Math.abs(minutes) < 60) {
    return rtf.format(minutes, "minute");
  }
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) {
    return rtf.format(hours, "hour");
  }
  const days = Math.round(hours / 24);
  return rtf.format(days, "day");
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
