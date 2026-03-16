const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const loginMessage = document.getElementById("login-message");
const registerMessage = document.getElementById("register-message");

function showMessage(element, text, type = "") {
  element.textContent = text;
  element.className = `message ${type}`.trim();
}

async function requestJson(url, options = {}, fallbackMessage) {
  const response = await fetch(url, options);
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : {};

  if (!response.ok) {
    throw new Error(payload.error || fallbackMessage);
  }

  return payload;
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage(loginMessage, "");

  const formData = new FormData(loginForm);

  try {
    await requestJson(
      "/api/auth/login",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: String(formData.get("username") || "").trim(),
          password: String(formData.get("password") || "")
        })
      },
      "Could not sign in"
    );

    window.location.href = "/app";
  } catch (error) {
    showMessage(loginMessage, error.message, "error");
  }
});

registerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage(registerMessage, "");

  const formData = new FormData(registerForm);

  try {
    await requestJson(
      "/api/auth/register",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: String(formData.get("username") || "").trim(),
          password: String(formData.get("password") || ""),
          displayName: String(formData.get("displayName") || "").trim(),
          experienceLevel: String(formData.get("experienceLevel") || "").trim(),
          favoriteLift: String(formData.get("favoriteLift") || "").trim(),
          availability: String(formData.get("availability") || "").trim(),
          bio: String(formData.get("bio") || "").trim()
        })
      },
      "Could not create account"
    );

    window.location.href = "/app";
  } catch (error) {
    showMessage(registerMessage, error.message, "error");
  }
});
