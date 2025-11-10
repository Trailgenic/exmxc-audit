// /shared/weights.js
// EEI Rubric Weights (Current vs Future Projection)

export const CURRENT_WEIGHTS = {
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

// Predictive rubric: biases toward structured data, crawl signals, and transparency
export const FUTURE_WEIGHTS = {
  title: 6,
  metaDescription: 6,
  canonical: 6,
  schemaPresence: 25,
  orgSchema: 12,
  breadcrumbSchema: 10,
  authorPerson: 10,
  socialLinks: 6,
  aiCrawl: 8,
  contentDepth: 6,
  internalLinks: 3,
  externalLinks: 2,
  faviconOg: 0,
};
