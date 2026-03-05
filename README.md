# Spottr

Spottr is a lightweight app for college students to find gym buddies.

Students can:
- Post a gym session with workout type and start time
- Filter sessions by college
- Join an existing session

## Tech stack
- Node.js + Express
- SQLite (`better-sqlite3`)
- Vanilla HTML/CSS/JavaScript frontend

## Run locally

```bash
npm install
npm start
```

Then open [http://localhost:3000](http://localhost:3000).

## API

- `GET /api/health`
- `GET /api/sessions?college=...`
- `POST /api/sessions`
  - body: `{ "hostName", "college", "workoutType", "startTime", "notes", "capacity" }`
- `POST /api/sessions/:id/join`
  - body: `{ "studentName" }`

## Notes
- This is an MVP for small-scale campus use.
- Data is stored locally in `spottr.db`.
