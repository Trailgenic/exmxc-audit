import axios from 'axios';
import * as cheerio from 'cheerio';

export default async function handler(req, res) {
  try {
    const { url } = req.query;

    if (!url) {
      return res.status(400).json({ error: 'Missing URL parameter' });
    }

    // Fetch HTML
    const response = await axios.get(url);
    const html = response.data;
    const $ = cheerio.load(html);

    // Basic checks
    const hasJSONLD = $('script[type="application/ld+json"]').length > 0;
    const hasCanonical = $('link[rel="canonical"]').length > 0;
    const hasDescription = $('meta[name="description"]').length > 0;

    res.status(200).json({
      entityScore: (hasJSONLD + hasCanonical + hasDescription) * 33,
      details: {
        hasJSONLD,
        hasCanonical,
        hasDescription,
      },
    });
  } catch (err) {
    res.status(500).json({
      error: err.message || 'Server error',
    });
  }
}
