# Spottr

Spottr is a lightweight app for finding a gym buddy.

Users can:
- Create one account-backed profile with a username and password
- Sign in before reaching the main app
- Post a gym session with workout type and start time
- Join an existing session

Passwords are hashed and stored on the server. The browser only keeps an authenticated session cookie.

## Tech stack
- Node.js + Express
- SQLite (`better-sqlite3`)
- Vanilla HTML, CSS, and JavaScript

## Run locally

```bash
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## Main routes

- `GET /auth`
- `GET /app`
- `GET /api/health`
- `POST /api/auth/register`
  - body: `{ "username", "password", "displayName", "bio", "experienceLevel", "favoriteLift", "availability" }`
- `POST /api/auth/login`
  - body: `{ "username", "password" }`
- `POST /api/auth/logout`
- `GET /api/me`
- `GET /api/sessions`
- `POST /api/sessions`
  - body: `{ "workoutType", "startTime", "notes", "capacity" }`
- `POST /api/sessions/:id/join`

## Notes
- One user account maps to one Spottr profile.
- Existing local SQLite data is stored in `spottr.db`.
