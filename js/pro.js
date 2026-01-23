function msSelectedOutput() {
  return document.querySelector('input[name="msOutput"]:checked')?.value || "csv";
}

function msEndpointFor(output) {
  if (output === "json") return "/v1/full/json";
  if (output === "quickbooks") return "/v1/full/quickbooks";
  return "/v1/full/csv";
}

async function ensureGoogleSignInOrSubscribe() {
  try {
    const auth = firebase.auth();
    if (auth.currentUser) return auth.currentUser;

    const provider = new firebase.auth.GoogleAuthProvider();
    const result = await auth.signInWithPopup(provider);
    return result.user;
  } catch (e) {
    // user closed popup / blocked / cancelled
    window.location.href = "/subscribe.html";
    throw e;
  }
}
function updateRoutingVisibility() {
  const aggSelect = document.getElementById("aggregatorCode");
  const instSelect = document.getElementById("institutionCode");

  const aggWrap = document.getElementById("aggregatorWrap");
  const instWrap = document.getElementById("institutionWrap");
  const routingWrap = document.getElementById("routingWrap");

  if (!aggSelect || !instSelect || !routingWrap) return;

  const aggHasOptions = aggSelect.options.length > 1;
  const instHasOptions = instSelect.options.length > 1;

  // Hide individual fields if empty
  if (aggWrap) aggWrap.style.display = aggHasOptions ? "" : "none";
  if (instWrap) instWrap.style.display = instHasOptions ? "" : "none";

  // Hide entire row if both are empty
  routingWrap.style.display = (aggHasOptions || instHasOptions) ? "grid" : "none";
}
