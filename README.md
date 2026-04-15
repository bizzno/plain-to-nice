# plain-to-nice

Converts raw guide text (pastebin dumps, markdown, plain lists) into interactive checklists with checkboxes and progress tracking. No login, no accounts, free to use.

## Setup

### 1. Get a Gemini API key

Get a free key at [aistudio.google.com/apikey](https://aistudio.google.com/apikey)

### 2. Deploy the Worker

```bash
npm install -g wrangler
wrangler login
wrangler deploy worker.js --name plain-to-nice
wrangler secret put GEMINI_KEY
```

### 3. Update the frontend

Copy the Worker URL (printed after deploy) and replace `WORKER_URL` in `frontend/index.html`.

### 4. Deploy the frontend

Push `frontend/index.html` to a GitHub repo, enable GitHub Pages (Settings → Pages → main branch / root), and share the URL. Visitors need no API key.
