# Render Backend Setup

This project can run as a Render Node Web Service. Do not deploy until you are ready to publish the app.

## Service

- Root directory: `apa`
- Runtime: Node
- Build command: `npm install`
- Start command: `npm start`
- Health check path: `/api/health`

Render provides `PORT` automatically. The server binds to `0.0.0.0` by default.

## Required Environment Variables

Set these in Render Dashboard > Environment:

```env
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4.1-mini
OPENAI_TIMEOUT_MS=25000

FIREBASE_API_KEY=...
FIREBASE_AUTH_DOMAIN=new-contest-78069.firebaseapp.com
FIREBASE_PROJECT_ID=new-contest-78069
FIREBASE_MESSAGING_SENDER_ID=376892339860
FIREBASE_APP_ID=1:376892339860:web:26470d742aaf6f40d92681
FIREBASE_MEASUREMENT_ID=...
```

Optional:

```env
ALLOWED_ORIGIN=https://your-frontend.example.com
```

Leave `ALLOWED_ORIGIN` empty when the frontend and backend are served from the same Render service.

## Backend Endpoints

- `GET /api/health`: checks backend status without exposing secrets.
- `GET /api/firebase-config`: exposes the Firebase browser SDK config.
- `POST /api/search`: sends a question to OpenAI and returns solving methods or hints instead of direct final answers.

## Firebase Data Storage

Firebase is used for account-related data only:

- Firebase Authentication stores the actual user account credentials.
- Firestore `users/{uid}` stores profile metadata.
- Firestore `searchHistory` stores each user's search and hint history.
- Firestore `accountLogs` stores account activity logs.
