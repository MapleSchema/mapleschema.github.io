// /js/convert.js
(() => {
  // -----------------------
  // Env + constants
  // -----------------------
  const API_BASE = (window.MAPLE_API_BASE || "https://api.mapleschema.com").replace(/\/+$/, "");
  const ORIGIN_HINT = (window.location && window.location.origin) ? window.location.origin : "https://mapleschema.com";

  // -----------------------
  // DOM helpers
  // -----------------------
  const $ = (id) => document.getElementById(id);

  // Converter/auth UI elements (may be missing on non-convert pages)
  const statusEl = $("authStatus");
  const emailEl = $("authEmail");
  const signInBtn = $("btnSignIn");
  const signOutBtn = $("btnSignOut");

  const aggSelect = $("aggregatorCode");
  const bankSelect = $("institutionCode");

  const fileInput = $("fileInput");
  const fileNameEl = $("fileName");
  const convertBtn = $("btnConvert");
  const errorBox = $("errorBox");
  const errorText = $("errorText");
  const requestIdEl = $("requestId");

  const signInWrap = $("signInWrap");
  const signedInCard = $("signedInCard");
  const routingWrap = $("routingWrap");

  // -----------------------
  // Page detection
  // -----------------------
  // Only enable converter UI wiring if the expected converter elements exist.
  const hasConverterUI =
    !!fileInput && !!convertBtn && !!signInBtn && !!signOutBtn && !!errorBox && !!errorText;

  // -----------------------
  // State
  // -----------------------
  let currentUser = null;

  // -----------------------
  // UI helpers (no-ops if UI not present)
  // -----------------------
  function setError(message, requestId = "") {
    if (!errorBox || !errorText) return;
    errorBox.style.display = "block";
    errorText.textContent = message || "Unknown error.";
    if (requestIdEl) requestIdEl.textContent = requestId ? `Request ID: ${requestId}` : "";
  }

  function clearError() {
    if (!errorBox || !errorText) return;
    errorBox.style.display = "none";
    errorText.textContent = "";
    if (requestIdEl) requestIdEl.textContent = "";
  }

  function hasRealOptions(sel) {
    return sel && sel.options && sel.options.length > 1; // placeholder + real options
  }

  function updateRoutingVisibility() {
    if (!routingWrap) return;

    // Hide if neither dropdown has any real options.
    if (!hasRealOptions(aggSelect) && !hasRealOptions(bankSelect)) {
      routingWrap.style.display = "none";
      return;
    }

    routingWrap.style.display = "grid";
  }

  function setSignedOutUI() {
    currentUser = null;

    if (statusEl) statusEl.textContent = "Not signed in";
    if (emailEl) emailEl.textContent = "";

    if (signInWrap) signInWrap.style.display = "block";
    if (signedInCard) signedInCard.style.display = "none";

    if (signInBtn) signInBtn.disabled = false;
    if (signOutBtn) {
      signOutBtn.disabled = true;
      signOutBtn.style.display = "none";
    }

    if (fileInput) fileInput.disabled = true;
    if (convertBtn) convertBtn.disabled = true;
    if (fileNameEl) fileNameEl.textContent = "No file selected";
  }

  function setSignedInUI(user) {
    currentUser = user;

    if (statusEl) statusEl.textContent = "Signed in";
    if (emailEl) emailEl.textContent = user?.email || "";

    if (signInWrap) signInWrap.style.display = "none";
    if (signedInCard) signedInCard.style.display = "block";

    if (signInBtn) signInBtn.disabled = true;
    if (signOutBtn) {
      signOutBtn.disabled = false;
      signOutBtn.style.display = "inline-flex";
    }

    if (fileInput) fileInput.disabled = false;
    if (convertBtn) convertBtn.disabled = !fileInput?.files?.length;
  }

  function setBusy(isBusy) {
    if (!convertBtn) return;
    convertBtn.disabled = isBusy || !currentUser || !fileInput?.files?.length;
    convertBtn.textContent = isBusy ? "Converting..." : "Convert to CSV";
  }

  // -----------------------
  // File / download helpers
  // -----------------------
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "mapleschema.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function parseFilenameFromContentDisposition(cd) {
    if (!cd) return "";
    // handles: attachment; filename="mapleschema.csv"
    const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(cd);
    if (!match) return "";
    return decodeURIComponent(match[1].replace(/"/g, "").trim());
  }

  async function readFileAsJSON(file) {
    const text = await file.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("File is not valid JSON.");
    }
  }

  function buildConvertRequestBody(parsedJson) {
    const aggregator_code = (aggSelect?.value ?? "").trim();
    const institution_code = (bankSelect?.value ?? "").trim();

    let transactions = null;

    if (Array.isArray(parsedJson)) {
      transactions = parsedJson;
    } else if (parsedJson && Array.isArray(parsedJson.transactions)) {
      transactions = parsedJson.transactions;
    } else if (parsedJson && parsedJson.Data && Array.isArray(parsedJson.Data.Transaction)) {
      transactions = parsedJson.Data.Transaction;
    }

    if (!transactions || !transactions.length) {
      throw new Error(
        "Could not find a transactions array in the uploaded JSON. Expected an array, or an object with `transactions`, or UK OB `Data.Transaction`."
      );
    }

    return {
      aggregator_code,
      institution_code,
      transactions,
    };
  }

  // -----------------------
  // Firebase wiring
  // -----------------------
  function ensureFirebaseSDKPresent() {
    // compat SDK exposes global `firebase`
    return typeof window.firebase !== "undefined" && window.firebase && typeof window.firebase.initializeApp === "function";
  }

  function initFirebaseAppOnce() {
    const cfg = window.MAPLE_FIREBASE_CONFIG;
    if (!cfg) {
      setError("Firebase config missing. MAPLE_FIREBASE_CONFIG is not defined.");
      return false;
    }
    if (!ensureFirebaseSDKPresent()) {
      setError("Firebase SDK missing. Ensure firebase-app-compat.js and firebase-auth-compat.js are loaded.");
      return false;
    }

    // Prevent "Firebase App named '[DEFAULT]' already exists"
    if (!window.firebase.apps || window.firebase.apps.length === 0) {
      window.firebase.initializeApp(cfg);
    }

    return true;
  }

  async function initFirebaseAuthBindings() {
    const ok = initFirebaseAppOnce();
    if (!ok) return;

    // Listen for auth changes globally (works on any page)
    window.firebase.auth().onAuthStateChanged((user) => {
      // Don't clear error on every page unless converter UI exists (avoid hiding unrelated errors)
      if (hasConverterUI) clearError();

      if (!user) {
        if (hasConverterUI) setSignedOutUI();
        currentUser = null;
        return;
      }

      currentUser = user;
      if (hasConverterUI) setSignedInUI(user);
    });

    // Only wire buttons if present
    if (signInBtn) {
      signInBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        if (hasConverterUI) clearError();
        try {
          const provider = new window.firebase.auth.GoogleAuthProvider();
          await window.firebase.auth().signInWithPopup(provider);
        } catch (err) {
          setError(err?.message || "Sign-in failed.");
        }
      });
    }

    if (signOutBtn) {
      signOutBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        if (hasConverterUI) clearError();
        try {
          await window.firebase.auth().signOut();
        } catch (err) {
          setError(err?.message || "Sign-out failed.");
        }
      });
    }
  }

  // -----------------------
  // Converter handler
  // -----------------------
  async function handleConvertClick(e) {
    e.preventDefault();
    clearError();

    if (!currentUser) {
      setError("Please sign in first.");
      return;
    }

    const file = fileInput?.files?.[0];
    if (!file) {
      setError("Please choose a JSON file first.");
      return;
    }

    setBusy(true);

    try {
      const idToken = await currentUser.getIdToken(true);

      const parsed = await readFileAsJSON(file);
      const body = buildConvertRequestBody(parsed);

      const res = await fetch(`${API_BASE}/v1/transactions/convert`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${idToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });

      const requestId = res.headers.get("X-Request-Id") || "";

      if (!res.ok) {
        let msg = `Convert failed (HTTP ${res.status}).`;
        let rid = requestId;

        try {
          const j = await res.json();
          msg = j?.error?.message || msg;
          rid = j?.error?.request_id || rid;
        } catch (_) {}

        setError(msg, rid);
        return;
      }

      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition");
      const filename = parseFilenameFromContentDisposition(cd) || "mapleschema.csv";
      downloadBlob(blob, filename);

    } catch (err) {
      setError(err?.message || "Unexpected error during conversion.");
    } finally {
      setBusy(false);
    }
  }

  // -----------------------
  // Boot
  // -----------------------
  document.addEventListener("DOMContentLoaded", async () => {
    // Always initialize Firebase (so other pages can rely on auth state)
    await initFirebaseAuthBindings();

    // Only initialize converter UI if present
    if (!hasConverterUI) return;

    setSignedOutUI();
    clearError();
    updateRoutingVisibility();

    if (fileInput) {
      fileInput.addEventListener("change", () => {
        clearError();
        const f = fileInput.files?.[0];
        if (fileNameEl) fileNameEl.textContent = f ? f.name : "No file selected";
        if (convertBtn) convertBtn.disabled = !currentUser || !f;
      });
    }

    if (convertBtn) {
      convertBtn.addEventListener("click", handleConvertClick);
    }
  });
})();
