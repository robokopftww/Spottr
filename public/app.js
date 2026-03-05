const createForm = document.getElementById("create-form");
const filterForm = document.getElementById("filter-form");
const refreshBtn = document.getElementById("refresh-btn");
const createMessage = document.getElementById("create-message");
const sessionsMessage = document.getElementById("sessions-message");
const sessionsContainer = document.getElementById("sessions");
const template = document.getElementById("session-template");

let currentCollegeFilter = "";

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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function fetchSessions() {
  const query = currentCollegeFilter
    ? `?college=${encodeURIComponent(currentCollegeFilter)}`
    : "";

  const response = await fetch(`/api/sessions${query}`);
  if (!response.ok) {
    throw new Error("Could not load sessions");
  }

  const data = await response.json();
  return data.sessions || [];
}

function renderSessions(sessions) {
  sessionsContainer.innerHTML = "";

  if (sessions.length === 0) {
    sessionsContainer.innerHTML = '<p class="muted">No matching sessions right now.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const session of sessions) {
    const node = template.content.cloneNode(true);

    node.querySelector(".workout").textContent = session.workout_type;
    node.querySelector(".time").textContent = formatDate(session.start_time);
    node.querySelector(".meta").textContent = `${session.host_name} • ${session.college}`;

    const noteNode = node.querySelector(".notes");
    noteNode.textContent = session.notes ? session.notes : "No notes";

    const joinedNode = node.querySelector(".joined");
    const studentList = (session.students || []).map(escapeHtml).join(", ");
    const attendingCount = Number(session.joined_count) + 1;
    joinedNode.innerHTML = `Attending: ${attendingCount}/${session.capacity} (Host: ${escapeHtml(
      session.host_name
    )}${studentList ? `, ${studentList}` : ""})`;

    const joinForm = node.querySelector(".join-form");
    const joinButton = joinForm.querySelector("button");

    if (attendingCount >= session.capacity) {
      joinButton.disabled = true;
      joinButton.textContent = "Full";
    }

    joinForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      const formData = new FormData(joinForm);
      const studentName = String(formData.get("studentName") || "").trim();
      if (!studentName) return;

      joinButton.disabled = true;
      joinButton.textContent = "Joining...";

      try {
        const response = await fetch(`/api/sessions/${session.id}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studentName })
        });

        const payload = await response.json();

        if (!response.ok) {
          throw new Error(payload.error || "Could not join session");
        }

        showMessage(sessionsMessage, "Joined session", "success");
        await reloadSessions();
      } catch (error) {
        showMessage(sessionsMessage, error.message, "error");
      } finally {
        joinButton.disabled = false;
        joinButton.textContent = "Join";
      }
    });

    fragment.appendChild(node);
  }

  sessionsContainer.appendChild(fragment);
}

async function reloadSessions() {
  try {
    const sessions = await fetchSessions();
    renderSessions(sessions);
  } catch (error) {
    showMessage(sessionsMessage, error.message, "error");
  }
}

createForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showMessage(createMessage, "");

  const formData = new FormData(createForm);
  const localTime = String(formData.get("startTimeLocal") || "").trim();

  if (!localTime) {
    showMessage(createMessage, "Please select a start time", "error");
    return;
  }

  const payload = {
    hostName: String(formData.get("hostName") || "").trim(),
    college: String(formData.get("college") || "").trim(),
    workoutType: String(formData.get("workoutType") || "").trim(),
    startTime: new Date(localTime).toISOString(),
    notes: String(formData.get("notes") || "").trim(),
    capacity: Number(formData.get("capacity"))
  };

  try {
    const response = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not create session");
    }

    createForm.reset();
    showMessage(createMessage, "Session posted", "success");
    await reloadSessions();
  } catch (error) {
    showMessage(createMessage, error.message, "error");
  }
});

filterForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(filterForm);
  currentCollegeFilter = String(formData.get("collegeFilter") || "").trim();
  await reloadSessions();
});

refreshBtn.addEventListener("click", async () => {
  showMessage(sessionsMessage, "");
  await reloadSessions();
});

reloadSessions();
