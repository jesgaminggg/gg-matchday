import { auth } from "./firebase";

const state = {
  players: null,
  ratings: new Map(),
};

async function getPlayers() {
  if (state.players) return state.players;
  try {
    const api = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
    const response = await fetch(`${api}/players`);
    const data = await response.json();
    state.players = Array.isArray(data) ? data : [];
  } catch (error) {
    console.error("V2 player lookup failed:", error);
    state.players = [];
  }
  return state.players;
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function getRows(record) {
  return Array.from(record.querySelectorAll(".assignment-row"));
}

function sourceCounterRows(record) {
  const rows = Array.from(record.querySelectorAll(".stat-entry"));
  const byName = new Map();
  for (const row of rows) {
    const name = normalize(row.querySelector("strong")?.textContent);
    if (!name) continue;
    const buttons = row.querySelectorAll(".counter button");
    const value = Number(row.querySelector(".counter > strong")?.textContent || 0);
    byName.set(name, { row, minus: buttons[0], plus: buttons[1], value });
  }
  return byName;
}

function makeButton(label, className, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function rebuild(record) {
  const existing = record.querySelector("[data-gg-v2-table]");
  if (existing) existing.remove();

  const assignment = getRows(record);
  if (!assignment.length) return;

  const goalRows = sourceCounterRows(record);
  const allRows = Array.from(record.querySelectorAll(".subsection"));
  const assistHeading = allRows.find((section) => normalize(section.querySelector(".eyebrow")?.textContent) === "ASSISTS");
  const assistRows = assistHeading ? sourceCounterRows(assistHeading) : new Map();

  const table = document.createElement("section");
  table.className = "subsection v2-record-table-wrap";
  table.dataset.ggV2Table = "true";
  table.innerHTML = `
    <div class="section-heading compact">
      <div>
        <p class="eyebrow">PLAYER PERFORMANCE</p>
        <h3>Match Stats</h3>
      </div>
      <span class="muted">Goals · Assists · Rating</span>
    </div>
    <div class="v2-record-grid v2-record-grid-head">
      <span>PLAYER</span><span>SIDE</span><span>GOALS</span><span>ASSISTS</span><span>RATING</span>
    </div>
    <div class="v2-record-grid-list"></div>
  `;

  const list = table.querySelector(".v2-record-grid-list");

  assignment.forEach((assignmentRow) => {
    const name = normalize(assignmentRow.querySelector(".assignment-player strong")?.textContent);
    if (!name) return;
    const teamButtons = assignmentRow.querySelectorAll(".team-switch button");
    const goal = goalRows.get(name);
    const assist = assistRows.get(name);
    const row = document.createElement("div");
    row.className = "v2-record-grid";

    const player = document.createElement("div");
    player.className = "v2-record-player";
    player.innerHTML = `<strong></strong><small></small>`;
    player.querySelector("strong").textContent = name;
    player.querySelector("small").textContent = normalize(assignmentRow.querySelector(".assignment-player small")?.textContent || "Not participating");

    const side = document.createElement("div");
    side.className = "v2-record-side";
    ["1", "2"].forEach((label, index) => {
      side.appendChild(makeButton(label, "v2-side-button", () => teamButtons[index]?.click()));
    });

    const counter = (source) => {
      const cell = document.createElement("div");
      cell.className = "v2-record-counter";
      const minus = makeButton("−", "v2-counter-button", () => source?.minus?.click());
      const value = document.createElement("strong");
      value.textContent = source?.value ?? "0";
      const plus = makeButton("+", "v2-counter-button", () => source?.plus?.click());
      if (!source) {
        minus.disabled = true;
        plus.disabled = true;
      }
      cell.append(minus, value, plus);
      return cell;
    };

    const rating = document.createElement("div");
    rating.className = "v2-rating-cell";
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "10";
    input.step = "0.1";
    input.placeholder = "—";
    input.value = state.ratings.get(name) ?? "";
    input.setAttribute("aria-label", `${name} match rating`);
    input.addEventListener("input", () => {
      const n = Number(input.value);
      if (input.value === "") state.ratings.delete(name);
      else if (Number.isFinite(n)) state.ratings.set(name, Math.max(0, Math.min(10, n)));
    });
    rating.appendChild(input);

    row.append(player, side, counter(goal), counter(assist), rating);
    list.appendChild(row);
  });

  record.querySelectorAll(".assignment-list, .v2-record-hidden-source").forEach((node) => {
    node.classList.add("v2-record-source-hidden");
  });
  record.querySelectorAll(".subsection").forEach((section) => {
    const eyebrow = normalize(section.querySelector(".eyebrow")?.textContent);
    if (["GOALS", "ASSISTS", "PARTICIPANTS"].includes(eyebrow)) section.classList.add("v2-source-section");
  });
  const firstSubsection = record.querySelector(".subsection");
  if (firstSubsection) firstSubsection.before(table);
}

function activeRecord() {
  return Array.from(document.querySelectorAll(".tab-content")).find((section) => {
    const title = normalize(section.querySelector(".page-title h2")?.textContent);
    return title === "Record a Match" || title === "Edit Match";
  }) || null;
}

async function syncRatings(response, ratingsByName) {
  try {
    if (!auth.currentUser) return;
    const body = await response.clone().json().catch(() => null);
    const matchId = body?.match?._id;
    if (!matchId) return;
    const players = await getPlayers();
    const payload = [];
    for (const [name, rating] of ratingsByName.entries()) {
      const player = players.find((item) => normalize(item.name) === normalize(name));
      if (player && Number.isFinite(Number(rating))) payload.push({ player: player._id, rating: Number(rating) });
    }
    if (!payload.length) return;
    const token = await auth.currentUser.getIdToken();
    const api = import.meta.env.VITE_API_URL || "http://localhost:5000/api";
    await fetch(`${api}/v2/matches/${matchId}/ratings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ratings: payload }),
    });
  } catch (error) {
    console.error("V2 rating sync failed:", error);
  }
}

const originalFetch = window.fetch.bind(window);
window.fetch = async function v2Fetch(input, options = {}) {
  const response = await originalFetch(input, options);
  const url = typeof input === "string" ? input : input?.url || "";
  const method = String(options?.method || input?.method || "GET").toUpperCase();
  if (/\/api\/matches(?:\/[^/]+)?$/i.test(url) && ["POST", "PUT"].includes(method)) {
    const ratings = new Map(state.ratings);
    void syncRatings(response, ratings);
  }
  return response;
};

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const record = activeRecord();
    if (record) rebuild(record);
  });
});
observer.observe(document.body, { childList: true, subtree: true, characterData: true });

setTimeout(() => {
  const record = activeRecord();
  if (record) rebuild(record);
}, 0);
