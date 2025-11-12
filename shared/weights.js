// shared/weights.js
// EEI v3.0 weights mapped to the current 13 signal functions
const WEIGHTS = {
  // Meta (15)
  title: 5,
  metaDescription: 5,
  canonical: 5,

  // Schema (30)
  schemaPresence: 10,
  orgSchema: 8,
  breadcrumbSchema: 8,
  authorPerson: 8,

  // Graph (20)
  internalLinks: 12,
  externalLinks: 8,

  // Trust + AI (35 split to our existing signals)
  socialLinks: 6,   // brand graph / authority hints
  aiCrawl: 8,       // indexability + crawl fidelity
  contentDepth: 7,  // inference efficiency proxy
  faviconOg: 10     // branding + tech consistency (rolled up)
};

export default WEIGHTS;
