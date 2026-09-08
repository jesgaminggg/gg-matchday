const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:5000/api";

let cachedMatches = [];
let cachedPlayers = [];
let ratingsObserver = null;
let awardsButtonReady = false;

function isMatchUrl(url) {
  try {
    const value = new URL(url, window.location.origin);
    return value.pathname.includes("/api/matches");
  } catch {
    return String(url || "").includes("/api/matches");
  }
}

function matchIdFromUrl(url) {
  try {
    const value = new URL(url, window.location.origin);
    const parts = value.pathname.split("/").filter(Boolean);
    return parts[parts.length - 1] || null;
  } catch {
    return null;
  }
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function injectRatingSection() {
  const assignmentList = document.querySelector(".assignment-list");
  if (!assignmentList) return;

  const form = assignmentList.closest("form");
  if (!form) return;

  let section = form.querySelector("[data-gg-rating-section]");
  if (!section) {
    section = document.createElement("div");
    section.className = "subsection gg-rating-entry-section";
    section.setAttribute("data-gg-rating-section", "true");

    section.innerHTML = `
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">PERFORMANCE</p>
          <h3>Match Ratings</h3>
        </div>
        <span class="muted">Required for participants</span>
      </div>
      <div class="gg-rating-entry-list" data-gg-rating-list></div>
    `;

    const saveButton = form.querySelector("button[type='submit']");
    form.insertBefore(section, saveButton || null);
  }

  const list = section.querySelector("[data-gg-rating-list]");
  if (!list) return;

  const rows = [...assignmentList.querySelectorAll(":scope > .assignment-row")];
  const existingValues = new Map(
    [...list.querySelectorAll("input[data-gg-rating-player-id]")].map((input) => [
      input.dataset.ggRatingPlayerId,
      input.value,
    ])
  );

  list.replaceChildren();

  rows.forEach((row) => {
    const playerName = clean(row.querySelector(".assignment-player strong")?.textContent);
    const buttons = [...row.querySelectorAll(".team-switch button")];
    const selected = buttons.find((button) => button.classList.contains("active"));

    if (!playerName || !selected) return;

    const player = cachedPlayers.find(
      (item) => clean(item.name).toLowerCase() === playerName.toLowerCase()
    );
    if (!player?._id) return;

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "10";
    input.step = "0.1";
    input.inputMode = "decimal";
    input.placeholder = "0.0–10.0";
    input.value = existingValues.get(String(player._id)) || "";
    input.dataset.ggRatingPlayerId = String(player._id);
    input.dataset.ggRatingPlayerName = player.name;
    input.setAttribute("aria-label", `${player.name} match rating`);

    const item = document.createElement("div");
    item.className = "gg-rating-entry";

    const copy = document.createElement("div");
    copy.className = "gg-rating-entry-copy";
    copy.innerHTML = `<strong>${player.name}</strong><small>Side ${selected.textContent.trim()}</small>`;

    item.append(copy, input);
    list.appendChild(item);
  });

  if (!list.children.length) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = "Assign players to a side above to enter ratings.";
    list.appendChild(note);
  }
}

function hydrateRatingsForMatch(matchId) {
  if (!matchId) return;
  const match = cachedMatches.find((item) => String(item._id) === String(matchId));
  if (!match) return;

  const values = new Map(
    (match.participants || []).map((participant) => [
      String(participant.player?._id || participant.player),
      participant.rating,
    ])
  );

  document.querySelectorAll("input[data-gg-rating-player-id]").forEach((input) => {
    const value = values.get(input.dataset.ggRatingPlayerId);
    if (value !== undefined && value !== null) input.value = value;
  });
}

function validateAndInjectRatings(payload, requestUrl) {
  const participants = Array.isArray(payload.participants)
    ? payload.participants
    : [];

  if (!participants.length) return payload;

  const inputs = new Map(
    [...document.querySelectorAll("input[data-gg-rating-player-id]")].map((input) => [
      input.dataset.ggRatingPlayerId,
      input,
    ])
  );

  const existing = cachedMatches.find((item) => String(item._id) === String(matchIdFromUrl(requestUrl)));
  const existingRatings = new Map(
    (existing?.participants || []).map((participant) => [
      String(participant.player?._id || participant.player),
      participant.rating,
    ])
  );

  const missing = [];

  const nextParticipants = participants.map((participant) => {
    const playerId = String(participant.player?._id || participant.player);
    const input = inputs.get(playerId);
    const rawValue = input ? input.value.trim() : "";

    const value = rawValue === "" ? existingRatings.get(playerId) : Number(rawValue);

    if (value === undefined || value === null || !Number.isFinite(Number(value)) || Number(value) < 0 || Number(value) > 10) {
      missing.push(playerId);
      return { ...participant, rating: undefined };
    }

    return {
      ...participant,
      rating: Number(Number(value).toFixed(1)),
    };
  });

  if (missing.length) {
    throw new Error("Enter a valid 0–10 match rating for every participating player.");
  }

  return {
    ...payload,
    participants: nextParticipants,
  };
}

function installFetchBridge() {
  if (window.__ggV15FetchBridgeInstalled) return;
  window.__ggV15FetchBridgeInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const method = String(init.method || (typeof input !== "string" && input?.method) || "GET").toUpperCase();

    if (isMatchUrl(url) && method === "GET") {
      const response = await originalFetch(input, init);
      try {
        const clone = response.clone();
        const data = await clone.json();
        if (Array.isArray(data)) cachedMatches = data;
      } catch {
        // Ignore cache parsing errors.
      }
      return response;
    }

    if (isMatchUrl(url) && (method === "POST" || method === "PUT")) {
      let body = init.body;

      if (typeof body === "string") {
        try {
          const payload = JSON.parse(body);
          const nextPayload = validateAndInjectRatings(payload, url);
          body = JSON.stringify(nextPayload);
        } catch (error) {
          if (error?.message?.startsWith("Enter a valid")) {
            alert(error.message);
            return new Response(
              JSON.stringify({ message: error.message }),
              { status: 400, headers: { "Content-Type": "application/json" } }
            );
          }
          throw error;
        }
      }

      return originalFetch(input, { ...init, body });
    }

    return originalFetch(input, init);
  };
}

function installPlayerCacheBridge() {
  if (window.__ggV15PlayerCacheBridgeInstalled) return;
  window.__ggV15PlayerCacheBridgeInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    const response = await originalFetch(input, init);

    try {
      const parsedUrl = new URL(url, window.location.origin);
      if (parsedUrl.pathname.endsWith("/api/players") && String(init.method || "GET").toUpperCase() === "GET") {
        const clone = response.clone();
        const data = await clone.json();
        if (Array.isArray(data)) cachedPlayers = data;
      }
    } catch {
      // Ignore cache parsing errors.
    }

    return response;
  };
}

async function openAwards() {
  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;

  const modal = document.querySelector("[data-gg-awards-modal]");
  if (!modal) return;

  const content = modal.querySelector("[data-gg-awards-content]");
  modal.classList.add("is-open");
  content.innerHTML = `<div class="gg-awards-loading">Loading current GG awards...</div>`;

  try {
    const [leaderboardResponse, yearResponse, monthResponse] = await Promise.all([
      fetch(`${API_URL}/stats/leaderboard`),
      fetch(`${API_URL}/stats/awards?year=${year}`),
      fetch(`${API_URL}/stats/awards?year=${year}&month=${month}`),
    ]);

    if (!leaderboardResponse.ok || !yearResponse.ok || !monthResponse.ok) {
      throw new Error("Could not load current awards.");
    }

    const leaderboardData = await leaderboardResponse.json();
    const yearData = await yearResponse.json();
    const monthData = await monthResponse.json();
    const rows = Array.isArray(leaderboardData.leaderboard) ? leaderboardData.leaderboard : [];

    const goldenBoot = [...rows].sort((a, b) => b.goals - a.goals || b.ggRating - a.ggRating)[0] || null;
    const assistLeader = [...rows].sort((a, b) => b.assists - a.assists || b.ggRating - a.ggRating)[0] || null;

    const cards = [
      ["🏆", "PLAYER OF THE YEAR", yearData.winner],
      ["⭐", "PLAYER OF THE MONTH", monthData.winner],
      ["⚽", "GOLDEN BOOT", goldenBoot],
      ["A", "ASSIST LEADER", assistLeader],
    ];

    content.innerHTML = `
      <div class="gg-awards-grid">
        ${cards.map(([icon, label, player]) => `
          <article class="gg-award-showcase-card">
            <span class="gg-award-showcase-icon">${icon}</span>
            <span class="gg-award-showcase-label">${label}</span>
            <strong>${clean(player?.name) || "No eligible winner yet"}</strong>
            ${player?.ggRating != null ? `<small>GG Rating ${Number(player.ggRating).toFixed(2)}</small>` : ""}
            ${label === "GOLDEN BOOT" && player ? `<small>${player.goals} goals</small>` : ""}
            ${label === "ASSIST LEADER" && player ? `<small>${player.assists} assists</small>` : ""}
          </article>
        `).join("")}
      </div>
      <p class="gg-awards-footnote">Current awards are calculated from the recorded GG Matchday data.</p>
    `;
  } catch (error) {
    console.error("GG Awards panel error:", error);
    content.innerHTML = `<div class="gg-awards-error">${clean(error.message) || "Could not load awards."}</div>`;
  }
}

function installAwardsButton() {
  if (awardsButtonReady || document.querySelector("[data-gg-awards-button]")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "gg-awards-button";
  button.setAttribute("data-gg-awards-button", "true");
  button.setAttribute("aria-label", "Open GG Matchday awards");
  button.innerHTML = `<span>🏆</span><strong>Awards</strong>`;
  button.addEventListener("click", openAwards);
  document.body.appendChild(button);

  const modal = document.createElement("div");
  modal.className = "gg-awards-modal";
  modal.setAttribute("data-gg-awards-modal", "true");
  modal.innerHTML = `
    <div class="gg-awards-backdrop" data-gg-awards-close></div>
    <section class="gg-awards-dialog" role="dialog" aria-modal="true" aria-labelledby="gg-awards-title">
      <div class="gg-awards-dialog-head">
        <div>
          <p class="eyebrow">GG MATCHDAY</p>
          <h2 id="gg-awards-title">Awards</h2>
        </div>
        <button type="button" class="gg-awards-close" data-gg-awards-close aria-label="Close awards">×</button>
      </div>
      <div data-gg-awards-content></div>
    </section>
  `;

  document.body.appendChild(modal);
  modal.querySelectorAll("[data-gg-awards-close]").forEach((element) => {
    element.addEventListener("click", () => modal.classList.remove("is-open"));
  });

  awardsButtonReady = true;
}

function startObservers() {
  if (!ratingsObserver) {
    ratingsObserver = new MutationObserver(() => {
      injectRatingSection();
      installAwardsButton();
    });
    ratingsObserver.observe(document.body, { childList: true, subtree: true });
  }
}

installFetchBridge();
installPlayerCacheBridge();
startObservers();
installAwardsButton();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    injectRatingSection();
    installAwardsButton();
  }, { once: true });
} else {
  injectRatingSection();
}
