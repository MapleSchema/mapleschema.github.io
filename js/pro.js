/* /js/pro.js
   MapleSchema Pro page logic
   - Auth (Google via Firebase compat) with exclusive signed-in / signed-out UI
   - Populate routing dropdowns (aggregator/bank) if available
   - Hide routing UI if empty
   - Upload + convert using paid endpoints
*/

(() => {
  // ---- Config ----
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
      if (!firebase.apps || firebase.apps.length === 0) {
        firebase.initializeApp(window.MAPLE_FIREBASE_CONFIG);
      }
      return true;
    } catch {
      return true; // already initialized
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
    if (!insights || !label) return;

    const enabled = (out === "csv" || out === "json");
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

    const aggHasOptions = aggSelect.options.length > 1;   // "(none)" + something
    const instHasOptions = instSelect.options.length > 1;

    if (aggWrap) aggWrap.style.display = aggHasOptions ? "" : "none";
    if (instWrap) instWrap.style.display = instHasOptions ? "" : "none";

    routingWrap.style.display = (aggHasOptions || instHasOptions) ? "grid" : "none";
    routingWrap.style.gridTemplateColumns = (aggHasOptions && instHasOptions) ? "1fr 1fr" : "1fr";
  }

  // ---- Populate routing selects (optional) ----
  async function tryFetchJson(path, idToken) {
    const url = `${API_BASE}${path}`;
    const headers = idToken ? { Authorization: `Bearer ${idToken}` } : {};
    const resp = await fetch(url, { headers });
    if (!resp.ok) return null;
    return await resp.json();
  }

  function fillSelect(selectEl, items, placeholderText = "(none)") {
    if (!selectEl) return;

    selectEl.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = placeholderText;
    selectEl.appendChild(opt0);

    if (!Array.isArray(items)) return;

    for (const it of items) {
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

    // Start empty (then hide if stays empty)
    fillSelect(aggSelect, [], "(none)");
    fillSelect(instSelect, [], "(none)");

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

        const arr = Array.isArray(data)
          ? data
          : (data.items || data.aggregators || data.institutions || null);

        if (!Array.isArray(arr)) continue;

        if (c.kind === "aggregators") aggregators = arr;
        if (c.kind === "institutions") institutions = arr;

        if (aggregators && institutions) break;
      } catch {
        // ignore
      }
    }

    if (aggregators) fillSelect(aggSelect, aggregators, "(none)");
    if (institutions) fillSelect(instSelect, institutions, "(none)");

    updateRoutingVisibility();
  }

  // ---- Auth (exclusive UI state) ----
  function setSignedOutUI() {
    // These must exist in your updated HTML section
    if ($("authSignedOut")) $("authSignedOut").style.display = "flex";
    if ($("authSignedIn")) $("authSignedIn").style.display = "none";
    setText($("authEmail"), "");

    setDisabled($("fileInput"), true);
    setDisabled($("btnConvert"), true);

    // If routing stays empty, keep it hidden
    updateRoutingVisibility();
  }

  function setSignedInUI(email) {
    if ($("authSignedOut")) $("authSignedOut").style.display = "none";
    if ($("authSignedIn")) $("authSignedIn").style.display = "flex";
    setText($("authEmail"), email || "");

    setDisabled($("fileInput"), false);

    // Convert enabled only when file is selected (wireFileInput handles it too)
    const fileSelected = !!$("fileInput")?.files?.[0];
    setDisabled($("btnConvert"), !fileSelected);
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
    const user = firebase.auth().currentUser;
    if (!user) throw new Error("Not signed in");
    return await user.getIdToken(true);
  }

  // ---- File handling ----
  function wireFileInput() {
    const fileInput = $("fileInput");
    if (!fileInput) return;

    fileInput.addEventListener("change", () => {
      clearError();
      const f = fileInput.files && fileInput.files[0];
      setText($("fileName"), f ? f.name : "No file selected");

      const authed = !!firebase.auth().currentUser;
      setDisabled($("btnConvert"), !(authed && !!f));
    });
  }

  // ---- Convert ----
  function selectedRouting() {
    return {
      aggregatorCode: $("aggregatorCode")?.value || "",
      institutionCode: $("institutionCode")?.value || "",
    };
  }

  async function doConvert() {
    clearError();

    const user = await ensureGoogleSignInOrSubscribe();
    if (!user) return;

    const idToken = await getIdTokenOrThrow();

    const file = $("fileInput")?.files?.[0];
    if (!file) {
      showError("Please choose a JSON file first.", null);
      return;
    }

    const output = msSelectedOutput();
    const endpoint = msEndpointFor(output);
    const includeInsights = $("msInsights")?.checked === true;

    const { aggregatorCode, institutionCode } = selectedRouting();

    const fd = new FormData();
    fd.append("file", file, file.name);
    fd.append("output", output);
    fd.append("insights", includeInsights ? "true" : "false");
    if (aggregatorCode) fd.append("aggregator_code", aggregatorCode);
    if (institutionCode) fd.append("institution_code", institutionCode);

    const btn = $("btnConvert");
    const prevText = btn?.textContent || "TRANSFORM";
    setDisabled(btn, true);
    if (btn) btn.textContent = "WORKING…";

    try {
      const resp = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: fd,
      });

      if (resp.status === 401 || resp.status === 403 || resp.status === 402) {
        window.location.href = SUBSCRIBE_URL;
        return;
      }

      const requestId =
        resp.headers.get("x-request-id") ||
        resp.headers.get("x-maple-request-id") ||
        "";

      if (!resp.ok) {
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

      const blob = await resp.blob();

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
      if (btn) btn.textContent = prevText;
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
    });

    $("btnSignOut")?.addEventListener("click", async () => {
      clearError();
      try {
        await firebase.auth().signOut();
      } catch {
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

      try {
        const idToken = await user.getIdToken();
        await populateRoutingDropdowns(idToken);
      } catch {
        updateRoutingVisibility();
      }
    });
  }

  // ---- Boot ----
  document.addEventListener("DOMContentLoaded", () => {
    clearError();
    if (!initFirebaseOnce()) return;

    wireButtons();
    wireFileInput();
    syncInsightsUI();

    // Initial state (before Firebase callback fires)
    setSignedOutUI();

    wireAuthState();
  });
})();
