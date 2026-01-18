const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "by",
  "at",
  "from",
  "as",
  "is",
  "are",
  "was",
  "were",
  "be",
  "this",
  "that",
  "it",
  "its",
  "you",
  "your",
  "we",
  "they",
  "their",
  "our",
  "about",
  "google",
  "search",
  "score",
  "scores",
  "game",
  "games",
  "live",
  "highlights",
  "highlights",
  "vs",
  "v"
]);

function normalizeTokens(text) {
  const seen = new Set();
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
  const unique = [];
  for (const token of tokens) {
    if (!seen.has(token)) {
      seen.add(token);
      unique.push(token);
    }
  }
  return unique;
}

function extractKeywords() {
  const metaKeywords = Array.from(
    document.querySelectorAll("meta[name='keywords']")
  )
    .map((el) => el.content)
    .join(" ");
  const metaDescription =
    document.querySelector("meta[name='description']")?.content ?? "";
  const heading = document.querySelector("h1")?.textContent ?? "";

  const title = document.title ?? "";
  const url = new URL(window.location.href);
  const isGoogleSearch = url.hostname.includes("google.") && url.pathname === "/search";
  const query = isGoogleSearch ? url.searchParams.get("q") ?? "" : "";
  const isYouTubeWatch =
    url.hostname.includes("youtube.com") && url.pathname === "/watch";

  const raw = isGoogleSearch
    ? query
    : [metaKeywords, metaDescription, heading, title].join(" ");
  const tokens = normalizeTokens(raw);

  return {
    keywords: tokens.slice(0, 25),
    query,
    source: isGoogleSearch ? "google_search" : isYouTubeWatch ? "youtube" : "web",
    isLiveHint: /\\blive\\b/i.test(title)
  };
}

const extracted = extractKeywords();

const context = {
  url: window.location.href,
  title: document.title,
  keywords: extracted.keywords,
  query: extracted.query,
  source: extracted.source,
  isLiveHint: extracted.isLiveHint,
  timestamp: new Date().toISOString()
};

chrome.runtime.sendMessage({ type: "page_context", payload: context });
