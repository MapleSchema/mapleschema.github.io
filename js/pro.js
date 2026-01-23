/* /js/pro.js
   MapleSchema Pro page logic
   - Auth (Google via Firebase compat)
   - Populate routing dropdowns (aggregator/bank) if available
   - Hide routing UI if empty
   - Upload + convert using paid endpoints
*/

(() => {
  // ---- Config ----
  // If you have a dedicated API domain, set window.MAPLE_API_BASE in HTML before this script.
  // Otherwise it will use same-origin.
  const API_BASE = (window.MAPLE_API_BASE || "").replace(/\/$/, "");

  const SUBSCRIBE_URL = "/subscribe.html";

  // ---- DOM helpers ----
  const $ = (id) => document.getElementById(id);

  function show(el) { if (el) el.style.display = ""; }
  function hide(el) { if (el) el.style.display = "none"; }

  function setDisabled(el, disabled) {
    if (!el) return;
    el.disabled = !!disabled;
    el.style.opacity = disabled ? "0.65" : "1";
    el.style.cursor = disabled ? "not-allowed" : "pointer";
  }

  function setText(el, text) {
    if (el) el.textContent = text ?? "";
  }

  // ---- Error box ----
  function clearError() {
    hide($("errorBox"));
    setText($("errorText"), "");
    setText($("requestId"), "");
  }

  function showError(message, requestId) {
    setText($("errorText"), message || "Something went wrong.");
    setText($("requestId"), requestId ? `Request ID: ${requestId}` : "");
    show($("errorBox"));
  }

  // ---- Firebase init ----
  function initFirebaseOnce() {
    if (!window.firebase) {
      showError("Firebase SDK not loaded.", null);
      return false;
    }

    if (!window.MAPLE_FIREBASE_CONFIG) {
      showError("Firebase config missing (window.MAPLE_FIREBASE_CONFIG).", null);
      return false;
    }

    try {
      // Avoid duplicate init if hot-reloading or multiple scripts
      if (!firebase.apps || firebase.apps.length === 0) {
        firebase.initializeApp(window.MAPLE_FIREBASE_CONFIG);
      }
      return true;
    } catch (e) {
      // If already initialized, ignore
      return true;
    }
  }

  // ---- Output selection ----
  function msSelectedOutput() {
    return document.querySelector('input[name="msOutput"]:checked')?.value || "csv";
  }

  function msEndpointFor(output) {
    if (output === "json") return "/v1/full/json";
    if (output === "quickbooks") return "/v1/full/quickbooks";
    return "/v1/full/csv";
  }

  function syncInsightsUI() {
    const out = msSelectedOutput();
    const insights = $("msInsights");
    const label = $("msInsightsLabel");

    const enabled = (out === "csv" || out === "json");
    if (!insights || !label) return;

    if (!enabled) {
      insights.checked = false;
      insights.disabled = true;
      label.style.opacity = "0.55";
    } else {
      insights.disabled = false;
      label.style.opacity = "1";
    }
  }

  // ---- Routing visibility ----
  function updateRoutingVisibility() {
    const aggSelect = $("aggregatorCode");
    const instSelect = $("institutionCode");

    const aggWrap = $("aggregatorWrap");
    const instWrap = $("institutionWrap");
    const routingWrap = $("routingWrap");

    if (!aggSelect || !instSelect || !routingWrap) return;

    // Treat "(none)" placeholder as the only option => empty
    const aggHasOptions = aggSelect.options.length > 1;
    const instHasOptions = instSelect.options.length > 1;

    if (aggWrap) aggWrap.style.display = aggHasOptions ? "" : "none";
    if (instWrap) instWrap.style.display = instHasOptions ? "" : "none";

    routingWrap.style.display = (aggHasOptions || instHasOptions) ? "grid" : "none";

    // Optional polish: if only one visible, make it full width
    if (aggHasOptions && instHasOptions) {
      routingWrap.style.gridTemplateColumns = "1fr 1fr";
    } else {
      routingWrap.style.gridTemplateColumns = "1fr";
    }
  }

  // ---- Populate routing selects (safe + optional) ----
  // This tries a few endpoints (in order). If none exist, it quietly leaves dropdowns as "(none)" and hides them.
  async function tryFetchJson(path, idToken) {
    const url = `${API_BASE}${path}`;
    const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
    const resp = await fetch(url, { headers });
    if (!resp.ok) return null;
    return await resp.json();
  }

  function fillSelect(selectEl, items, placeholderText = "(none)") {
    if (!selectEl) return;
    // Keep first placeholder option
    selectEl.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = placeholderText;
    selectEl.appendChild(opt0);

    if (!Array.isArray(items)) return;

    for (const it of items) {
      // support {code,name} or {id,label} or string
      let value = "";
      let label = "";
      if (typeof it === "string") {
        value = it;
        label = it;
      } else if (it && typeof it === "object") {
        value = it.code ?? it.id ?? it.value ?? "";
        label = it.name ?? it.label ?? it.code ?? it.id ?? value;
      }
      if (!value) continue;
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      selectEl.appendChild(opt);
    }
  }

  async function populateRoutingDropdowns(idToken) {
    const aggSelect = $("aggregatorCode");
    const instSelect = $("institutionCode");
    if (!aggSelect || !instSelect) return;

    // Default: leave as "(none)" and hide unless we find data
    fillSelect(aggSelect, [], "(none)");
    fillSelect(instSelect, [], "(none)");

    // Try common patterns (you can remove paths you don’t use)
    const candidates = [
      { kind: "aggregators", path: "/v1/routing/aggregators" },
      { kind: "aggregators", path: "/v1/routing/aggregator-codes" },
      { kind: "aggregators", path: "/v1/aggregators" },
      { kind: "institutions", path: "/v1/routing/institutions" },
      { kind: "institutions", path: "/v1/routing/institution-codes" },
      { kind: "institutions", path: "/v1/institutions" },
    ];

    let aggregators = null;
    let institutions = null;

    for (const c of candidates) {
      if (c.kind === "aggregators" && aggregators) continue;
      if (c.kind === "institutions" && institutions) continue;

      try {
        const data = await tryFetchJson(c.path, idToken);
        if (!data) continue;

        // Accept either {items:[...]} or direct array
        const arr = Array.isArray(data) ? data : (data.items || data.aggregators || data.institutions || null);
        if (!Array.isArray(arr)) continue;

        if (c.kind === "aggregators") aggregators = arr;
        if (c.kind === "institutions") institutions = arr;

        if (aggregators && institutions) break;
      } catch {
        // ignore and try next
      }
    }

    if (aggregators) fillSelect(aggSelect, aggregators, "(none)");
    if (institutions) fillSelect(instSelect, institutions, "(none)");

    updateRoutingVisibility();
  }

  // ---- Auth UI wiring ----
  function setSignedOutUI() {
    setText($("authStatus"), "Not signed in");
    setText($("authEmail"), "");

    hide($("signedInCard"));

    show($("signInWrap"));
    hide($("btnSignOut"));
    setDisabled($("btnSignOut"), true);

    setDisabled($("fileInput"), true);
    setDisabled($("btnConvert"), true);

    // Routing dropdowns may be populated later; still hide if empty
    updateRoutingVisibility();
  }

  function setSignedInUI(email) {
    setText($("authStatus"), "Signed in");
    setText($("authEmail"), email || "");

    show($("signedInCard"));

    hide($("signInWrap"));
    show($("btnSignOut"));
    setDisabled($("btnSignOut"), false);

    setDisabled($("fileInput"), false);
    // Convert stays disabled until a file is selected
    setDisabled($("btnConvert"), true);
  }

  async function ensureGoogleSignInOrSubscribe() {
    try {
      const auth = firebase.auth();
      if (auth.currentUser) return auth.currentUser;

      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await auth.signInWithPopup(provider);
      return result.user;
    } catch (e) {
      window.location.href = SUBSCRIBE_URL;
      throw e;
    }
  }

  async function getIdTokenOrThrow() {
    const auth = firebase.auth();
    const user = auth.currentUser;
    if (!user) throw new Error("Not signed in");
    return await user.getIdToken(/* forceRefresh */ true);
  }

  // ---- File handling ----
  function wireFileInput() {
    const fileInput = $("fileInput");
    if (!fileInput) return;

    fileInput.addEventListener("change", () => {
      clearError();
      const f = fileInput.files && fileInput.files[0];
      setText($("fileName"), f ? f.name : "No file selected");
      // Enable convert only if signed in and file present
      const authed = !!firebase.auth().currentUser;
      setDisabled($("btnConvert"), !(authed && !!f));
    });
  }

  // ---- Convert ----
  function selectedRouting() {
    const aggregatorCode = $("aggregatorCode")?.value || "";
    const institutionCode = $("institutionCode")?.value || "";
    return { aggregatorCode, institutionCode };
  }

  async function doConvert() {
    clearError();

    // Ensure auth
    const user = await ensureGoogleSignInOrSubscribe();
    if (!user) return;

    const idToken = await getIdTokenOrThrow();

    // Ensure file
    const fileInput = $("fileInput");
    const file = fileInput?.files?.[0];
    if (!file) {
      showError("Please choose a JSON file first.", null);
      return;
    }

    const output = msSelectedOutput();
    const endpoint = msEndpointFor(output);
    const includeInsights = $("msInsights")?.checked === true;

    const { aggregatorCode, institutionCode } = selectedRouting();

    // Build multipart form data
    const fd = new FormData();
    fd.append("file", file, file.name);

    // Options: keep these generic; your backend can ignore what it doesn’t need.
    fd.append("output", output);
    fd.append("insights", includeInsights ? "true" : "false");

    if (aggregatorCode) fd.append("aggregator_code", aggregatorCode);
    if (institutionCode) fd.append("institution_code", institutionCode);

    // Disable button while processing
    const btn = $("btnConvert");
    setDisabled(btn, true);
    const prevText = btn?.textContent;
    if (btn) btn.textContent = "WORKING…";

    try {
      const resp = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${idToken}`,
        },
        body: fd,
      });

      // Tier / auth failures => subscribe
      if (resp.status === 401 || resp.status === 403 || resp.status === 402) {
        window.location.href = SUBSCRIBE_URL;
        return;
      }

      // Try to surface request id if present
      const requestId = resp.headers.get("x-request-id") || resp.headers.get("x-maple-request-id") || "";

      if (!resp.ok) {
        // attempt to read json error
        let msg = `Convert failed (HTTP ${resp.status}).`;
        try {
          const j = await resp.json();
          msg = j.error || j.message || msg;
        } catch {
          // ignore
        }
        showError(msg, requestId);
        return;
      }

      // Download result
      const blob = await resp.blob();

      // filename: Content-Disposition if present
      let filename = "";
      const cd = resp.headers.get("content-disposition") || "";
      const m = /filename\*?=(?:UTF-8''|")?([^\";]+)\"?/i.exec(cd);
      if (m && m[1]) filename = decodeURIComponent(m[1].replace(/"/g, ""));

      if (!filename) {
        const ext = (output === "json") ? "json" : (output === "quickbooks") ? "zip" : "csv";
        filename = `mapleschema_${output}.${ext}`;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      showError(e?.message || "Unexpected error during convert.", null);
    } finally {
      if (btn) btn.textContent = prevText || "TRANSFORM";
      // Re-enable if file still selected + still authed
      const authed = !!firebase.auth().currentUser;
      const fileStillThere = !!$("fileInput")?.files?.[0];
      setDisabled(btn, !(authed && fileStillThere));
    }
  }

  // ---- Wiring ----
  function wireButtons() {
    $("btnSignIn")?.addEventListener("click", async () => {
      clearError();
      await ensureGoogleSignInOrSubscribe();
      // auth state listener will update UI
    });

    $("btnSignOut")?.addEventListener("click", async () => {
      clearError();
      try {
        await firebase.auth().signOut();
      } catch (e) {
        showError("Sign out failed.", null);
      }
    });

    $("btnConvert")?.addEventListener("click", async () => {
      await doConvert();
    });

    document.addEventListener("change", (e) => {
      if (e.target && e.target.name === "msOutput") syncInsightsUI();
    });
  }

  function wireAuthState() {
    firebase.auth().onAuthStateChanged(async (user) => {
      clearError();

      if (!user) {
        setSignedOutUI();
        return;
      }

      setSignedInUI(user.email || "");

      // Populate routing dropdowns (optional). If none exist, we hide them.
      try {
        const idToken = await user.getIdToken();
        await populateRoutingDropdowns(idToken);
      } catch {
        // If routing endpoints don't exist, hide the row
        updateRoutingVisibility();
      }

      // Enable convert if file is already selected
      const fileSelected = !!$("fileInput")?.files?.[0];
      setDisabled($("btnConvert"), !(fileSelected));
    });
  }

  // ---- Boot ----
  document.addEventListener("DOMContentLoaded", () => {
    clearError();

    // Ensure Firebase is live
    if (!initFirebaseOnce()) return;

    // Initial UI
    setSignedOutUI();

    // Wire everything
    wireButtons();
    wireFileInput();
    syncInsightsUI();
    updateRoutingVisibility();
    wireAuthState();
  });
})();
