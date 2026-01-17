function extractKeywords() {
  const metaKeywords = Array.from(
    document.querySelectorAll("meta[name='keywords']")
  )
    .map((el) => el.content)
    .join(" ");

  const title = document.title ?? "";
  const url = new URL(window.location.href);
  const isGoogleSearch = url.hostname.includes("google.") && url.pathname === "/search";
  const query = isGoogleSearch ? url.searchParams.get("q") ?? "" : "";
  const isYouTubeWatch =
    url.hostname.includes("youtube.com") && url.pathname === "/watch";

  const raw = [metaKeywords, title, query].join(" ");
  const tokens = raw
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

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
