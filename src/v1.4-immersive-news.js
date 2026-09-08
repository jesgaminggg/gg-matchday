const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const CACHE_PREFIX = "gg-matchday-immersive-";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function readCache(key) {
  try {
    const raw = sessionStorage.getItem(`${CACHE_PREFIX}${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeCache(key, value) {
  try {
    sessionStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(value));
  } catch {
    // Storage may be unavailable; the page can still use the live response.
  }
}

async function getLatestMatch() {
  const response = await fetch(`${API_URL}/matches`);
  if (!response.ok) throw new Error("Failed to load latest match.");

  const matches = await response.json();
  if (!Array.isArray(matches) || matches.length === 0) return null;

  return [...matches].sort(
    (a, b) => new Date(b.date) - new Date(a.date)
  )[0];
}

async function getImmersiveCommentary(matchId) {
  const cached = readCache(matchId);
  if (cached) return cached;

  const response = await fetch(`${API_URL}/immersive-news/${matchId}`);
  if (!response.ok) throw new Error("Failed to generate immersive commentary.");

  const article = await response.json();
  writeCache(matchId, article);
  return article;
}

function applyCommentary(article) {
  const feature = document.querySelector(".home-feature-card");
  if (feature && article.momentTitle && article.momentText) {
    const title = feature.querySelector("h2");
    const text = feature.querySelector("p");

    if (title) title.textContent = clean(article.momentTitle);
    if (text) text.textContent = clean(article.momentText);

    feature.setAttribute("data-gg-immersive-ready", "true");
  }

  const firstNewsCard = document.querySelector(".news-card");
  if (firstNewsCard && article.headline && article.summary) {
    const title = firstNewsCard.querySelector(".news-content h3");
    const text = firstNewsCard.querySelector(".news-content p");
    const icon = firstNewsCard.querySelector(".news-icon");

    if (title) title.textContent = clean(article.headline);
    if (text) text.textContent = clean(article.summary);
    if (icon && article.icon) icon.textContent = clean(article.icon);

    firstNewsCard.setAttribute("data-gg-immersive-ready", "true");
  }
}

let running = false;

async function enhanceHomeCommentary() {
  if (running) return;

  const feature = document.querySelector(".home-feature-card");
  const firstNewsCard = document.querySelector(".news-card");

  if (!feature || !firstNewsCard) return;
  if (
    feature.getAttribute("data-gg-immersive-ready") === "true" &&
    firstNewsCard.getAttribute("data-gg-immersive-ready") === "true"
  ) {
    return;
  }

  running = true;

  try {
    const match = await getLatestMatch();
    if (!match?._id) return;

    const article = await getImmersiveCommentary(match._id);
    applyCommentary(article);
  } catch (error) {
    console.error("GG Matchday immersive commentary failed:", error);
  } finally {
    running = false;
  }
}

const observer = new MutationObserver(() => {
  if (observer.__scheduled) return;
  observer.__scheduled = true;

  requestAnimationFrame(() => {
    observer.__scheduled = false;
    enhanceHomeCommentary();
  });
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", enhanceHomeCommentary, {
    once: true,
  });
} else {
  enhanceHomeCommentary();
}
