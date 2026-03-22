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
  messageTimer: null,
  message: "",
  messageKind: "info",
  authMode: "login",
};

const elements = {
  topbar: document.querySelector(".topbar"),
  brandButton: document.querySelector("#brandButton"),
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

  elements.brandButton?.addEventListener("click", () => {
    if (state.session || state.sessionLoading) {
      navigateTo("dashboard");
      return;
    }
    navigateTo("", { replace: true });
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
    return "Legg inn Supabase URL og anon key i config.js for å starte Jordd.";
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
  const currentRoute = getRoute();
  const flatView = Boolean(state.session) && ["dashboard", "account", "add-sensor"].includes(currentRoute);
  elements.topbar.classList.toggle("is-hidden", !showTopbar);
  elements.mainContent.classList.toggle("landing-mode", !showTopbar);
  elements.appView.classList.toggle("flat-view", flatView);
  elements.pageTitle.textContent = "Jordd";
  const authenticated = Boolean(state.session);
  const showInstallButton = Boolean(state.installPromptEvent) && !isStandalone();

  elements.topbarActions.hidden = !authenticated && !showInstallButton;
  elements.installButton.hidden = !showInstallButton;
  elements.installButton.onclick = state.installPromptEvent ? triggerInstallPrompt : null;

  if (authenticated) {
    elements.primaryNav.hidden = false;
    elements.primaryNav.innerHTML = `
      <button data-route="dashboard" class="ghost-button nav-overview-button" data-active="${String(currentRoute === "dashboard")}" type="button">
        <span class="nav-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="nav-icon-svg" focusable="false">
            <path d="M4.75 4.75h6.5v6.5h-6.5v-6.5Zm8.5 0h6v4.5h-6v-4.5Zm0 6.5h6v8h-6v-8Zm-8.5 2h6.5v6h-6.5v-6Z" />
          </svg>
        </span>
        <span>Oversikt</span>
      </button>
      <button data-route="account" class="user-pill" data-active="${String(currentRoute === "account")}" type="button">
        <span class="user-pill-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" class="user-pill-svg" focusable="false">
            <path d="M12 12c2.76 0 5-2.46 5-5.5S14.76 1 12 1 7 3.46 7 6.5 9.24 12 12 12Zm0 2c-4.42 0-8 2.91-8 6.5 0 .83.67 1.5 1.5 1.5h13c.83 0 1.5-.67 1.5-1.5 0-3.59-3.58-6.5-8-6.5Z" />
          </svg>
        </span>
      </button>
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
      <span>Brukernavn</span>
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
      <span>Brukernavn</span>
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
      <article class="card">
        <div class="split-head">
          <div>
            <p class="eyebrow">Oversikt</p>
            <h3 class="${count ? "dashboard-count-title" : "empty-dashboard-title"}">${count ? `${count} sensor${count === 1 ? "" : "er"} på kontoen` : "Ingen sensorer på kontoen enda"}</h3>
          </div>
          <span class="muted overview-status">
            <svg viewBox="0 0 24 24" class="overview-status-icon" focusable="false" aria-hidden="true">
              <path d="M12 18.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Zm-4.9-3.9a1 1 0 0 0 1.4 1.4 4.94 4.94 0 0 1 7 0 1 1 0 1 0 1.4-1.4 6.94 6.94 0 0 0-9.8 0Zm-3.8-3.8a1 1 0 0 0 1.4 1.4 10.31 10.31 0 0 1 14.6 0 1 1 0 0 0 1.4-1.4 12.31 12.31 0 0 0-17.4 0Z" />
            </svg>
            <span>${state.dashboardLoading ? "Laster..." : "Live"}</span>
          </span>
        </div>
        <div class="device-grid">
          ${count ? dashboard.items.map(renderSensorCard).join("") : ""}
          ${renderAddSensorCard()}
        </div>
      </article>
    </section>
  `;
  elements.appView.querySelector("#dashboardAddSensorCard").addEventListener("click", () => navigateTo("add-sensor"));
}

function renderEmptySensors() {
  return `
    <article class="empty-state">
      <strong>Ingen sensorer er koblet til enda.</strong>
      <p class="muted">Bruk knappen for å legge til sensor for å generere en engangskode og onboarde den første Jordd-sensoren din.</p>
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
          <p class="muted sensor-meta sensor-device-id">${escapeHtml(sensor.deviceUid)}</p>
        </div>
        <span
          class="availability-dot ${sensor.online ? "online" : "offline"}"
          title="${escapeHtml(sensor.online ? "Online" : "Offline")}"
          aria-label="${escapeHtml(sensor.online ? "Online" : "Offline")}"
        >
          <svg viewBox="0 0 24 24" class="availability-dot-icon" focusable="false" aria-hidden="true">
            <path d="M12 18.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Zm-4.9-3.9a1 1 0 0 0 1.4 1.4 4.94 4.94 0 0 1 7 0 1 1 0 1 0 1.4-1.4 6.94 6.94 0 0 0-9.8 0Zm-3.8-3.8a1 1 0 0 0 1.4 1.4 10.31 10.31 0 0 1 14.6 0 1 1 0 0 0 1.4-1.4 12.31 12.31 0 0 0-17.4 0Z" />
          </svg>
        </span>
      </div>

      <div class="metrics-grid">
        ${renderMetric("Temperatur", formatTemperature(reading.temperatureC), "M12 2.25A3.25 3.25 0 0 0 8.75 5.5v7.98a4.75 4.75 0 1 0 6.5 0V5.5A3.25 3.25 0 0 0 12 2.25Zm1.75 12.15.33.2a3.25 3.25 0 1 1-4.16 0l.33-.2V5.5a1.75 1.75 0 1 1 3.5 0v8.9ZM11.25 7h1.5v6.5h-1.5V7Z")}
        ${renderMetric("Fukt", formatHumidity(reading.humidityPct), "M12 2.5c-.3 0-.58.13-.77.36C9.87 4.46 6 9.16 6 13a6 6 0 1 0 12 0c0-3.84-3.87-8.54-5.23-10.14A1 1 0 0 0 12 2.5Zm0 2.59c1.49 1.86 4 5.43 4 7.91a4 4 0 1 1-8 0c0-2.48 2.51-6.05 4-7.91Z")}
        ${renderMetric("Batteri", formatBattery(reading), "M13.2 2.5 6.8 12h4.15L9.9 21.5l7.3-10h-4Z")}
        ${renderMetric("Sist sett", formatRelativeTime(sensor.lastSeenAt), "M12 1.75A10.25 10.25 0 1 0 22.25 12 10.26 10.26 0 0 0 12 1.75Zm0 18.5A8.25 8.25 0 1 1 20.25 12 8.26 8.26 0 0 1 12 20.25Zm.75-12.5h-1.5V12c0 .27.11.52.29.71l3 3 1.06-1.06-2.85-2.86V7.75Z")}
      </div>

      <p class="muted sensor-meta sensor-footer">Firmware ${escapeHtml(sensor.firmwareVersion || "ukjent")} · rapporterer hvert ${escapeHtml(String(sensor.uploadIntervalMinutes || 60))}. minutt</p>
    </article>
  `;
}

function renderMetric(label, value, iconPath) {
  return `
    <div class="metric">
      <span class="metric-icon-wrap metric-icon-wrap-side" aria-hidden="true">
        <svg viewBox="0 0 24 24" class="metric-icon" focusable="false">
          <path d="${iconPath}" />
        </svg>
      </span>
      <div class="metric-copy">
        <span class="metric-label">
          <span class="metric-icon-wrap metric-icon-wrap-inline" aria-hidden="true">
            <svg viewBox="0 0 24 24" class="metric-icon" focusable="false">
              <path d="${iconPath}" />
            </svg>
          </span>
          ${escapeHtml(label)}
        </span>
        <strong>${escapeHtml(value)}</strong>
      </div>
    </div>
  `;
}

function renderAddSensorCard() {
  return `
    <button id="dashboardAddSensorCard" class="add-sensor-card" type="button">
      <span class="add-sensor-plus">+</span>
      <span class="add-sensor-label">Legg til sensor</span>
    </button>
  `;
}

function renderAddSensor() {
  const dashboard = state.dashboard || { items: [], activeClaimCode: null };
  const claimCode = dashboard.activeClaimCode;

  elements.appView.innerHTML = `
    <section class="stack">
      <div class="hero-card hero-grid">
        <div class="compact-stack">
          <p class="eyebrow">Onboarding</p>
          <h2>Legg til Jordd-sensor</h2>
          <p class="muted">
            Generer en engangskode, ta skjermbilde av den, og koble deg deretter til sensorens setup-Wi-Fi for å legge inn hjemmenett og kode.
          </p>
          <div class="button-row">
            <button id="createClaimCodeButton" class="primary-button" type="button">${state.claimCodeBusy ? "Lager kode..." : claimCode ? "Ny engangskode" : "Generer engangskode"}</button>
          </div>
        </div>

        <article class="card compact-stack">
          <p class="eyebrow">Aktiv engangskode</p>
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
                <p class="muted">Ingen aktiv kode akkurat nå. Generer en ny når du er klar til å onboarde en sensor.</p>
              `
          }
        </article>
      </div>

      <section>
        <article class="card">
          <p class="eyebrow">Steg For Steg</p>
          <ol class="steps">
            <li>Trykk «Ny engangskode».</li>
            <li>Ta skjermbilde av koden.</li>
            <li>Skru på sensoren og koble telefonen til dens setup-Wi-Fi.</li>
            <li>Åpne portal-siden på sensoren og skriv inn hjemmets Wi-Fi-passord og engangskode.</li>
            <li>Når sensoren er ferdig satt opp, dukker den opp automatisk på oversikten.</li>
          </ol>
        </article>
      </section>

      <div class="button-row">
        <button id="backToDashboardButton" class="ghost-button" type="button">← Tilbake</button>
      </div>
    </section>
  `;

  elements.appView.querySelector("#createClaimCodeButton").addEventListener("click", createClaimCode);
  elements.appView.querySelector("#backToDashboardButton").addEventListener("click", () => navigateTo("dashboard"));
}

function renderAccount() {
  const account = state.account || { user: state.session, stats: { sensorCount: state.dashboard?.items?.length || 0 }, sensors: [] };
  const user = account.user || state.session;
  const sensors = account.sensors?.length ? account.sensors : state.dashboard?.items || [];
  const onlineCount = sensors.filter((sensor) => sensor.online).length;
  const offlineCount = Math.max(sensors.length - onlineCount, 0);

  elements.appView.innerHTML = `
    <section class="stack">
      <div class="hero-card hero-grid">
        <div class="compact-stack account-hero-main">
          <p class="eyebrow">Konto</p>
          <div class="split-head account-hero-head">
            <h2>${escapeHtml(user.displayName)}</h2>
            <button id="logoutButton" class="ghost-button account-logout-button" type="button">Logg ut</button>
          </div>
          <p class="muted account-hero-email">${escapeHtml(user.email)}</p>
        </div>
        <article class="card compact-stack">
          <p class="eyebrow">Status</p>
          <h3>${escapeHtml(String(account.stats?.sensorCount || 0))} sensorer</h3>
          <p class="muted status-summary">${escapeHtml(String(onlineCount))} online · ${escapeHtml(String(offlineCount))} offline</p>
          <button id="accountAddSensorButton" class="primary-button" type="button">Legg til sensor</button>
        </article>
      </div>

      <section class="grid two-up">
        <article class="card">
          <p class="eyebrow">Profil</p>
          <h3>Oppdater kontoopplysninger</h3>
          <form id="accountForm" class="stack">
            <label class="field">
              <span>Brukernavn</span>
              <input name="displayName" type="text" value="${escapeAttribute(user.displayName || "")}" required />
            </label>
            <label class="field">
              <span>E-post</span>
              <input name="email" type="email" value="${escapeAttribute(user.email || "")}" required />
            </label>
            <button class="secondary-button" type="submit">${state.accountSaving ? "Lagrer..." : "Lagre opplysninger"}</button>
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
            <button class="secondary-button" type="submit">${state.passwordSaving ? "Oppdaterer..." : "Bytt passord"}</button>
          </form>
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
              <p class="muted">Når du legger til en Jordd-sensor dukker den opp her og kan slettes manuelt ved behov.</p>
            </article>
          `}
        </div>
      </article>
    </section>
  `;

  elements.appView.querySelector("#accountForm").addEventListener("submit", saveAccount);
  elements.appView.querySelector("#passwordForm").addEventListener("submit", changePassword);
  elements.appView.querySelector("#accountAddSensorButton").addEventListener("click", () => navigateTo("add-sensor"));
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
      <div class="sensor-admin-main">
        <strong class="sensor-admin-name">${escapeHtml(sensor.name)}</strong>
        <span class="muted sensor-meta sensor-admin-device-id">${escapeHtml(sensor.deviceUid)}</span>
        <span class="muted sensor-meta sensor-admin-detail">Sist sett ${escapeHtml(formatRelativeTime(sensor.lastSeenAt))}</span>
        <span class="muted sensor-meta sensor-admin-detail">Firmware ${escapeHtml(sensor.firmwareVersion || "ukjent")} · ${escapeHtml(String(sensor.uploadIntervalMinutes || 60))} min</span>
      </div>
      <div class="sensor-admin-actions">
        <span
          class="availability-dot ${sensor.online ? "online" : "offline"}"
          title="${escapeHtml(sensor.online ? "Online" : "Offline")}"
          aria-label="${escapeHtml(sensor.online ? "Online" : "Offline")}"
        >
          <svg viewBox="0 0 24 24" class="availability-dot-icon" focusable="false" aria-hidden="true">
            <path d="M12 18.2a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Zm-4.9-3.9a1 1 0 0 0 1.4 1.4 4.94 4.94 0 0 1 7 0 1 1 0 1 0 1.4-1.4 6.94 6.94 0 0 0-9.8 0Zm-3.8-3.8a1 1 0 0 0 1.4 1.4 10.31 10.31 0 0 1 14.6 0 1 1 0 0 0 1.4-1.4 12.31 12.31 0 0 0-17.4 0Z" />
          </svg>
        </span>
        <button
          class="ghost-button danger-button icon-button"
          type="button"
          data-delete-sensor-id="${escapeAttribute(sensor.id)}"
          title="Slett sensor"
          aria-label="Slett sensor"
        >
          <svg viewBox="0 0 24 24" class="icon-button-svg" focusable="false" aria-hidden="true">
            <path d="M9 3.75A2.25 2.25 0 0 0 6.75 6H4.5a.75.75 0 0 0 0 1.5h.8l.88 10.46A2.25 2.25 0 0 0 8.42 20h7.16a2.25 2.25 0 0 0 2.24-2.04l.88-10.46h.8a.75.75 0 0 0 0-1.5h-2.25A2.25 2.25 0 0 0 15 3.75H9Zm0 1.5h6A.75.75 0 0 1 15.75 6h-7.5A.75.75 0 0 1 9 5.25Zm.34 4.4a.75.75 0 1 0-1.5.1l.4 6a.75.75 0 1 0 1.5-.1l-.4-6Zm6.32 0a.75.75 0 1 0-1.5-.1l-.4 6a.75.75 0 0 0 1.5.1l.4-6ZM12 9a.75.75 0 0 0-.75.75v6.5a.75.75 0 0 0 1.5 0v-6.5A.75.75 0 0 0 12 9Z" />
          </svg>
        </button>
      </div>
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
    const response = await invokeFunction("auth-login", {
      identifier,
      password,
    }, { requireAuth: false });
    const session = response.session || null;
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
    state.session = mapUser(sessionData.session?.user || response.user || null);
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
    setMessage("Ny engangskode generert. Ta skjermbilde før du bytter Wi-Fi.", "success");
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

  const initialConfirm = window.confirm("Vil du slette denne sensoren fra kontoen?");
  if (!initialConfirm) {
    return;
  }

  const finalConfirm = window.confirm("Er du helt sikker? Dette fjerner også alle lagrede målinger for sensoren.");
  if (!finalConfirm) {
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
  if (state.messageTimer) {
    clearTimeout(state.messageTimer);
    state.messageTimer = null;
  }
  state.message = message;
  state.messageKind = kind;

  if (!message) {
    return;
  }

  const timeoutMs = kind === "error" ? 6000 : 4000;
  state.messageTimer = window.setTimeout(() => {
    state.message = "";
    state.messageKind = "info";
    state.messageTimer = null;
    render();
  }, timeoutMs);
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
