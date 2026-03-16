const createForm = document.getElementById("create-form");
const refreshBtn = document.getElementById("refresh-btn");
const logoutBtn = document.getElementById("logout-btn");
const createMessage = document.getElementById("create-message");
const sessionsMessage = document.getElementById("sessions-message");
const profileName = document.getElementById("profile-name");
const profileUsername = document.getElementById("profile-username");
const profileSummary = document.getElementById("profile-summary");
const profileDetails = document.getElementById("profile-details");
const sessionProfileHint = document.getElementById("session-profile-hint");
const sessionsContainer = document.getElementById("sessions");
const sessionTemplate = document.getElementById("session-template");

const state = {
  me: null,
  sessions: []
};

function showMessage(element, text, type = "") {
  element.textContent = text;
  element.className = `message ${type}`.trim();
}

function formatDate(iso) {
  const date = new Date(iso);
  return date.toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

async function requestJson(url, options = {}, fallbackMessage) {
  const response = await fetch(url, options);
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await response.json() : {};

  if (response.status === 401) {
    window.location.href = "/auth";
    throw new Error("sign in required");
  }

  if (!response.ok) {
    throw new Error(payload.error || fallbackMessage);
  }

  return payload;
}

function renderMe() {
  if (!state.me) {
    return;
  }

  const details = [
    state.me.experience_level || "Any level",
    state.me.favorite_lift ? `Favorite lift: ${state.me.favorite_lift}` : "Open to any workout",
    state.me.availability || "Flexible schedule"
  ];

  profileName.textContent = state.me.display_name;
  profileUsername.textContent = `@${state.me.username}`;
  profileSummary.textContent = state.me.bio || "No bio yet. Your Spottr profile is ready for the next session.";
  profileDetails.textContent = details.join(" • ");
  sessionProfileHint.textContent = `Posting as ${state.me.display_name}.`;
}

function buildHostDetails(session) {
  const details = [];

  if (session.host_username) {
    details.push(`@${session.host_username}`);
  }

  if (session.host_experience_level) {
    details.push(session.host_experience_level);
  }

  if (session.host_favorite_lift) {
    details.push(`Favorite lift: ${session.host_favorite_lift}`);
  }

  return details.length > 0 ? details.join(" • ") : "Host details are not available for this session.";
}

function buildCrewText(session) {
  const names = [session.host_name, ...(session.students || []).map((student) => student.student_name)];
  const attendingCount = Number(session.joined_count) + 1;
  return `Crew ${attendingCount}/${session.capacity}: ${names.join(", ")}`;
}

function renderSessions() {
  if (!state.me) {
    return;
  }

  sessionsContainer.innerHTML = "";

  if (state.sessions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No sessions yet. Be the first to post one.";
    sessionsContainer.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const session of state.sessions) {
    const node = sessionTemplate.content.cloneNode(true);
    const joinButton = node.querySelector(".join-btn");
    const joinContext = node.querySelector(".join-context");
    const attendingCount = Number(session.joined_count) + 1;
    const alreadyInSession =
      session.host_user_id === state.me.id || (session.students || []).some((student) => student.user_id === state.me.id);

    node.querySelector(".workout").textContent = session.workout_type;
    node.querySelector(".time").textContent = formatDate(session.start_time);
    node.querySelector(".meta").textContent = `Hosted by ${session.host_name}`;
    node.querySelector(".host-details").textContent = buildHostDetails(session);
    node.querySelector(".notes").textContent = session.notes || "No notes";
    node.querySelector(".joined").textContent = buildCrewText(session);

    if (alreadyInSession) {
      joinButton.disabled = true;
      joinButton.textContent = session.host_user_id === state.me.id ? "Hosting" : "Joined";
      joinContext.textContent =
        session.host_user_id === state.me.id
          ? "You already own this session."
          : `Joined as ${state.me.display_name}.`;
    } else if (attendingCount >= session.capacity) {
      joinButton.disabled = true;
      joinButton.textContent = "Full";
      joinContext.textContent = "This session is already full.";
    } else {
      joinContext.textContent = `Join as ${state.me.display_name}.`;
      joinButton.addEventListener("click", async () => {
        joinButton.disabled = true;
        joinButton.textContent = "Joining...";

        try {
          await requestJson(
            `/api/sessions/${session.id}/join`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({})
            },
            "Could not join session"
          );

          showMessage(sessionsMessage, `Joined ${session.workout_type} with ${session.host_name}.`, "success");
          await loadSessions();
        } catch (error) {
          showMessage(sessionsMessage, error.message, "error");
          joinButton.disabled = false;
          joinButton.textContent = "Join session";
        }
      });
    }

    fragment.appendChild(node);
  }

  sessionsContainer.appendChild(fragment);
}

async function loadMe() {
  const data = await requestJson("/api/me", {}, "Could not load your account");
  state.me = data.user;
  renderMe();
  renderSessions();
}

async function loadSessions() {
  const data = await requestJson("/api/sessions", {}, "Could not load sessions");
  state.sessions = data.sessions || [];
  renderSessions();
}

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage(createMessage, "");

  const formData = new FormData(createForm);
  const localTime = String(formData.get("startTimeLocal") || "").trim();

  if (!localTime) {
    showMessage(createMessage, "Please select a start time.", "error");
    return;
  }

  try {
    await requestJson(
      "/api/sessions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workoutType: String(formData.get("workoutType") || "").trim(),
          startTime: new Date(localTime).toISOString(),
          notes: String(formData.get("notes") || "").trim(),
          capacity: Number(formData.get("capacity"))
        })
      },
      "Could not create session"
    );

    createForm.reset();
    showMessage(createMessage, `Session posted as ${state.me.display_name}.`, "success");
    await loadSessions();
  } catch (error) {
    showMessage(createMessage, error.message, "error");
  }
});

refreshBtn.addEventListener("click", async () => {
  showMessage(sessionsMessage, "");

  try {
    await Promise.all([loadMe(), loadSessions()]);
  } catch (error) {
    showMessage(sessionsMessage, error.message, "error");
  }
});

logoutBtn.addEventListener("click", async () => {
  try {
    await requestJson(
      "/api/auth/logout",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      },
      "Could not log out"
    );
  } finally {
    window.location.href = "/auth";
  }
});

async function initializeApp() {
  try {
    await Promise.all([loadMe(), loadSessions()]);
  } catch (error) {
    showMessage(sessionsMessage, error.message, "error");
  }
}

initializeApp();
