# MASIV 3D City Dashboard

3D visualization of Calgary Open Data (buildings, permits, hydrants, transit
stops) on a real map background, with natural-language filtering and
saved-project persistence.

```
backend/    FastAPI service
frontend/   React + Three.js
docs/       UML.png -- class + sequence diagrams
```

## Prerequisites

- Python 3.8+
- Node.js 18+

## 1. Backend

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate        # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
copy .env.example .env        # Windows; use `cp .env.example .env` on macOS/Linux
uvicorn app.main:app --reload --port 8000
```

### Getting an LLM API key (optional)

The natural-language query bar ("buildings over 100 feet", etc.) uses
[Groq](https://console.groq.com)'s free-tier API. Without a key, queries
fall back to a keyword-based parser instead -- the app still works either
way.

1. Sign up at https://console.groq.com (free, no card required)
2. Create an API key from the console
3. Paste it into `backend/.env` as `LLM_API_KEY=...`

## 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. It talks to the backend at
`http://localhost:8000` by default.

## Docs

- Interactive API reference: http://localhost:8000/docs (once the backend
  is running)
- UML diagrams: [`docs/UML.png`](docs/UML.png)
