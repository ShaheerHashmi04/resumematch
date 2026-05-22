import * as cheerio from 'cheerio'

export async function scrapeJobDescription(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch URL: ${response.statusText}`)
  }

  const html = await response.text()
  const $ = cheerio.load(html)

  // Remove noise
  $('script, style, nav, header, footer, iframe, img').remove()

  // Try common job description containers first
  const selectors = [
    '[class*="job-description"]',
    '[class*="jobDescription"]',
    '[class*="job_description"]',
    '[id*="job-description"]',
    '[class*="description"]',
    'article',
    'main'
  ]

  for (const selector of selectors) {
    const text = $(selector).first().text().trim()
    if (text.length > 200) return text
  }

  // Fallback to body text
  return $('body').text().replace(/\s+/g, ' ').trim().slice(0, 3000)
}