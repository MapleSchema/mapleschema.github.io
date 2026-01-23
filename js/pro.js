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
