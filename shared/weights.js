// /shared/weights.js
// Rubric weights for EEI — centralized for all audits and predictive scoring.

export const WEIGHTS = {
  title: 10,
  metaDescription: 10,
  canonical: 10,
  schemaPresence: 20,
  orgSchema: 8,
  breadcrumbSchema: 8,
  authorPerson: 8,
  socialLinks: 6,
  aiCrawl: 4,
  contentDepth: 10,
  internalLinks: 10,
  externalLinks: 4,
  faviconOg: 2,
};

// Optional: social platforms for reference in scoring.js
export const SOCIAL_HOSTS = [
  "linkedin.com",
  "instagram.com",
  "youtube.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "wikipedia.org",
  "threads.net",
  "tiktok.com",
  "github.com",
];
