# Render Backend Deploy

This app is ready to run as a Render Node Web Service.

## Service

- Root directory: `apa`
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/health`

Render automatically provides `PORT`. The server binds to `0.0.0.0` by default.

## Required Environment Variables

Set these in Render Dashboard > Environment:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini

FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=...
FIREBASE_PROJECT_ID=...
FIREBASE_STORAGE_BUCKET=...
FIREBASE_MESSAGING_SENDER_ID=...
FIREBASE_APP_ID=...
FIREBASE_DATABASE_URL=
FIREBASE_MEASUREMENT_ID=
```

## Backend Endpoints

- `GET /api/health` checks backend status.
- `POST /api/search` sends a user question to OpenAI and returns hints instead of final answers.
- `GET /api/firebase-config` exposes only the Firebase web app config needed by the browser SDK.

Search history uses Firestore when Firebase config is available, and falls back to `localStorage` otherwise.
