const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database(path.join(__dirname, "spottr.db"));

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Initialize schema once at startup for a simple single-node deployment.
db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_name TEXT NOT NULL,
  college TEXT NOT NULL,
  workout_type TEXT NOT NULL,
  start_time TEXT NOT NULL,
  notes TEXT DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS joins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  student_name TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  UNIQUE(session_id, student_name),
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
);
`);

const insertSession = db.prepare(`
  INSERT INTO sessions (host_name, college, workout_type, start_time, notes, capacity, created_at)
  VALUES (@host_name, @college, @workout_type, @start_time, @notes, @capacity, @created_at)
`);

const listSessions = db.prepare(`
  SELECT
    s.id,
    s.host_name,
    s.college,
    s.workout_type,
    s.start_time,
    s.notes,
    s.capacity,
    s.created_at,
    COUNT(j.id) AS joined_count
  FROM sessions s
  LEFT JOIN joins j ON j.session_id = s.id
  WHERE s.start_time >= @from_time
    AND (@college = '' OR lower(s.college) = lower(@college))
  GROUP BY s.id
  ORDER BY s.start_time ASC
`);

const getSession = db.prepare(`
  SELECT
    s.id,
    s.host_name,
    s.college,
    s.workout_type,
    s.start_time,
    s.notes,
    s.capacity,
    s.created_at,
    COUNT(j.id) AS joined_count
  FROM sessions s
  LEFT JOIN joins j ON j.session_id = s.id
  WHERE s.id = ?
  GROUP BY s.id
`);

const insertJoin = db.prepare(`
  INSERT INTO joins (session_id, student_name, joined_at)
  VALUES (?, ?, ?)
`);

const listJoinedStudents = db.prepare(`
  SELECT student_name FROM joins WHERE session_id = ? ORDER BY joined_at ASC
`);

function isBlank(value) {
  return typeof value !== "string" || value.trim() === "";
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/api/sessions", (req, res) => {
  const college = typeof req.query.college === "string" ? req.query.college.trim() : "";
  const fromTime = new Date().toISOString();

  const sessions = listSessions.all({ college, from_time: fromTime }).map((session) => ({
    ...session,
    joined_count: Number(session.joined_count),
    students: listJoinedStudents.all(session.id).map((row) => row.student_name)
  }));

  res.json({ sessions });
});

app.post("/api/sessions", (req, res) => {
  const { hostName, college, workoutType, startTime, notes, capacity } = req.body || {};

  if (isBlank(hostName) || isBlank(college) || isBlank(workoutType) || isBlank(startTime)) {
    return res.status(400).json({
      error: "hostName, college, workoutType, and startTime are required"
    });
  }

  const parsedStart = new Date(startTime);
  if (Number.isNaN(parsedStart.getTime())) {
    return res.status(400).json({ error: "startTime must be a valid ISO datetime" });
  }

  if (parsedStart.getTime() < Date.now()) {
    return res.status(400).json({ error: "startTime must be in the future" });
  }

  const parsedCapacity = Number.isInteger(capacity) ? capacity : Number(capacity);
  if (!Number.isFinite(parsedCapacity) || parsedCapacity < 2 || parsedCapacity > 8) {
    return res.status(400).json({ error: "capacity must be a number between 2 and 8" });
  }

  const now = new Date().toISOString();

  const result = insertSession.run({
    host_name: hostName.trim(),
    college: college.trim(),
    workout_type: workoutType.trim(),
    start_time: parsedStart.toISOString(),
    notes: typeof notes === "string" ? notes.trim().slice(0, 250) : "",
    capacity: parsedCapacity,
    created_at: now
  });

  const session = getSession.get(result.lastInsertRowid);
  res.status(201).json({
    session: {
      ...session,
      joined_count: Number(session.joined_count),
      students: []
    }
  });
});

app.post("/api/sessions/:id/join", (req, res) => {
  const sessionId = Number(req.params.id);
  const studentName = typeof req.body?.studentName === "string" ? req.body.studentName.trim() : "";

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return res.status(400).json({ error: "invalid session id" });
  }

  if (studentName === "") {
    return res.status(400).json({ error: "studentName is required" });
  }

  const session = getSession.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: "session not found" });
  }

  // Capacity includes the host, so available slots are based on host + joins.
  if (Number(session.joined_count) + 1 >= session.capacity) {
    return res.status(409).json({ error: "session is full" });
  }

  const now = new Date().toISOString();

  try {
    insertJoin.run(sessionId, studentName, now);
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "you already joined this session" });
    }
    throw err;
  }

  const updated = getSession.get(sessionId);
  res.json({
    session: {
      ...updated,
      joined_count: Number(updated.joined_count),
      students: listJoinedStudents.all(sessionId).map((row) => row.student_name)
    }
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: "not found" });
});

app.listen(PORT, () => {
  console.log(`Spottr running at http://localhost:${PORT}`);
});
