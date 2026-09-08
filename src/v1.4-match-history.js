const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";

const CARD_MARKER = "data-gg-match-history-v14";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function scoreSignature(match) {
  return [
    clean(match.name),
    clean(match.date).slice(0, 10),
    Number(match.teamA?.score || 0),
    Number(match.teamB?.score || 0),
    clean(match.teamA?.label),
    clean(match.teamB?.label),
  ].join("|");
}

function buildScorers(match, team) {
  const counts = new Map();
  const participants = new Map(
    (match.participants || []).map((participant) => [
      String(participant.player?._id || participant.player),
      participant.team,
    ])
  );

  for (const event of match.events || []) {
    if (event.type !== "goal") continue;

    const playerId = String(event.player?._id || event.player);
    if (participants.get(playerId) !== team) continue;

    const name = clean(event.player?.name) || "Player";
    counts.set(name, (counts.get(name) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, goals]) => `${name}(${goals})`)
    .join(", ");
}

function renderScorerLine(value) {
  const line = document.createElement("div");
  line.className = "v14-history-scorers";
  line.textContent = value || "—";
  return line;
}

function buildMatchSummary(match) {
  const summary = document.createElement("div");
  summary.className = "v14-history-summary";
  summary.setAttribute(CARD_MARKER, "true");

  const teamA = document.createElement("div");
  teamA.className = "v14-history-team v14-history-team-a";

  const teamALabel = document.createElement("strong");
  teamALabel.textContent = clean(match.teamA?.label) || "Team A";
  teamA.appendChild(teamALabel);
  teamA.appendChild(renderScorerLine(buildScorers(match, "A")));

  const score = document.createElement("div");
  score.className = "v14-history-score";
  score.textContent = `${Number(match.teamA?.score || 0)}–${Number(match.teamB?.score || 0)}`;

  const teamB = document.createElement("div");
  teamB.className = "v14-history-team v14-history-team-b";

  const teamBLabel = document.createElement("strong");
  teamBLabel.textContent = clean(match.teamB?.label) || "Team B";
  teamB.appendChild(teamBLabel);
  teamB.appendChild(renderScorerLine(buildScorers(match, "B")));

  summary.append(teamA, score, teamB);
  return summary;
}

function findCardMatch(card, matches, used) {
  const name = clean(card.querySelector("h3")?.textContent);
  const dateText = clean(card.querySelector(".match-date")?.textContent);
  const scoreText = clean(card.querySelector(".match-score strong")?.textContent);

  return matches.find((match) => {
    if (used.has(String(match._id))) return false;

    const sameName = name === clean(match.name);
    const sameScore = scoreText.replace(/\s+/g, "") ===
      `${Number(match.teamA?.score || 0)}-${Number(match.teamB?.score || 0)}`;

    const formattedDate = new Date(match.date).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    return sameName && (dateText === formattedDate || sameScore);
  }) || null;
}

async function loadMatches() {
  const response = await fetch(`${API_URL}/matches`);
  if (!response.ok) throw new Error("Failed to load matches.");
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

async function enhanceRecentMatches() {
  let matches;

  try {
    matches = await loadMatches();
  } catch (error) {
    console.error("GG Matchday match-history enhancement failed:", error);
    return;
  }

  const cards = [...document.querySelectorAll("article.match-card")];
  if (!cards.length) return;

  const used = new Set();

  cards.forEach((card) => {
    const match = findCardMatch(card, matches, used);
    if (!match) return;

    used.add(String(match._id));

    const oldSummary = card.querySelector(`[${CARD_MARKER}="true"]`);
    oldSummary?.remove();

    const oldLabels = card.querySelector(".match-labels");
    oldLabels?.remove();

    card.appendChild(buildMatchSummary(match));
  });
}

function schedule() {
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(() => enhanceRecentMatches(), { timeout: 1800 });
  } else {
    window.setTimeout(enhanceRecentMatches, 0);
  }
}

const observer = new MutationObserver(() => {
  if (observer.__scheduled) return;
  observer.__scheduled = true;

  requestAnimationFrame(() => {
    observer.__scheduled = false;

    if (document.querySelector("article.match-card")) {
      enhanceRecentMatches();
    }
  });
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", schedule, { once: true });
} else {
  schedule();
}
