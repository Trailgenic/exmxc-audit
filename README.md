# exmxc-audit  
**Baseline Version (v1 — Locked and Verified)**  
**Date:** November 3, 2025  
**Status:** ✅ Fully Functional and Deployed on Vercel  

---

## 🧩 Project Overview
`exmxc-audit` is a lightweight serverless web app that audits any public URL for key AI-search and entity-readiness signals.

- Built with **Axios** for fetching pages and **Cheerio** for DOM parsing  
- Deployed on **Vercel** with serverless routing  
- Returns structured JSON including title, canonical URL, description, schema count, and an `entityScore`

This baseline version (`v1-baseline-working`) is the **official locked configuration** confirmed to work across all tested domains.

---

## 📁 Directory Layout

exmxc-audit/
├── api/
│ └── audit.js # serverless audit endpoint
├── index.html # minimal web UI
├── package.json # dependencies & scripts
└── vercel.json # build + routing config

php-template
Copy code

---

## 🧠 Core Components

### `/api/audit.js`
- Imports `axios` and `cheerio`
- Normalizes URL (adds `https://` if missing)
- Validates input and handles bad URLs gracefully
- Fetches page HTML with user agent:  
  `Mozilla/5.0 (compatible; exmxc-audit/1.0; +https://exmxc.ai)`
- Extracts:
  - `<title>`
  - `<link rel="canonical">`
  - `<meta name="description">` / `<meta property="og:description">`
  - Count of `<script type="application/ld+json">`
- Calculates a simple `entityScore`
- Returns JSON:
  ```json
  {
    "url": "...",
    "title": "...",
    "canonical": "...",
    "description": "...",
    "schemaCount": n,
    "entityScore": x.x,
    "timestamp": "ISO string"
  }
/index.html
Clean static UI

Input + “Run Audit” button

Fetches /api/audit?url=... and displays formatted JSON

No external JS or CSS dependencies

/vercel.json
json
Copy code
{
  "version": 2,
  "builds": [
    { "src": "api/audit.js", "use": "@vercel/node" },
    { "src": "index.html", "use": "@vercel/static" }
  ],
  "routes": [
    { "src": "^/api/audit$", "dest": "api/audit.js" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
Stable routing for both API and static UI

No rewrites or headers needed

/package.json
json
Copy code
{
  "type": "module",
  "dependencies": {
    "axios": "^1.7.9",
    "cheerio": "^1.0.0"
  },
  "scripts": {
    "build": "echo 'Build complete'"
  }
}
🧪 Validation Checklist
Test Site	Status	Output
trailgenic.com	✅	JSON
www.trailgenic.com	✅	JSON
athletechnews.com	✅	JSON
lineps.com	✅	JSON

No regressions: No HTML 404s, no JSON parse errors.

🔒 Baseline Protection
Git Tag
bash
Copy code
git tag v1-baseline-working
git push --tags
Recovery
If any regression occurs:

bash
Copy code
git checkout v1-baseline-working
vercel --prod
Edit Policy
Only modify api/audit.js for new scoring logic.
Never edit:

vercel.json

index.html

package.json

🧩 Future Enhancements
To evolve safely:

Add new scoring logic inside a helper function:

js
Copy code
function scoreV2({ title, canonical, schemaCount }) {
  return 100; // placeholder
}
Keep exports identical (export default async function handler)

Deploy and test using:

bash
Copy code
vercel --prod
Verify JSON across all test sites before merging.

📜 Changelog
Version	Date	Notes
v1.0	2025-11-03	Locked baseline working build (verified & tagged)

© 2025 exmxc.ai
Engineered by Mike Ye & Ella — precision, foresight, and zero guesswork.
