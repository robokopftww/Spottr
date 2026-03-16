const crypto = require("crypto");
const express = require("express");
const path = require("path");
const Database = require("better-sqlite3");

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_COOKIE_NAME = "spottr_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const publicDir = path.join(__dirname, "public");
const viewsDir = path.join(__dirname, "views");
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "spottr.db");
const db = new Database(DB_PATH);

db.pragma("foreign_keys = ON");

app.use(express.json());
app.use(express.static(publicDir, { index: false }));

function tableHasColumn(tableName, columnName) {
  return db.prepare(`PRAGMA table_info(${tableName})`).all().some((column) => column.name === columnName);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) {
    return {};
  }

  return header.split(";").reduce((cookies, cookiePart) => {
    const [rawName, ...rawValueParts] = cookiePart.trim().split("=");
    cookies[rawName] = decodeURIComponent(rawValueParts.join("="));
    return cookies;
  }, {});
}

function clampText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isBlank(value) {
  return typeof value !== "string" || value.trim() === "";
}

function normalizeUsername(value) {
  return clampText(value, 24).toLowerCase();
}

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function createPasswordRecord(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    salt,
    hash: hashPassword(password, salt)
  };
}

function verifyPassword(password, salt, expectedHash) {
  const actual = Buffer.from(hashPassword(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");

  if (actual.length !== expected.length) {
    return false;
  }

  return crypto.timingSafeEqual(actual, expected);
}

function createSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(res, token) {
  const cookieParts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  ];

  if (process.env.NODE_ENV === "production") {
    cookieParts.push("Secure");
  }

  res.setHeader("Set-Cookie", cookieParts.join("; "));
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  bio TEXT DEFAULT '',
  experience_level TEXT DEFAULT '',
  favorite_lift TEXT DEFAULT '',
  availability TEXT DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  host_name TEXT NOT NULL,
  college TEXT NOT NULL DEFAULT '',
  workout_type TEXT NOT NULL,
  start_time TEXT NOT NULL,
  notes TEXT DEFAULT '',
  capacity INTEGER NOT NULL DEFAULT 2,
  created_at TEXT NOT NULL,
  host_user_id INTEGER,
  FOREIGN KEY(host_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS joins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL,
  student_name TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  user_id INTEGER,
  FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE SET NULL
);
`);

if (!tableHasColumn("sessions", "host_user_id")) {
  db.exec(`
    ALTER TABLE sessions
    ADD COLUMN host_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  `);
}

if (!tableHasColumn("joins", "user_id")) {
  db.exec(`
    ALTER TABLE joins
    ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL
  `);
}

db.exec(`
CREATE INDEX IF NOT EXISTS sessions_start_time_idx ON sessions(start_time);
CREATE INDEX IF NOT EXISTS joins_session_lookup_idx ON joins(session_id, joined_at);
CREATE UNIQUE INDEX IF NOT EXISTS joins_session_user_unique
ON joins(session_id, user_id)
WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS auth_sessions_token_hash_idx ON auth_sessions(token_hash);
`);

const userSelect = `
  id,
  username,
  display_name,
  bio,
  experience_level,
  favorite_lift,
  availability,
  created_at
`;

const userSelectWithAlias = `
  u.id AS id,
  u.username AS username,
  u.display_name AS display_name,
  u.bio AS bio,
  u.experience_level AS experience_level,
  u.favorite_lift AS favorite_lift,
  u.availability AS availability,
  u.created_at AS created_at
`;

const insertUser = db.prepare(`
  INSERT INTO users (
    username,
    password_salt,
    password_hash,
    display_name,
    bio,
    experience_level,
    favorite_lift,
    availability,
    created_at
  )
  VALUES (
    @username,
    @password_salt,
    @password_hash,
    @display_name,
    @bio,
    @experience_level,
    @favorite_lift,
    @availability,
    @created_at
  )
`);

const getUserById = db.prepare(`
  SELECT
    ${userSelect},
    password_salt,
    password_hash
  FROM users
  WHERE id = ?
`);

const getUserByUsername = db.prepare(`
  SELECT
    ${userSelect},
    password_salt,
    password_hash
  FROM users
  WHERE username = ?
`);

const insertAuthSession = db.prepare(`
  INSERT INTO auth_sessions (user_id, token_hash, created_at, expires_at)
  VALUES (?, ?, ?, ?)
`);

const deleteAuthSessionByHash = db.prepare(`
  DELETE FROM auth_sessions
  WHERE token_hash = ?
`);

const deleteExpiredAuthSessions = db.prepare(`
  DELETE FROM auth_sessions
  WHERE expires_at <= ?
`);

const getUserBySessionToken = db.prepare(`
  SELECT
    ${userSelectWithAlias}
  FROM auth_sessions s
  JOIN users u ON u.id = s.user_id
  WHERE s.token_hash = ?
    AND s.expires_at > ?
`);

const insertSession = db.prepare(`
  INSERT INTO sessions (
    host_name,
    college,
    workout_type,
    start_time,
    notes,
    capacity,
    created_at,
    host_user_id
  )
  VALUES (
    @host_name,
    '',
    @workout_type,
    @start_time,
    @notes,
    @capacity,
    @created_at,
    @host_user_id
  )
`);

const sessionSelect = `
  s.id,
  COALESCE(u.display_name, s.host_name) AS host_name,
  s.workout_type,
  s.start_time,
  s.notes,
  s.capacity,
  s.created_at,
  s.host_user_id,
  u.username AS host_username,
  u.experience_level AS host_experience_level,
  u.favorite_lift AS host_favorite_lift,
  COUNT(j.id) AS joined_count
`;

const listSessions = db.prepare(`
  SELECT
    ${sessionSelect}
  FROM sessions s
  LEFT JOIN joins j ON j.session_id = s.id
  LEFT JOIN users u ON u.id = s.host_user_id
  WHERE s.start_time >= @from_time
  GROUP BY s.id
  ORDER BY s.start_time ASC
`);

const getSession = db.prepare(`
  SELECT
    ${sessionSelect}
  FROM sessions s
  LEFT JOIN joins j ON j.session_id = s.id
  LEFT JOIN users u ON u.id = s.host_user_id
  WHERE s.id = ?
  GROUP BY s.id
`);

const insertJoin = db.prepare(`
  INSERT INTO joins (session_id, student_name, joined_at, user_id)
  VALUES (?, ?, ?, ?)
`);

const getJoinByUser = db.prepare(`
  SELECT id
  FROM joins
  WHERE session_id = ?
    AND user_id = ?
`);

const listJoinedStudents = db.prepare(`
  SELECT
    COALESCE(u.display_name, j.student_name) AS student_name,
    j.user_id,
    u.username,
    u.experience_level,
    u.favorite_lift
  FROM joins j
  LEFT JOIN users u ON u.id = j.user_id
  WHERE j.session_id = ?
  ORDER BY j.joined_at ASC
`);

function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    bio: user.bio,
    experience_level: user.experience_level,
    favorite_lift: user.favorite_lift,
    availability: user.availability,
    created_at: user.created_at
  };
}

function serializeSession(session) {
  return {
    id: session.id,
    host_name: session.host_name,
    workout_type: session.workout_type,
    start_time: session.start_time,
    notes: session.notes,
    capacity: session.capacity,
    created_at: session.created_at,
    host_user_id: session.host_user_id ?? null,
    host_username: session.host_username || null,
    host_experience_level: session.host_experience_level || "",
    host_favorite_lift: session.host_favorite_lift || "",
    joined_count: Number(session.joined_count),
    students: listJoinedStudents.all(session.id).map((row) => ({
      student_name: row.student_name,
      user_id: row.user_id ?? null,
      username: row.username || null,
      experience_level: row.experience_level || "",
      favorite_lift: row.favorite_lift || ""
    }))
  };
}

function getAuthenticatedUser(req) {
  deleteExpiredAuthSessions.run(new Date().toISOString());

  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (!token) {
    return null;
  }

  const user = getUserBySessionToken.get(hashToken(token), new Date().toISOString());
  return user ? serializeUser(user) : null;
}

function createAuthSession(res, userId) {
  const token = createSessionToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  insertAuthSession.run(userId, hashToken(token), now.toISOString(), expiresAt.toISOString());
  setSessionCookie(res, token);
}

function requireAuthApi(req, res, next) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    clearSessionCookie(res);
    return res.status(401).json({ error: "sign in required" });
  }

  req.user = user;
  next();
}

function requireAuthPage(req, res, next) {
  const user = getAuthenticatedUser(req);
  if (!user) {
    clearSessionCookie(res);
    return res.redirect("/auth");
  }

  req.user = user;
  next();
}

app.get("/", (req, res) => {
  const user = getAuthenticatedUser(req);
  res.redirect(user ? "/app" : "/auth");
});

app.get("/auth", (req, res) => {
  const user = getAuthenticatedUser(req);
  if (user) {
    return res.redirect("/app");
  }

  res.sendFile(path.join(viewsDir, "auth.html"));
});

app.get("/app", requireAuthPage, (_req, res) => {
  res.sendFile(path.join(viewsDir, "app.html"));
});

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/auth/register", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const displayName = clampText(req.body?.displayName, 40);
  const bio = clampText(req.body?.bio, 220);
  const experienceLevel = clampText(req.body?.experienceLevel, 30);
  const favoriteLift = clampText(req.body?.favoriteLift, 40);
  const availability = clampText(req.body?.availability, 60);

  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    return res.status(400).json({ error: "username must be 3-24 characters using letters, numbers, or underscores" });
  }

  if (password.length < 8) {
    return res.status(400).json({ error: "password must be at least 8 characters" });
  }

  if (isBlank(displayName)) {
    return res.status(400).json({ error: "displayName is required" });
  }

  const passwordRecord = createPasswordRecord(password);
  const now = new Date().toISOString();

  try {
    const result = insertUser.run({
      username,
      password_salt: passwordRecord.salt,
      password_hash: passwordRecord.hash,
      display_name: displayName,
      bio,
      experience_level: experienceLevel,
      favorite_lift: favoriteLift,
      availability,
      created_at: now
    });

    createAuthSession(res, result.lastInsertRowid);
    return res.status(201).json({
      user: serializeUser(getUserById.get(result.lastInsertRowid))
    });
  } catch (err) {
    if (String(err.message).includes("UNIQUE")) {
      return res.status(409).json({ error: "username is already taken" });
    }

    throw err;
  }
});

app.post("/api/auth/login", (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const user = getUserByUsername.get(username);

  if (!user || !verifyPassword(password, user.password_salt, user.password_hash)) {
    return res.status(401).json({ error: "invalid username or password" });
  }

  createAuthSession(res, user.id);
  res.json({ user: serializeUser(user) });
});

app.post("/api/auth/logout", (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE_NAME];
  if (token) {
    deleteAuthSessionByHash.run(hashToken(token));
  }

  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/me", requireAuthApi, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/sessions", requireAuthApi, (_req, res) => {
  const sessions = listSessions.all({ from_time: new Date().toISOString() }).map(serializeSession);
  res.json({ sessions });
});

app.post("/api/sessions", requireAuthApi, (req, res) => {
  const workoutType = clampText(req.body?.workoutType, 40);
  const startTime = req.body?.startTime;
  const notes = clampText(req.body?.notes, 250);
  const parsedCapacity = Number.isInteger(req.body?.capacity) ? req.body.capacity : Number(req.body?.capacity);

  if (isBlank(workoutType) || isBlank(startTime)) {
    return res.status(400).json({ error: "workoutType and startTime are required" });
  }

  const parsedStart = new Date(startTime);
  if (Number.isNaN(parsedStart.getTime())) {
    return res.status(400).json({ error: "startTime must be a valid ISO datetime" });
  }

  if (parsedStart.getTime() < Date.now()) {
    return res.status(400).json({ error: "startTime must be in the future" });
  }

  if (!Number.isFinite(parsedCapacity) || parsedCapacity < 2 || parsedCapacity > 8) {
    return res.status(400).json({ error: "capacity must be a number between 2 and 8" });
  }

  const result = insertSession.run({
    host_name: req.user.display_name,
    workout_type: workoutType,
    start_time: parsedStart.toISOString(),
    notes,
    capacity: parsedCapacity,
    created_at: new Date().toISOString(),
    host_user_id: req.user.id
  });

  res.status(201).json({
    session: serializeSession(getSession.get(result.lastInsertRowid))
  });
});

app.post("/api/sessions/:id/join", requireAuthApi, (req, res) => {
  const sessionId = Number(req.params.id);

  if (!Number.isInteger(sessionId) || sessionId <= 0) {
    return res.status(400).json({ error: "invalid session id" });
  }

  const session = getSession.get(sessionId);
  if (!session) {
    return res.status(404).json({ error: "session not found" });
  }

  if (session.host_user_id === req.user.id) {
    return res.status(409).json({ error: "you are already hosting this session" });
  }

  if (getJoinByUser.get(sessionId, req.user.id)) {
    return res.status(409).json({ error: "you already joined this session" });
  }

  if (Number(session.joined_count) + 1 >= session.capacity) {
    return res.status(409).json({ error: "session is full" });
  }

  try {
    insertJoin.run(sessionId, req.user.display_name, new Date().toISOString(), req.user.id);
  } catch (err) {
    if (
      String(err.message).includes("joins_session_user_unique") ||
      String(err.message).includes("joins.session_id, joins.user_id")
    ) {
      return res.status(409).json({ error: "you already joined this session" });
    }

    throw err;
  }

  res.json({
    session: serializeSession(getSession.get(sessionId))
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: "not found" });
});

app.listen(PORT, () => {
  console.log(`Spottr running at http://localhost:${PORT}`);
});
