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
GOOGLE_SHEETS_SCRIPT_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
```

Optional:

```env
ALLOWED_ORIGIN=https://your-frontend.example.com
```

Leave `ALLOWED_ORIGIN` empty when the frontend and backend are served from the same Render service.

## Backend Endpoints

- `GET /api/health`: checks backend status without exposing secrets.
- `POST /api/search`: sends a question to OpenAI and returns solving methods or hints instead of direct final answers.
- `POST /api/accounts/register`: creates an account row through Google Apps Script.
- `POST /api/accounts/login`: checks email/password against the Google Sheet.

## Local Data Storage

Firebase has been removed. Account signup/login is handled through Google Apps Script and Google Sheets. Search history still uses browser `localStorage`.
