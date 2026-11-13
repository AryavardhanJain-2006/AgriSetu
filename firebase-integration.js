/* AgriSetu Firebase Authentication + Realtime Database live monitoring.
 * This file is loaded after app.js so the existing portal pages and workflows
 * remain in place. Firebase user permissions are read from admin-managed
 * /userAccess/{uid}; the browser cannot grant itself a role or facility.
 */
(function () {
  "use strict";

  const config = window.AGRISETU_FIREBASE_CONFIG || {};
  const configReady = !!(
    window.firebase &&
    [config.apiKey, config.authDomain, config.databaseURL, config.projectId,
      config.messagingSenderId, config.appId].every(value =>
        typeof value === "string" && value.length > 0 &&
        !value.includes("REPLACE_") && !value.includes("YOUR_")
      )
  );

  let auth = null;
  let db = null;
  let suppressSignOutPageReset = false;
  let registrationInProgress = false;
  let activeSensorListeners = {};
  let sensorHistoryCache = {};
  let firebaseNotice = "";

  state.firebaseUser = null;
  state.firebaseAccess = null;
  state.firebaseReady = false;
  state.selectedFirebaseFacilityId = state.selectedFirebaseFacilityId || "";
  // Disable the old localStorage-only session. Firebase Auth is authoritative.
  state.loggedIn = false;
  sessionStorage.removeItem("agrisetuSession");

  function showLoginMessage(message, isError = true) {
    firebaseNotice = message || "";
    const target = document.getElementById("loginError");
    if (target) {
      target.innerHTML = message
        ? `<div class="${isError ? "error" : "notice"}">${escapeHtml(message)}</div>`
        : "";
    }
  }

  function firebaseErrorMessage(error) {
    const code = error && error.code ? error.code : "";
    const messages = {
      "auth/invalid-credential": "Incorrect email or password.",
      "auth/user-not-found": "No Firebase account exists for this email. Register first.",
      "auth/wrong-password": "Incorrect email or password.",
      "auth/email-already-in-use": "This email already has a Firebase account. Log in instead.",
      "auth/weak-password": "Use a password with at least 6 characters.",
      "auth/invalid-email": "Enter a valid email address.",
      "auth/network-request-failed": "Network error. Check your internet connection and try again.",
      "PERMISSION_DENIED": "Firebase denied this request. Check the deployed Realtime Database Security Rules and UID access mapping."
    };
    return messages[code] || (error && error.message) || "Firebase authentication failed.";
  }

  function facilityMap() {
    return window.AGRISETU_FACILITIES || {};
  }
  const AUTO_ACCESS_ROLES = [
    "Farmer",
    "Cold Storage",
    "Porter",
    "Buyer"
];

async function ensureUserAccessRecord(user, preferredRole = null) {

    const accessRef = db.ref(`userAccess/${user.uid}`);

    // Check whether access already exists
    let snapshot = await accessRef.once("value");

    if (snapshot.exists()) {
        return snapshot.val();
    }

    // Obtain the registration profile
    const profileSnapshot = await db
        .ref(`profiles/${user.uid}`)
        .once("value");

    const profile = profileSnapshot.val() || {};

    // Use the role selected during registration
    const requestedRole =
        preferredRole || profile.roleRequested;

    // Never allow self-registration as Admin
    const role = AUTO_ACCESS_ROLES.includes(requestedRole)
        ? requestedRole
        : "Farmer";

    // Automatically authorize basic portal access
    const accessRecord = {
        active: true,
        role: role
    };

    try {
        await accessRef.set(accessRecord);
    } catch (error) {

        // Handle another simultaneous initialization
        snapshot = await accessRef.once("value");

        if (!snapshot.exists()) {
            throw error;
        }
    }

    snapshot = await accessRef.once("value");

    return snapshot.val();
}

  function allowedFarmerFacilities() {
    const grants = (state.firebaseAccess && state.firebaseAccess.facilityIds) || {};
    return Object.keys(grants)
      .filter(id => grants[id] === true && facilityMap()[id])
      .map(id => ({ id, ...facilityMap()[id] }));
  }

  function currentFacilityIds() {
    if (!state.firebaseAccess) return [];
    if (state.role === "Cold Storage") {
      const id = state.firebaseAccess.facilityId;
      return id && facilityMap()[id] ? [id] : [];
    }
    if (state.role === "Farmer") {
      const options = allowedFarmerFacilities();
      if (!options.length) return [];
      const selected = options.find(x => x.id === state.selectedFirebaseFacilityId);
      return [selected ? selected.id : options[0].id];
    }
    return [];
  }

  function escId(value) {
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  }

  function sensorCardHtml(facilityId) {
    const info = facilityMap()[facilityId] || { name: facilityId, location: "" };
    const chartKey = `FACILITY_${facilityId}`;
    const suffix = escId(facilityId);
    return `
      <section class="card firebase-sensor-card" data-firebase-facility="${escapeAttr(facilityId)}">
        <div class="section-header">
          <div>
            <h2>Live Facility Sensors</h2>
            <p class="muted">${escapeHtml(info.name)}${info.location ? ` · ${escapeHtml(info.location)}` : ""} · ${escapeHtml(facilityId)}</p>
          </div>
          <span class="pill" id="firebase-sensor-status-${suffix}">Connecting…</span>
        </div>
        <div class="firebase-sensor-values">
          <div><span>Temperature · DHT22</span><b id="firebase-temperature-${suffix}">—</b></div>
          <div><span>Humidity · DHT22</span><b id="firebase-humidity-${suffix}">—</b></div>
          <div><span>Methane estimate · MQ-5</span><b id="firebase-methane-${suffix}">—</b></div>
          <div><span>Last received</span><b id="firebase-updated-${suffix}">Waiting for ESP32</b></div>
        </div>
        <div class="section-header" style="margin-top:22px"><div><h3>Sensor History</h3><p class="muted">Stored samples from Firebase Realtime Database</p></div></div>
        <div class="dashboard-trends full" id="firebase-history-trends-${suffix}">
          ${monitoringMetricCard("Temperature", "DHT22 sensor", chartKey, "temperature", "°C", "temp")}
          ${monitoringMetricCard("Humidity", "DHT22 sensor", chartKey, "humidity", "%", "hum")}
          ${monitoringMetricCard("Methane", "MQ-5 gas sensor", chartKey, "methane", " ppm", "co2")}
        </div>
        <p class="muted firebase-sensor-footnote">Live values update from the ESP32. History is recorded approximately once per minute.</p>
      </section>`;
  }

  function updateLatestSensorCard(facilityId, reading) {
    const suffix = escId(facilityId);
    const setText = (id, value) => {
      const element = document.getElementById(id);
      if (element) element.textContent = value;
    };
    if (!reading) {
      setText(`firebase-sensor-status-${suffix}`, "Waiting for data");
      setText(`firebase-updated-${suffix}`, "No ESP32 reading received yet");
      return;
    }
    const temperature = Number(reading.temperature);
    const humidity = Number(reading.humidity);
    const methane = Number(reading.methane_ppm);
    if (![temperature, humidity, methane].every(Number.isFinite)) return;

    setText(`firebase-temperature-${suffix}`, `${temperature.toFixed(1)} °C`);
    setText(`firebase-humidity-${suffix}`, `${humidity.toFixed(1)} %`);
    setText(`firebase-methane-${suffix}`, `${methane.toFixed(1)} ppm`);

    const receivedAt = Number(reading.received_at || 0);
    const ageMs = receivedAt ? Date.now() - receivedAt : Number.POSITIVE_INFINITY;
    const isOnline = ageMs >= 0 && ageMs <= 30000;
    setText(`firebase-sensor-status-${suffix}`, isOnline ? "ONLINE" : "STALE DATA");
    setText(`firebase-updated-${suffix}`, receivedAt ? new Date(receivedAt).toLocaleString() : "Timestamp unavailable");

    latestHardwareReading = reading;
    const stored = state.role === "Cold Storage"
      ? coldStorageBookings().filter(isAcceptedBooking).map(b => ({ batchId: b.batchId }))
      : acceptedProducts();
    stored.forEach(batch => {
      pushTrend(batch.batchId, "temperature", temperature);
      pushTrend(batch.batchId, "humidity", humidity);
      pushTrend(batch.batchId, "methane", methane);
      const write = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
      };
      write(`live-temp-${batch.batchId}`, `${temperature.toFixed(1)}°C`);
      write(`live-hum-${batch.batchId}`, `${humidity.toFixed(1)}%`);
      write(`live-co2-${batch.batchId}`, `${methane.toFixed(1)} ppm`);
      const batchCard = [...document.querySelectorAll("[data-monitor-batch]")]
        .find(el => el.getAttribute("data-monitor-batch") === String(batch.batchId));
      const trends = batchCard && batchCard.querySelector(".dashboard-trends");
      if (trends) {
        trends.innerHTML = `${monitoringMetricCard("Temperature", "DHT22 sensor", batch.batchId, "temperature", "°C", "temp")}${monitoringMetricCard("Humidity", "DHT22 sensor", batch.batchId, "humidity", "%", "hum")}${monitoringMetricCard("Methane", "MQ-5 gas sensor", batch.batchId, "methane", " ppm", "co2")}`;
      }
    });
  }

  function updateHistoryCharts(facilityId, snapshot) {
    const suffix = escId(facilityId);
    const chartKey = `FACILITY_${facilityId}`;
    const records = [];
    snapshot.forEach(child => {
      const value = child.val();
      if (value && Number.isFinite(Number(value.received_at))) records.push(value);
    });
    records.sort((a, b) => Number(a.received_at) - Number(b.received_at));
    const metrics = [
      ["temperature", "°C"],
      ["humidity", "%"],
      ["methane", " ppm"]
    ];
    for (const [metric] of metrics) {
      const sourceField = metric === "methane" ? "methane_ppm" : metric;
      state.monitorHistory[trendKey(chartKey, metric)] = records
        .map(row => Number(row[sourceField]))
        .filter(Number.isFinite)
        .slice(-60);
    }
    const holder = document.getElementById(`firebase-history-trends-${suffix}`);
    if (holder) {
      holder.innerHTML = `${monitoringMetricCard("Temperature", "DHT22 sensor", chartKey, "temperature", "°C", "temp")}${monitoringMetricCard("Humidity", "DHT22 sensor", chartKey, "humidity", "%", "hum")}${monitoringMetricCard("Methane", "MQ-5 gas sensor", chartKey, "methane", " ppm", "co2")}`;
    }
  }

  function detachSensorListeners() {
    Object.values(activeSensorListeners).forEach(item => {
      item.latestRef.off("value", item.latestCallback);
      item.historyRef.off("value", item.historyCallback);
    });
    activeSensorListeners = {};
  }

  function refreshFirebaseSensorSubscriptions() {
    if (!db || !state.firebaseUser || !state.firebaseAccess || !state.loggedIn ||
        !["monitor", "storage", "dashboard"].includes(state.page)) {
      detachSensorListeners();
      return;
    }
    const wanted = currentFacilityIds();
    const wantedSet = new Set(wanted);
    for (const existingId of Object.keys(activeSensorListeners)) {
      if (!wantedSet.has(existingId)) {
        const old = activeSensorListeners[existingId];
        old.latestRef.off("value", old.latestCallback);
        old.historyRef.off("value", old.historyCallback);
        delete activeSensorListeners[existingId];
      }
    }
    wanted.forEach(facilityId => {
      if (activeSensorListeners[facilityId]) return;
      const latestRef = db.ref(`facilities/${facilityId}/latest`);
      const historyRef = db.ref(`facilities/${facilityId}/history`).orderByChild("received_at").limitToLast(60);
      const latestCallback = snapshot => updateLatestSensorCard(facilityId, snapshot.val());
      const historyCallback = snapshot => updateHistoryCharts(facilityId, snapshot);
      activeSensorListeners[facilityId] = { latestRef, historyRef, latestCallback, historyCallback };
      latestRef.on("value", latestCallback, error => {
        const suffix = escId(facilityId);
        const status = document.getElementById(`firebase-sensor-status-${suffix}`);
        if (status) status.textContent = error.message || "ACCESS DENIED";
        console.error("Firebase latest sensor listener:", error);
      });
      historyRef.on("value", historyCallback, error => {
        console.error("Firebase history listener:", error);
      });
    });
  }

  function farmerMonitoringPage() {
    const options = allowedFarmerFacilities();
    const selected = options.find(x => x.id === state.selectedFirebaseFacilityId) || options[0];
    const stored = acceptedProducts();
    const batchCards = selected
      ? stored.filter(item => {
          const option = Object.entries(facilityMap()).find(([, info]) => info.storageKey === (item.storageId || item.storage));
          return !option || option[0] === selected.id;
        }).map(item => `<div class="card monitoring-card" data-monitor-batch="${escapeAttr(item.batchId)}"><div class="section-header"><div><h2>${escapeHtml(item.product || "Stored produce")} · ${escapeHtml(item.batchId)}</h2><p class="muted">${escapeHtml(item.storage || selected.name)} · <span class="live-dot">● Live</span></p></div><span class="pill green">Accepted & Stored</span></div><div class="dashboard-trends full">${monitoringMetricCard("Temperature", "DHT22 sensor", item.batchId, "temperature", "°C", "temp")}${monitoringMetricCard("Humidity", "DHT22 sensor", item.batchId, "humidity", "%", "hum")}${monitoringMetricCard("Methane", "MQ-5 gas sensor", item.batchId, "methane", " ppm", "co2")}</div></div>`).join("")
      : "";

    return `<div class="page-head"><div class="page-icon">♧</div><div><h1>Storage Monitoring</h1><p>Live temperature, humidity and methane readings from the cold-storage facility assigned to your account.</p></div></div>
      ${options.length ? `<div class="card monitor-storage-picker"><div><h3>Select Cold Storage</h3><p class="muted">Only facilities approved for this farmer account are listed.</p></div><select class="monitor-storage-select large" onchange="selectFirebaseMonitorFacility(this.value)">${options.map(x => `<option value="${escapeAttr(x.id)}" ${selected && x.id === selected.id ? "selected" : ""}>${escapeHtml(x.name)}${x.location ? ` · ${escapeHtml(x.location)}` : ""}</option>`).join("")}</select></div>${sensorCardHtml(selected.id)}${batchCards || `<div class="card empty-state"><h3>No batch details on this browser</h3><p>The live facility sensor feed is available above. Batch and booking records in this prototype are still stored locally in the browser.</p></div>`}` : `<div class="card empty-state"><h3>No facility access assigned</h3><p>Your AgriSetu account is authenticated, but an administrator has not yet granted access to a cold-storage facility. Ask the administrator to add a facility ID under <code>userAccess/${escapeHtml(state.firebaseUser.uid)}/facilityIds</code>.</p></div>`}`;
  }

  function coldStorageMonitoringPage() {
    const facilityId = state.firebaseAccess && state.firebaseAccess.facilityId;
    const info = facilityMap()[facilityId] || null;
    const bookings = coldStorageBookings().filter(isAcceptedBooking);
    const batchCards = bookings.map(b => `<div class="card monitoring-card" data-monitor-batch="${escapeAttr(b.batchId)}"><div class="section-header"><div><h2>${escapeHtml(b.product)} · ${escapeHtml(b.batchId)}</h2><p class="muted">Farmer: ${escapeHtml(b.farmerName || b.farmerUser || "Farmer")} · <span class="live-dot">● Live</span></p></div><span class="pill green">Accepted & Stored</span></div><div class="dashboard-trends full">${monitoringMetricCard("Temperature", "DHT22 sensor", b.batchId, "temperature", "°C", "temp")}${monitoringMetricCard("Humidity", "DHT22 sensor", b.batchId, "humidity", "%", "hum")}${monitoringMetricCard("Methane", "MQ-5 gas sensor", b.batchId, "methane", " ppm", "co2")}</div></div>`).join("");

    return `<div class="page-head"><div class="page-icon">♧</div><div><h1>Cold Storage Monitoring</h1><p>Live environmental conditions for ${escapeHtml((info && info.name) || coldStorageName() || "your facility")}.</p></div></div>
      ${info ? sensorCardHtml(facilityId) : `<div class="card empty-state"><h3>Facility not linked</h3><p>This cold-storage account has no valid facilityId in its admin-managed Firebase userAccess record.</p></div>`}
      ${batchCards || `<div class="card empty-state"><h3>No accepted batch details on this browser</h3><p>Facility-level sensor readings are displayed above. Booking and batch records in this existing prototype remain in browser localStorage and are not yet synchronized between users.</p></div>`}`;
  }

  async function activateFirebaseUser(user, access) {
    const role = access && access.role;
    const validRoles = ["Farmer", "Cold Storage", "Porter", "Buyer", "Admin"];
    if (!access || access.active !== true || !validRoles.includes(role)) {
      firebaseNotice = "Your account is signed in, but an administrator has not approved its AgriSetu role and facility access yet.";
      state.firebaseUser = null;
      state.firebaseAccess = null;
      state.loggedIn = false;
      state.page = "login";
      suppressSignOutPageReset = true;
      await auth.signOut();
      render();
      return false;
    }

    state.firebaseUser = user;
    state.firebaseAccess = access;
    state.firebaseReady = true;
    state.user = (user.email || "").toLowerCase();
    state.role = role;
    state.loggedIn = true;
    sessionStorage.setItem("agrisetuSession", "true");
    localStorage.setItem("agrisetuUser", state.user);
    localStorage.setItem(`agrisetuRole_${state.user}`, role);

    let profile = {};
    try {
      const snapshot = await db.ref(`profiles/${user.uid}`).once("value");
      profile = snapshot.val() || {};
    } catch (error) {
      console.warn("Could not load Firebase profile:", error.message);
    }
    const oldAccount = accountData(state.user);
    const account = {
      ...oldAccount,
      ...profile,
      email: state.user,
      role,
      storageName: access.storageName || profile.storageName || oldAccount.storageName,
      name: profile.name || oldAccount.name || user.displayName || state.user
    };
    localStorage.setItem(`agrisetuAccount_${state.user}`, JSON.stringify(account));
    if (state.page === "landing" || state.page === "login" || state.page === "register") {
      state.page = "dashboard";
    }
    firebaseNotice = "";
    render();
    return true;
  }

  // Replace the previous localStorage-only login screen with a notice-capable version.
  const previousLogin = window.login;
  window.login = function () {
    let html = typeof previousLogin === "function" ? previousLogin() : "";
    const notice = firebaseNotice || (!configReady
      ? "Firebase is not configured yet. Complete firebase-config.js and deploy database.rules.json before logging in."
      : "Sign in using your Firebase Authentication account.");
    const banner = `<div class="firebase-auth-help">${escapeHtml(notice)}</div>`;
    if (html.includes('<div id="loginError"></div>')) {
      html = html.replace('<div id="loginError"></div>', `<div id="loginError"></div>${banner}`);
    }
    return html;
  };

  window.doLogin = async function () {
    const email = document.getElementById("email")?.value.trim().toLowerCase();
    const password = document.getElementById("password")?.value;
    const errorBox = document.getElementById("loginError");
    if (!configReady || !auth || !db) {
      showLoginMessage("Firebase is not configured. Update firebase-config.js first.");
      return;
    }
    if (!email || !password) {
      showLoginMessage("Please enter your email and password.");
      return;
    }
    try {
      firebaseNotice = "";
      if (errorBox) errorBox.innerHTML = "";
      const credential = await auth.signInWithEmailAndPassword(email, password);
      const accessSnapshot = await db.ref(`userAccess/${credential.user.uid}`).once("value");
      const access = accessSnapshot.val();
      if (!access || access.active !== true) {
        firebaseNotice = "Your login is valid, but your AgriSetu role/facility access is pending administrator approval.";
        suppressSignOutPageReset = true;
        await auth.signOut();
        state.page = "login";
        state.loggedIn = false;
        render();
        return;
      }
      await activateFirebaseUser(credential.user, access);
    } catch (error) {
      showLoginMessage(firebaseErrorMessage(error));
    }
  };

  window.doRegister = async function () {

    const name = document.getElementById("registerName")?.value.trim();
    const phone = document.getElementById("registerPhone")?.value.trim();
    const email = document.getElementById("registerEmail")?.value.trim().toLowerCase();
    const password = document.getElementById("registerPassword")?.value;
    const confirm = document.getElementById("registerConfirm")?.value;

    const errorBox = document.getElementById("registerError");

    const selectedRole = state.role;

    const storageName = selectedRole === "Cold Storage"
        ? (document.getElementById("registerStorageName")?.value || "").trim()
        : "";

    const partnerName = selectedRole === "Porter"
        ? (document.getElementById("registerPartnerName")?.value || "").trim()
        : "";

    if (!configReady || !auth || !db) {
        if (errorBox) {
            errorBox.textContent = "Firebase is not configured.";
        }
        return;
    }

    if (!name || !phone || !email || !password || !confirm ||
        (selectedRole === "Cold Storage" && !storageName) ||
        (selectedRole === "Porter" && !partnerName)) {

        if (errorBox) {
            errorBox.textContent = "Please complete all required fields.";
        }
        return;
    }

    if (password !== confirm || password.length < 6) {
        if (errorBox) {
            errorBox.textContent =
                "Passwords must match and contain at least 6 characters.";
        }
        return;
    }

    if (!AUTO_ACCESS_ROLES.includes(selectedRole)) {
        if (errorBox) {
            errorBox.textContent = "Invalid account role.";
        }
        return;
    }

    try {

        registrationInProgress = true;

        if (errorBox) errorBox.innerHTML = "";

        // 1. Create Firebase Authentication account
        const credential =
            await auth.createUserWithEmailAndPassword(email, password);

        const user = credential.user;

        // 2. Update Firebase profile
        await user.updateProfile({
            displayName: name
        });

        // 3. Save registration details
        const profile = {
            name,
            phone,
            email,
            roleRequested: selectedRole,
            storageName: storageName || null
        };

        if (selectedRole === "Porter") {
            profile.partnerName = partnerName;
        }

        await db.ref(`profiles/${user.uid}`).set(profile);

        // 4. Automatically create authorized access
        const access = await ensureUserAccessRecord(
            user,
            selectedRole
        );

        // 5. Keep the user logged in
        await activateFirebaseUser(user, access);

        registrationInProgress = false;

        console.log(
            "AgriSetu registration successful. Access automatically activated."
        );

    } catch (error) {

        registrationInProgress = false;

        if (errorBox) {
            errorBox.innerHTML =
                `<div class="error">${escapeHtml(firebaseErrorMessage(error))}</div>`;
        }

        console.error("Registration error:", error);
    }
};;

  window.logout = async function () {
    detachSensorListeners();
    if (auth) {
      try { await auth.signOut(); } catch (error) { console.error("Firebase sign-out:", error); }
    }
    state.firebaseUser = null;
    state.firebaseAccess = null;
    state.loggedIn = false;
    state.page = "landing";
    localStorage.removeItem("agrisetuUser");
    sessionStorage.removeItem("agrisetuSession");
    render();
  };

  window.monitoringPage = farmerMonitoringPage;
  window.coldMonitorPage = coldStorageMonitoringPage;
  window.selectFirebaseMonitorFacility = function (facilityId) {
    const allowed = allowedFarmerFacilities().some(item => item.id === facilityId);
    if (!allowed) return;
    state.selectedFirebaseFacilityId = facilityId;
    render();
  };
  window.selectMonitorStorage = function (storageId) {
    const option = Object.entries(facilityMap()).find(([, info]) => info.storageKey === storageId);
    if (option) state.selectedFirebaseFacilityId = option[0];
    state.selectedMonitorStorageId = storageId;
    render();
  };

  // Keep the original renderer and all unrelated workflow pages, but attach/detach
  // Firebase listeners whenever a user navigates between pages.
  const originalRender = window.render;
  window.render = function () {
    const result = originalRender.apply(this, arguments);
    refreshFirebaseSensorSubscriptions();
    return result;
  };
  window.refreshLiveMonitoring = refreshFirebaseSensorSubscriptions;
  const originalNavigate = window.navigate;
  window.navigate = function (page) {
    if (!["monitor", "storage", "dashboard"].includes(page)) detachSensorListeners();
    return originalNavigate.apply(this, arguments);
  };

  if (!configReady) {
    state.loggedIn = false;
    state.page = "login";
    render();
    return;
  }

  try {
    if (!firebase.apps.length) firebase.initializeApp(config);
    auth = firebase.auth();
    db = firebase.database();
    state.firebaseReady = true;

    auth.onAuthStateChanged(async user => {
      if (registrationInProgress) return;
      if (!user) {
        state.firebaseUser = null;
        state.firebaseAccess = null;
        state.loggedIn = false;
        sessionStorage.removeItem("agrisetuSession");
        if (suppressSignOutPageReset) {
          suppressSignOutPageReset = false;
          state.page = "login";
        }
        detachSensorListeners();
        render();
        return;
      }
      try {
        const snapshot = await db.ref(`userAccess/${user.uid}`).once("value");
        await activateFirebaseUser(user, snapshot.val());
      } catch (error) {
        console.error("Could not load AgriSetu access record:", error);
        state.loggedIn = false;
        state.page = "login";
        firebaseNotice = "Could not verify your role access. Check the userAccess record and database rules.";
        render();
      }
    });
  } catch (error) {
    console.error("Firebase initialization error:", error);
    firebaseNotice = "Firebase initialization failed. Check firebase-config.js.";
    state.page = "login";
    render();
  }
})();
