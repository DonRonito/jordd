import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const rawConfig = window.JORDD_CONFIG || {};
const config = normalizeConfig(rawConfig);

const state = {
  supabase: null,
  config,
  configError: getConfigError(config),
  accessToken: "",
  installPromptEvent: null,
  sessionLoading: true,
  authBusy: false,
  session: null,
  dashboardLoading: false,
  dashboard: null,
  accountLoading: false,
  account: null,
  accountSaving: false,
  sensorDeletingId: "",
  passwordSaving: false,
  claimCodeBusy: false,
  pollTimer: null,
  message: "",
  messageKind: "info",
  authMode: "login",
};

const elements = {
  topbar: document.querySelector(".topbar"),
  mainContent: document.querySelector(".main-content"),
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

  if (state.configError) {
    state.sessionLoading = false;
    render();
    return;
  }

  state.supabase = createClient(state.config.supabaseUrl, state.config.supabaseAnonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });

  state.supabase.auth.onAuthStateChange(async (_event, session) => {
    state.accessToken = session?.access_token || "";
    state.session = mapUser(session?.user || null);

    if (!state.session) {
      stopPolling();
      state.dashboard = null;
      state.account = null;
      if (getRoute() !== "landing") {
        navigateTo("", { replace: true });
      }
      render();
      return;
    }

    if (!location.hash) {
      navigateTo("dashboard", { replace: true });
    }
    syncPolling();
    render();
  });

  try {
    const {
      data: { session },
      error,
    } = await state.supabase.auth.getSession();

    if (error) {
      throw error;
    }

    state.session = mapUser(session?.user || null);
    state.accessToken = session?.access_token || "";
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

function normalizeConfig(value) {
  const supabaseUrl = String(value.supabaseUrl || "").trim().replace(/\/+$/, "");
  const deviceApiBase = String(value.deviceApiBase || "").trim().replace(/\/+$/, "");
  return {
    supabaseUrl,
    supabaseAnonKey: String(value.supabaseAnonKey || "").trim(),
    inviteCode: String(value.inviteCode || "").trim(),
    deviceApiBase: deviceApiBase || supabaseUrl,
  };
}

function getConfigError(value) {
  if (!value.supabaseUrl || !value.supabaseAnonKey) {
    return "Legg inn Supabase URL og anon key i config.js for a starte Jordd.";
  }
  return "";
}

function mapUser(user) {
  if (!user) {
    return null;
  }

  const displayName =
    String(user.user_metadata?.display_name || "").trim() ||
    String(user.email || "").split("@")[0] ||
    "Jordd-bruker";

  return {
    id: user.id,
    email: user.email || "",
    displayName,
  };
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
  if (!state.session || !state.supabase) {
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
    elements.appView.innerHTML = `
      <section class="stack">
        <div class="hero-card">
          <p class="eyebrow">Starter</p>
          <h2>Laster Jordd…</h2>
          <p class="muted">Kobler til konto, sensorer og onboardingflyt.</p>
        </div>
      </section>
    `;
    return;
  }

  if (state.configError) {
    renderConfigSetup();
    return;
  }

  if (!state.session) {
    renderLanding();
    return;
  }

  const route = getRoute();
  if (route === "account") {
    renderAccount();
    return;
  }

  if (route === "add-sensor") {
    renderAddSensor();
    return;
  }

  renderDashboard();
}

function renderHeader() {
  const showTopbar = Boolean(state.session) || state.sessionLoading;
  elements.topbar.classList.toggle("is-hidden", !showTopbar);
  elements.mainContent.classList.toggle("landing-mode", !showTopbar);
  elements.pageTitle.textContent = "Jordd";
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

function renderConfigSetup() {
  elements.appView.innerHTML = `
    <section class="auth-shell">
      <article class="card compact-stack">
        <h2>Koble til Supabase</h2>
        <p class="muted">${escapeHtml(state.configError)}</p>
        <p class="muted">Kopier <code>config.example.js</code> til <code>config.js</code> og fyll inn prosjektverdiene dine.</p>
      </article>
    </section>
  `;
}

function renderLanding() {
  const registerMode = state.authMode === "register";
  elements.appView.innerHTML = `
    <section class="auth-shell">
      <div class="landing-glass compact-stack">
        <div class="landing-brand compact-stack">
          <img class="landing-brand-mark" src="/icons/icon.svg" alt="Jordd" />
          <h1 class="landing-title">Jordd</h1>
        </div>

        <form id="${registerMode ? "registerForm" : "loginForm"}" class="auth-form stack">
          ${registerMode ? renderRegisterFields() : renderLoginFields()}
          <button class="primary-button full-width" type="submit">${state.authBusy ? "Jobber..." : registerMode ? "Opprett konto" : "Logg inn"}</button>
        </form>
      </div>

      <div class="landing-actions compact-stack">
        <button id="${registerMode ? "showLoginButton" : "showRegisterButton"}" class="text-button" type="button">
          ${registerMode ? "Tilbake til login" : "Opprett konto"}
        </button>
        ${state.installPromptEvent ? '<button id="landingInstallButton" class="secondary-button" type="button">Installer PWA</button>' : ""}
      </div>
    </section>
  `;

  const installButton = elements.appView.querySelector("#landingInstallButton");
  if (installButton) {
    installButton.addEventListener("click", triggerInstallPrompt);
  }
  if (registerMode) {
    elements.appView.querySelector("#showLoginButton").addEventListener("click", () => {
      state.authMode = "login";
      render();
    });
    elements.appView.querySelector("#registerForm").addEventListener("submit", handleRegister);
    return;
  }

  elements.appView.querySelector("#showRegisterButton").addEventListener("click", () => {
    state.authMode = "register";
    render();
  });
  elements.appView.querySelector("#loginForm").addEventListener("submit", handleLogin);
}

function renderLoginFields() {
  return `
    <label class="field">
      <span>E-post eller brukernavn</span>
      <input name="identifier" type="text" autocomplete="username" required />
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
    <label class="field">
      <span>Pilotkode</span>
      <input name="inviteCode" type="text" autocomplete="off" required />
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
          <h2>${count ? `${count} sensor${count === 1 ? "" : "er"} pa kontoen din` : "Ingen sensorer enda"}</h2>
          <p class="muted">
            Sensorene dine sender siste temperatur, luftfuktighet og batteristatus direkte til Jordd.
          </p>
          <div class="button-row">
            <button id="dashboardRefreshButton" class="primary-button" type="button">${state.dashboardLoading ? "Oppdaterer..." : "Oppdater na"}</button>
            <button id="dashboardAddSensorButton" class="secondary-button" type="button">Legg til sensor</button>
          </div>
        </div>

        <article class="card compact-stack">
          <p class="eyebrow">Konto</p>
          <h3>${escapeHtml(state.session.displayName)}</h3>
          <p class="muted">${escapeHtml(state.session.email)}</p>
          <p class="muted">Sensorer markeres offline nar de ikke har sendt data pa over to rapporteringsintervaller.</p>
        </article>
      </div>

      <article class="card">
        <div class="split-head">
          <div>
            <p class="eyebrow">Sensorer</p>
            <h3>Latest reading cards</h3>
          </div>
          <span class="muted">${state.dashboardLoading ? "Laster..." : "Direkte fra Supabase"}</span>
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
      <p class="muted">Ga til «Legg til» for a generere en claim code og onboarde den forste Jordd-sensoren din.</p>
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
  const deviceApiBase = state.config.deviceApiBase || state.config.supabaseUrl;

  elements.appView.innerHTML = `
    <section class="stack">
      <div class="hero-card">
        <p class="eyebrow">Onboarding</p>
        <h2>Legg en Jordd-sensor til kontoen din</h2>
        <p class="muted">
          Generer en engangs claim code, ta skjermbilde av den, og koble deg deretter til sensorens setup-Wi-Fi for a legge inn hjemmenett og kode.
        </p>
        <div class="button-row">
          <button id="createClaimCodeButton" class="primary-button" type="button">${state.claimCodeBusy ? "Lager kode..." : claimCode ? "Lag ny claim code" : "Generer claim code"}</button>
          <button id="refreshSensorsButton" class="secondary-button" type="button">${state.dashboardLoading ? "Oppdaterer..." : "Sjekk etter ny sensor"}</button>
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
                  <p class="muted">Utloper ${escapeHtml(formatDateTime(claimCode.expiresAt))}</p>
                </div>
                <p class="muted">Ta skjermbilde for du bytter Wi-Fi pa telefonen.</p>
              `
              : `
                <p class="muted">Ingen aktiv code akkurat na. Generer en ny nar du er klar til a onboarde en sensor.</p>
              `
          }
        </article>

        <article class="card compact-stack">
          <p class="eyebrow">Jordd API</p>
          <h3>${escapeHtml(deviceApiBase)}</h3>
          <p class="muted">Skriv denne adressen i feltet «Jordd API» pa sensoren under setup.</p>
        </article>
      </section>

      <section class="grid two-up">
        <article class="card">
          <p class="eyebrow">Steg For Steg</p>
          <ol class="steps">
            <li>Trykk «Generer claim code» i Jordd.</li>
            <li>Ta skjermbilde av koden.</li>
            <li>Skru pa sensoren og koble telefonen til dens setup-Wi-Fi.</li>
            <li>Apne portal-siden pa sensoren, skriv inn hjemmets Wi-Fi-passord, claim code og Jordd API-adressen over.</li>
            <li>Bytt tilbake til internett og trykk «Sjekk etter ny sensor».</li>
          </ol>
        </article>

        <article class="card">
          <p class="eyebrow">Sensorer Pa Kontoen</p>
          <h3>${dashboard.items?.length || 0} registrert</h3>
          <div class="device-grid">
            ${dashboard.items?.length ? dashboard.items.map(renderSensorCard).join("") : renderEmptySensors()}
          </div>
        </article>
      </section>

      <div class="button-row">
        <button id="backToDashboardButton" class="ghost-button" type="button">Til oversikten</button>
      </div>
    </section>
  `;

  elements.appView.querySelector("#createClaimCodeButton").addEventListener("click", createClaimCode);
  elements.appView.querySelector("#refreshSensorsButton").addEventListener("click", async () => {
    await loadDashboard({ successMessage: "Sensorlisten er oppdatert." });
  });
  elements.appView.querySelector("#backToDashboardButton").addEventListener("click", () => navigateTo("dashboard"));
}

function renderAccount() {
  const account = state.account || { user: state.session, stats: { sensorCount: state.dashboard?.items?.length || 0 }, sensors: [] };
  const user = account.user || state.session;
  const sensors = account.sensors?.length ? account.sensors : state.dashboard?.items || [];

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
          <p class="muted">Denne siden lar deg oppdatere navn, e-post og passord uten a forlate PWA-en.</p>
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
            <button class="primary-button" type="submit">${state.accountSaving ? "Lagrer..." : "Lagre konto"}</button>
          </form>
        </article>

        <article class="card">
          <p class="eyebrow">Sikkerhet</p>
          <h3>Endre passord</h3>
          <form id="passwordForm" class="stack">
            <label class="field">
              <span>Navaerende passord</span>
              <input name="currentPassword" type="password" autocomplete="current-password" required />
            </label>
            <label class="field">
              <span>Nytt passord</span>
              <input name="newPassword" type="password" autocomplete="new-password" minlength="8" required />
            </label>
            <button class="secondary-button" type="submit">${state.passwordSaving ? "Oppdaterer..." : "Bytt passord"}</button>
          </form>
          <button id="logoutButton" class="ghost-button full-width" type="button">Logg ut</button>
        </article>
      </section>

      <article class="card">
        <div class="split-head">
          <div>
            <p class="eyebrow">Sensorer</p>
            <h3>Administrer tilkoblede sensorer</h3>
          </div>
          <span class="muted">${escapeHtml(String(sensors.length))} registrert</span>
        </div>
        <div class="sensor-admin-list">
          ${sensors.length ? sensors.map(renderAccountSensorRow).join("") : `
            <article class="empty-state">
              <strong>Ingen sensorer på kontoen enda.</strong>
              <p class="muted">Når du claimer en Jordd-sensor dukker den opp her og kan slettes manuelt ved behov.</p>
            </article>
          `}
        </div>
      </article>
    </section>
  `;

  elements.appView.querySelector("#accountForm").addEventListener("submit", saveAccount);
  elements.appView.querySelector("#passwordForm").addEventListener("submit", changePassword);
  elements.appView.querySelector("#logoutButton").addEventListener("click", logout);
  elements.appView.querySelectorAll("[data-delete-sensor-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      await deleteSensor(button.dataset.deleteSensorId || "");
    });
  });
}

function renderAccountSensorRow(sensor) {
  return `
    <article class="sensor-admin-item">
      <div class="compact-stack">
        <div class="split-head">
          <div>
            <strong>${escapeHtml(sensor.name)}</strong>
            <p class="muted">${escapeHtml(sensor.deviceUid)}</p>
          </div>
          <span class="availability ${sensor.online ? "online" : "offline"}">${escapeHtml(sensor.online ? "Online" : "Offline")}</span>
        </div>
        <p class="muted">Sist sett ${escapeHtml(formatRelativeTime(sensor.lastSeenAt))}</p>
      </div>
      <button
        class="ghost-button danger-button"
        type="button"
        data-delete-sensor-id="${escapeAttribute(sensor.id)}"
      >${state.sensorDeletingId === sensor.id ? "Sletter..." : "Slett sensor"}</button>
    </article>
  `;
}

async function handleLogin(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const identifier = String(formData.get("identifier") || "").trim();
  const password = String(formData.get("password") || "");

  state.authBusy = true;
  render();

  try {
    const { data, error } = await invokeFunction("auth-login", {
      identifier,
      password,
    }, { requireAuth: false });
    if (error) {
      throw error;
    }
    const session = data.session || null;
    if (!session?.access_token || !session?.refresh_token) {
      throw new Error("Innloggingen returnerte ikke en gyldig session.");
    }
    const { data: sessionData, error: sessionError } = await state.supabase.auth.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    });
    if (sessionError) {
      throw sessionError;
    }
    state.accessToken = sessionData.session?.access_token || session.access_token;
    state.session = mapUser(sessionData.session?.user || data.user || null);
    setMessage("Innlogging vellykket.", "success");
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

async function handleRegister(event) {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const payload = {
    displayName: String(formData.get("displayName") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    password: String(formData.get("password") || ""),
    inviteCode: String(formData.get("inviteCode") || "").trim(),
  };

  state.authBusy = true;
  render();

  try {
    await invokeFunction("auth-register", payload, { requireAuth: false });
    const { data, error } = await state.supabase.auth.signInWithPassword({
      email: payload.email,
      password: payload.password,
    });
    if (error) {
      throw error;
    }
    state.accessToken = data.session?.access_token || "";
    state.session = mapUser(data.user);
    state.authMode = "login";
    setMessage("Konto opprettet.", "success");
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
    state.dashboard = await invokeFunction("app-dashboard", {});
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
    state.account = await invokeFunction("app-account", {});
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
    const response = await invokeFunction("app-claim-codes", {});
    state.dashboard = state.dashboard || { items: [] };
    state.dashboard.activeClaimCode = response.claimCode;
    setMessage("Ny claim code generert. Ta skjermbilde for du bytter Wi-Fi.", "success");
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
    const response = await invokeFunction("app-account-update", {
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
    await invokeFunction("auth-change-password", {
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

async function deleteSensor(sensorId) {
  if (!sensorId || state.sensorDeletingId) {
    return;
  }

  const confirmed = window.confirm("Vil du slette denne sensoren fra kontoen? Dette fjerner også lagrede målinger for sensoren.");
  if (!confirmed) {
    return;
  }

  state.sensorDeletingId = sensorId;
  render();

  try {
    await invokeFunction("app-delete-sensor", { sensorId });
    if (state.dashboard?.items) {
      state.dashboard.items = state.dashboard.items.filter((item) => item.id !== sensorId);
    }
    await loadAccount({ silent: true });
    setMessage("Sensor slettet.", "success");
  } catch (error) {
    setMessage(getErrorMessage(error), "error");
  } finally {
    state.sensorDeletingId = "";
    render();
  }
}

async function logout() {
  try {
    await state.supabase.auth.signOut();
  } catch {
    // Best effort logout.
  }
  stopPolling();
  state.session = null;
  state.accessToken = "";
  state.dashboard = null;
  state.account = null;
  setMessage("Du er logget ut.", "info");
  navigateTo("", { replace: true });
  render();
}

async function invokeFunction(name, payload, options = {}) {
  if (!state.supabase) {
    throw new Error("Supabase er ikke konfigurert.");
  }

  const headers = {
    "Content-Type": "application/json",
    apikey: state.config.supabaseAnonKey,
  };
  const accessToken = state.accessToken;
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  if (options.requireAuth !== false && !accessToken) {
    throw new Error("Du må logge inn for å fortsette.");
  }

  const response = await fetch(`${state.config.supabaseUrl}/functions/v1/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(payload || {}),
    cache: "no-store",
  });
  const data = await safeJson(response);
  if (!response.ok) {
    const error = new Error(data?.error || `Edge Function returned ${response.status}`);
    error.payload = data;
    throw error;
  }

  if (data?.error) {
    const wrapped = new Error(data.error);
    wrapped.payload = data;
    throw wrapped;
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
  if (error?.context?.json?.error) {
    return error.context.json.error;
  }
  if (error?.message) {
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
