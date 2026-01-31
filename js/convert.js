// /js/convert.js
(() => {
  // -----------------------
  // Env + constants
  // -----------------------
  const API_BASE = (window.MAPLE_API_BASE || "https://api.mapleschema.com").replace(/\/+$/, "");
  const ORIGIN = (window.location && window.location.origin) ? window.location.origin : "https://mapleschema.com";

  // -----------------------
  // DOM helpers
  // -----------------------
  const $ = (id) => document.getElementById(id);

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

  const hasConverterUI =
    !!fileInput && !!convertBtn && !!signInBtn && !!signOutBtn && !!errorBox && !!errorText;

  // -----------------------
  // State
  // -----------------------
  let currentUser = null;

  // File buttons (injected)
  let chooseBtn = null;
  let removeBtn = null;

  // -----------------------
  // UI helpers
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
    return sel && sel.options && sel.options.length > 1;
  }

  function updateRoutingVisibility() {
    if (!routingWrap) return;
    if (!hasRealOptions(aggSelect) && !hasRealOptions(bankSelect)) {
      routingWrap.style.display = "none";
      return;
    }
    routingWrap.style.display = "grid";
  }

  // Find the dashed upload box (best-effort, based on inline style)
  function findUploadBox() {
    if (!fileInput) return null;
    let el = fileInput.parentElement;
    for (let i = 0; i < 10 && el; i++) {
      const style = (el.getAttribute && el.getAttribute("style")) ? el.getAttribute("style") : "";
      if (style && style.includes("dashed")) return el;
      el = el.parentElement;
    }
    return null;
  }

  const uploadBox = findUploadBox();
  let selectedPillEl = null;

  function ensureSelectedPill() {
    if (selectedPillEl || !uploadBox) return;
    selectedPillEl = document.createElement("div");
    selectedPillEl.textContent = "Selected ✓";
    selectedPillEl.style.cssText = `
      display:none;
      margin-bottom:10px;
      width: fit-content;
      padding: 6px 10px;
      border-radius: 999px;
      font-weight: 800;
      font-size: 0.85rem;
      letter-spacing: 0.02em;
      border: 1px solid rgba(44,160,28,0.45);
      background: rgba(44,160,28,0.10);
      color: rgba(20,70,20,0.95);
    `;
    uploadBox.prepend(selectedPillEl);
  }

  function formatFileSize(bytes) {
    if (!Number.isFinite(bytes)) return "";
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    return `${mb.toFixed(2)} MB`;
  }

  function setUploadSelectedUI(file) {
    if (!hasConverterUI) return;

    ensureSelectedPill();

    if (!file) {
      if (fileNameEl) fileNameEl.textContent = "No file selected";

      if (selectedPillEl) selectedPillEl.style.display = "none";
      if (uploadBox) {
        uploadBox.style.border = "1px dashed rgba(120,80,50,0.35)";
        uploadBox.style.background = "rgba(255,255,255,0.35)";
      }

      if (chooseBtn) chooseBtn.textContent = "Choose file";
      if (removeBtn) removeBtn.style.display = "none";
      return;
    }

    const sizeLabel = formatFileSize(file.size);
    if (fileNameEl) fileNameEl.textContent = `${file.name}${sizeLabel ? ` • ${sizeLabel}` : ""}`;

    if (selectedPillEl) selectedPillEl.style.display = "inline-flex";
    if (uploadBox) {
      uploadBox.style.border = "1px solid rgba(44,160,28,0.55)";
      uploadBox.style.background = "rgba(44,160,28,0.08)";
    }

    if (chooseBtn) chooseBtn.textContent = "Change file";
    if (removeBtn) removeBtn.style.display = "inline-flex";
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

    setUploadSelectedUI(null);
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

    const hasFile = !!fileInput?.files?.length;
    if (convertBtn) convertBtn.disabled = !hasFile;

    if (hasFile) setUploadSelectedUI(fileInput.files[0]);
  }

  function setBusy(isBusy) {
    if (!convertBtn) return;
    const hasFile = !!fileInput?.files?.length;
    convertBtn.disabled = isBusy || !currentUser || !hasFile;
    convertBtn.textContent = isBusy ? "CONVERTING..." : "CONVERT";
  }

  // -----------------------
  // File button injection
  // -----------------------
  function styleActionButton(btn, kind = "primary") {
    // Keep it consistent with your page without relying on external classes.
    if (!btn) return;
    const base = `
      display:inline-flex;
      align-items:center;
      justify-content:center;
      gap:8px;
      padding: 8px 14px;
      border-radius: 10px;
      border: 1px solid rgba(0,0,0,0.15);
      cursor: pointer;
      font-weight: 800;
      font-size: 0.9rem;
      user-select:none;
      white-space:nowrap;
    `;
    const primary = `background: rgba(255,255,255,0.85);`;
    const secondary = `background: rgba(0,0,0,0.06);`;
    btn.style.cssText = base + (kind === "secondary" ? secondary : primary);
  }

  function injectFileButtons() {
    if (!hasConverterUI || !fileInput) return;

    // Put buttons where the native file input currently sits.
    const host = fileInput.parentElement;
    if (!host) return;

    // Hide the native input, but keep it functional.
    fileInput.style.position = "absolute";
    fileInput.style.left = "-9999px";
    fileInput.style.width = "1px";
    fileInput.style.height = "1px";
    fileInput.style.opacity = "0";

    chooseBtn = document.createElement("button");
    chooseBtn.type = "button";
    chooseBtn.textContent = "Choose file";
    styleActionButton(chooseBtn, "primary");

    removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "Remove";
    styleActionButton(removeBtn, "secondary");
    removeBtn.style.display = "none";

    // Insert buttons before the hidden input.
    host.insertBefore(removeBtn, fileInput);
    host.insertBefore(chooseBtn, removeBtn);

    chooseBtn.addEventListener("click", () => {
      if (fileInput.disabled) return;
      fileInput.click();
    });

    removeBtn.addEventListener("click", () => {
      clearError();
      // Clearing file input reliably: set value to empty string.
      fileInput.value = "";
      setUploadSelectedUI(null);
      if (convertBtn) convertBtn.disabled = !currentUser;
    });
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

    return { aggregator_code, institution_code, transactions };
  }

  // -----------------------
  // Error parsing helpers
  // -----------------------
  function safeTrim(s, max = 800) {
    if (!s) return "";
    const t = String(s);
    return t.length > max ? `${t.slice(0, max)}…` : t;
  }

  async function readErrorBody(res) {
    const ct = (res.headers.get("Content-Type") || "").toLowerCase();

    if (ct.includes("application/json")) {
      try {
        const j = await res.json();
        const msg = j?.error?.message || j?.message || "";
        const rid = j?.error?.request_id || "";
        return { msg, requestId: rid };
      } catch {
        // fallthrough
      }
    }

    try {
      const text = await res.text();
      return { msg: safeTrim(text), requestId: "" };
    } catch {
      return { msg: "", requestId: "" };
    }
  }

  // -----------------------
  // Firebase wiring
  // -----------------------
  function ensureFirebaseSDKPresent() {
    return typeof window.firebase !== "undefined"
      && window.firebase
      && typeof window.firebase.initializeApp === "function";
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
    if (!window.firebase.apps || window.firebase.apps.length === 0) {
      window.firebase.initializeApp(cfg);
    }
    return true;
  }

  async function initFirebaseAuthBindings() {
    const ok = initFirebaseAppOnce();
    if (!ok) return;

    window.firebase.auth().onAuthStateChanged((user) => {
      if (hasConverterUI) clearError();

      if (!user) {
        currentUser = null;
        if (hasConverterUI) setSignedOutUI();
        return;
      }

      currentUser = user;
      if (hasConverterUI) setSignedInUI(user);
    });

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
  // Convert handler
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

      const url = `${API_BASE}/v1/core/csv`;

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${idToken}`,
          "Content-Type": "application/json",
          "X-Client-Origin": ORIGIN,
        },
        body: JSON.stringify(body),
      });

      const requestId = res.headers.get("X-Request-Id") || "";

      if (!res.ok) {
        const parsedErr = await readErrorBody(res);

        if (res.status === 404) {
          const extra = parsedErr.msg ? `\n\nResponse: ${parsedErr.msg}` : "";
          setError(
            `Convert failed (HTTP 404).\nEndpoint not found.\n\nURL: ${url}${extra}`,
            requestId || parsedErr.requestId || ""
          );
          return;
        }

        const msg = safeTrim(parsedErr.msg || `Convert failed (HTTP ${res.status}).`, 600);
        setError(`${msg}\n\nURL: ${url}`, requestId || parsedErr.requestId || "");
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
    await initFirebaseAuthBindings();

    if (!hasConverterUI) return;

    setSignedOutUI();
    clearError();
    updateRoutingVisibility();

    ensureSelectedPill();
    injectFileButtons();

    if (fileInput) {
      fileInput.addEventListener("change", () => {
        clearError();
        const f = fileInput.files?.[0] || null;

        setUploadSelectedUI(f);

        if (convertBtn) convertBtn.disabled = !currentUser || !f;
      });
    }

    if (convertBtn) {
      convertBtn.addEventListener("click", handleConvertClick);
    }
  });
})();
