// /js/convert.js
(() => {
  const API_BASE = "https://api.mapleschema.com";
  const ORIGIN_HINT = "https://mapleschema.com"; // informational only

  // --- DOM helpers
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

  const signInWrap = document.getElementById("signInWrap");
  const signedInCard = document.getElementById("signedInCard");

  
  // --- State
  let currentUser = null;

  function setError(message, requestId = "") {
    errorBox.style.display = "block";
    errorText.textContent = message;
    requestIdEl.textContent = requestId ? `Request ID: ${requestId}` : "";
  }

  function clearError() {
    errorBox.style.display = "none";
    errorText.textContent = "";
    requestIdEl.textContent = "";
  }

  function setSignedOutUI() {
    currentUser = null;
    statusEl.textContent = "Not signed in";
    emailEl.textContent = "";
  
    // Toggle auth UI
    if (signInWrap) signInWrap.style.display = "block";
    if (signedInCard) signedInCard.style.display = "none";
    signInBtn.disabled = false;
    signOutBtn.disabled = true;
    signOutBtn.style.display = "none";
  
    fileInput.disabled = true;
    convertBtn.disabled = true;
    fileNameEl.textContent = "No file selected";
  }


  function setSignedInUI(user) {
    currentUser = user;
    statusEl.textContent = "Signed in";
    emailEl.textContent = user?.email || "";
  
    // Toggle auth UI
    if (signInWrap) signInWrap.style.display = "none";
    if (signedInCard) signedInCard.style.display = "block";
    signInBtn.disabled = true;
    signOutBtn.disabled = false;
    signOutBtn.style.display = "inline-flex";
  
    fileInput.disabled = false;
    convertBtn.disabled = !fileInput.files?.length;
  }


  function setBusy(isBusy) {
    convertBtn.disabled = isBusy || !currentUser || !fileInput.files?.length;
    convertBtn.textContent = isBusy ? "Converting..." : "Convert to CSV";
  }

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
    } catch (e) {
      throw new Error("File is not valid JSON.");
    }
  }

  function buildConvertRequestBody(parsedJson) {
    // Your backend accepts aggregator_code and institution_code as optional now.
    // Dropdowns supply either "" or a supported code.
    const aggregator_code = (aggSelect?.value ?? "").trim();
    const institution_code = (bankSelect?.value ?? "").trim();

    // For now, we assume the uploaded JSON is already in the "transactions" array shape
    // your API expects (or close enough for the general mapper).
    //
    // If the file is a top-level array, treat it as transactions.
    // If the file is an object with `transactions`, use that.
    // Otherwise, attempt to locate a common UK OB style path: Data.Transaction.
    let transactions = null;

    if (Array.isArray(parsedJson)) {
      transactions = parsedJson;
    } else if (parsedJson && Array.isArray(parsedJson.transactions)) {
      transactions = parsedJson.transactions;
    } else if (parsedJson && parsedJson.Data && Array.isArray(parsedJson.Data.Transaction)) {
      // UK OB sample shape
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
      transactions
    };
  }

  // --- Firebase wiring (loaded from CDN in HTML)
  async function initFirebase() {
    // Expect window.MAPLE_FIREBASE_CONFIG to be defined in HTML.
    const cfg = window.MAPLE_FIREBASE_CONFIG;
    if (!cfg) {
      setError("Firebase config missing. MAPLE_FIREBASE_CONFIG is not defined.");
      return;
    }

    // firebase.* comes from compat scripts for simplicity on a static site
    firebase.initializeApp(cfg);

    firebase.auth().onAuthStateChanged((user) => {
      clearError();
      if (!user) {
        setSignedOutUI();
        return;
      }
      setSignedInUI(user);
    });

    signInBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      clearError();
      try {
        const provider = new firebase.auth.GoogleAuthProvider();
        await firebase.auth().signInWithPopup(provider);
      } catch (err) {
        setError(err?.message || "Sign-in failed.");
      }
    });

    signOutBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      clearError();
      try {
        await firebase.auth().signOut();
      } catch (err) {
        setError(err?.message || "Sign-out failed.");
      }
    });
  }

  async function handleConvertClick(e) {
    e.preventDefault();
    clearError();

    if (!currentUser) {
      setError("Please sign in first.");
      return;
    }
    const file = fileInput.files?.[0];
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
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const requestId = res.headers.get("X-Request-Id") || "";

      if (!res.ok) {
        // attempt JSON error envelope
        let msg = `Convert failed (HTTP ${res.status}).`;
        try {
          const j = await res.json();
          msg = j?.error?.message || msg;
        } catch (_) {}
        setError(msg, requestId);
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

  function initUI() {
    // default UI
    setSignedOutUI();
    clearError();

    fileInput.addEventListener("change", () => {
      clearError();
      const f = fileInput.files?.[0];
      fileNameEl.textContent = f ? f.name : "No file selected";
      convertBtn.disabled = !currentUser || !f;
    });

    convertBtn.addEventListener("click", handleConvertClick);
  }

  // Boot
  document.addEventListener("DOMContentLoaded", async () => {
    initUI();
    await initFirebase();
  });
})();
