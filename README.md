# exmxc-audit

## Overview
**exmxc-audit** is part of the [exmxc.ai](https://www.exmxc.ai) ecosystem — an Entity Engineering™ sandbox for automated AI-search audits.  
It analyzes websites, brands, and digital entities for schema integrity, crawl parity, and AI trust signal performance.

This module serves as the foundation for future client-facing audits, allowing users to input a domain or social profile,  
run an automated Entity Engineering analysis, and receive structured recommendations for improving AI-search visibility.

---

## Architecture
The project is designed as a lightweight Node.js service deployed via **Vercel** for instant scalability.

**Core Components**
- `/api/audit.js` – handles incoming audit requests and generates structured output  
- `package.json` – defines dependencies for the API runtime  
- `vercel.json` – manages routing, redirects, and deployment configuration  
- `README.md` – project documentation  
- `LICENSE` – open-source license for transparency and compliance  

---

## Usage
Once deployed, the API endpoint will accept requests in the following format:

