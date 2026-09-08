/*
 * GG Matchday v1.4 — Record page reorganization
 *
 * Keeps the existing React data/state logic intact while presenting one
 * compact row per player: player name, side selection, goals and assists.
 */

const RECORD_MARKER = "data-gg-v14-record";

function normalize(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function makeButton(className, label, onClick, disabled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", onClick);
  return button;
}

function readCounterRow(row) {
  const name = normalize(
    row.querySelector("strong")?.textContent
  );
  const buttons = Array.from(
    row.querySelectorAll(".counter button")
  );
  const value = normalize(
    row.querySelector(".counter > strong")?.textContent
  );

  return {
    name,
    value: value || "0",
    minus: buttons[0] || null,
    plus: buttons[1] || null,
  };
}

function buildRecordStats(record) {
  if (!record || record.hasAttribute(RECORD_MARKER)) return;

  const assignmentSection = Array.from(
    record.querySelectorAll(".subsection")
  ).find((section) =>
    normalize(section.textContent).includes("Assign Players")
  );

  if (!assignmentSection) return;

  const assignmentRows = Array.from(
    assignmentSection.querySelectorAll(".assignment-row")
  );

  if (!assignmentRows.length) return;

  const originalSections = Array.from(
    record.querySelectorAll(".subsection")
  );

  const goalSections = originalSections.filter((section) =>
    normalize(section.querySelector(".eyebrow")?.textContent) === "GOALS"
  );

  const assistSection = originalSections.find((section) =>
    normalize(section.querySelector(".eyebrow")?.textContent) === "ASSISTS"
  );

  const goals = new Map();
  goalSections.forEach((section) => {
    section.querySelectorAll(".stat-entry").forEach((row) => {
      const item = readCounterRow(row);
      if (item.name) goals.set(item.name, item);
    });
  });

  const assists = new Map();
  assistSection?.querySelectorAll(".stat-entry").forEach((row) => {
    const item = readCounterRow(row);
    if (item.name) assists.set(item.name, item);
  });

  const combined = document.createElement("section");
  combined.className = "subsection v14-record-stats";
  combined.setAttribute(RECORD_MARKER, "true");

  combined.innerHTML = `
    <div class="section-heading compact">
      <div>
        <p class="eyebrow">PLAYER STATS</p>
        <h3>Goals &amp; Assists</h3>
      </div>
      <span class="muted">Set the side, then add stats</span>
    </div>
    <div class="v14-stat-head">
      <span>PLAYER</span>
      <span>SIDE</span>
      <span>GOALS</span>
      <span>ASSISTS</span>
    </div>
    <div class="v14-stat-list"></div>
  `;

  const list = combined.querySelector(".v14-stat-list");

  assignmentRows.forEach((assignmentRow) => {
    const name = normalize(
      assignmentRow.querySelector(".assignment-player strong")?.textContent
    );
    if (!name) return;

    const teamButtons = assignmentRow.querySelectorAll(".team-switch button");
    const goal = goals.get(name);
    const assist = assists.get(name);
    const assigned = normalize(
      assignmentRow.querySelector(".assignment-player small")?.textContent
    ) !== "Not participating";

    const row = document.createElement("div");
    row.className = "v14-stat-row";

    const playerCell = document.createElement("div");
    playerCell.className = "v14-player-cell";
    const playerName = document.createElement("strong");
    playerName.textContent = name;
    const teamLabel = document.createElement("small");
    teamLabel.textContent = normalize(
      assignmentRow.querySelector(".assignment-player small")?.textContent
    );
    playerCell.append(playerName, teamLabel);

    const sideCell = document.createElement("div");
    sideCell.className = "v14-side-cell";

    ["1", "2"].forEach((label, index) => {
      const source = teamButtons[index];
      const proxy = makeButton(
        "v14-side-button",
        label,
        () => source?.click(),
        !source
      );
      sideCell.appendChild(proxy);
    });

    function counterCell(item) {
      const cell = document.createElement("div");
      cell.className = "v14-counter-cell";
      const minus = makeButton(
        "v14-counter-button",
        "−",
        () => item?.minus?.click(),
        !item || !assigned
      );
      const value = document.createElement("strong");
      value.className = "v14-counter-value";
      value.textContent = item?.value || "0";
      const plus = makeButton(
        "v14-counter-button",
        "+",
        () => item?.plus?.click(),
        !item || !assigned
      );
      cell.append(minus, value, plus);
      return cell;
    }

    row.append(
      playerCell,
      sideCell,
      counterCell(goal),
      counterCell(assist)
    );

    list.appendChild(row);
  });

  assignmentSection.parentNode.insertBefore(combined, assignmentSection);
  assignmentSection.style.display = "none";
  goalSections.forEach((section) => {
    section.style.display = "none";
  });
  if (assistSection) assistSection.style.display = "none";

  // React owns the source controls. Rebuild this presentation whenever React
  // changes the assignment/stats DOM so counters and team labels stay current.
  record.setAttribute(RECORD_MARKER, "true");
}

function refreshRecord(record) {
  const existing = record.querySelector(`[${RECORD_MARKER}="true"]`);
  if (existing) {
    existing.remove();
    record.removeAttribute(RECORD_MARKER);
    record.querySelectorAll(".subsection").forEach((section) => {
      section.style.display = "";
    });
  }
  buildRecordStats(record);
}

function scan() {
  document.querySelectorAll(".tab-content").forEach((section) => {
    const heading = normalize(section.querySelector(".page-title h2")?.textContent);
    if (heading !== "Record a Match" && heading !== "Edit Match") return;
    refreshRecord(section);
  });
}

let scheduled = false;
const observer = new MutationObserver(() => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    scan();
  });
});

observer.observe(document.body, {
  childList: true,
  subtree: true,
  characterData: true,
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", scan, { once: true });
} else {
  scan();
}
