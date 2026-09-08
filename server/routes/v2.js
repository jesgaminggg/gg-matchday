import express from "express";
import Player from "../models/Player.js";
import Match from "../models/Match.js";
import User from "../models/User.js";
import MatchRating from "../models/MatchRating.js";
import MotmVote from "../models/MotmVote.js";
import Award from "../models/Award.js";
import ProfilePreferenceRequest from "../models/ProfilePreferenceRequest.js";
import PlayerV2Meta from "../models/PlayerV2Meta.js";
import Gallery from "../models/Gallery.js";
import { requireAuth, requireEditor, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

const POSITION_OPTIONS = ["GK", "LB", "CB", "RB", "LWB", "RWB", "CDM", "CM", "CAM", "LM", "RM", "LW", "RW", "ST", "CF"];

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function pct(value) {
  return Number((Math.max(0, Math.min(1, value)) * 100).toFixed(2));
}

function clamp10(value) {
  return Math.max(0, Math.min(10, safeNumber(value)));
}

function rounded(value, digits = 2) {
  return Number(safeNumber(value).toFixed(digits));
}

function dateRange(year, month = null) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  if (!month) {
    return { $gte: new Date(Date.UTC(y, 0, 1)), $lt: new Date(Date.UTC(y + 1, 0, 1)) };
  }
  const m = Number(month);
  if (!Number.isInteger(m) || m < 1 || m > 12) return null;
  return { $gte: new Date(Date.UTC(y, m - 1, 1)), $lt: new Date(Date.UTC(y, m, 1)) };
}

function normalizeElClasicoName(name = "") {
  return String(name)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "") === "elclasico";
}

function normalizePositionList(value) {
  const values = Array.isArray(value) ? value : [];
  return [...new Set(values.map((item) => String(item).trim().toUpperCase()).filter((item) => POSITION_OPTIONS.includes(item)))].slice(0, 5);
}

async function loadMetaMap() {
  const docs = await PlayerV2Meta.find().lean();
  return new Map(docs.map((doc) => [String(doc.player), doc]));
}

async function loadRatingsForMatches(matches) {
  const ids = matches.map((m) => m._id);
  if (!ids.length) return [];
  return MatchRating.find({ match: { $in: ids } }).lean();
}

function buildPlayerStats(players, matches, ratings, options = {}) {
  const metaMap = options.metaMap || new Map();
  const ratingMap = new Map();
  for (const row of ratings) {
    const key = `${String(row.match)}:${String(row.player)}`;
    ratingMap.set(key, safeNumber(row.rating, null));
  }

  const stats = new Map(players.map((player) => [String(player._id), {
    playerId: String(player._id),
    name: player.name,
    profileImage: player.profileImage || "",
    position: player.position || "",
    preferredPositions: metaMap.get(String(player._id))?.preferredPositions || [],
    elClasicoSide: metaMap.get(String(player._id))?.elClasicoSide || "",
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals: 0,
    assists: 0,
    cleanSheets: 0,
    ratedMatches: 0,
    ratingTotal: 0,
    averageMatchRating: null,
    goalContributions: 0,
    winRate: 0,
    lossRate: 0,
    cleanSheetRate: 0,
    goalScore: 0,
    assistScore: 0,
    offensiveRaw: 0,
    defensiveRaw: 0,
    offensiveRating: 0,
    defensiveRating: 0,
    resultScore: 5,
    ggRating: null,
  }]));

  for (const match of matches) {
    const a = safeNumber(match.teamA?.score);
    const b = safeNumber(match.teamB?.score);
    const participants = match.participants || [];

    const participantMap = new Map(participants.map((p) => [String(p.player?._id || p.player), p.team]));

    for (const participant of participants) {
      const id = String(participant.player?._id || participant.player);
      const s = stats.get(id);
      if (!s) continue;
      s.matches += 1;
      const own = participant.team === "A" ? a : b;
      const opp = participant.team === "A" ? b : a;
      if (own > opp) s.wins += 1;
      else if (own < opp) s.losses += 1;
      else s.draws += 1;
      if (own > 0 || opp === 0) {
        // no-op; kept explicit below for clarity
      }
      if (opp === 0) s.cleanSheets += 1;

      const matchRating = ratingMap.get(`${String(match._id)}:${id}`);
      if (matchRating !== undefined && matchRating !== null) {
        s.ratedMatches += 1;
        s.ratingTotal += matchRating;
      }
    }

    for (const event of match.events || []) {
      const id = String(event.player?._id || event.player);
      const s = stats.get(id);
      if (!s) continue;
      if (event.type === "goal") s.goals += 1;
      if (event.type === "assist") s.assists += 1;
    }
  }

  const rows = [...stats.values()];
  for (const s of rows) {
    s.goalContributions = s.goals + s.assists;
    s.winRate = s.matches ? s.wins / s.matches : 0;
    s.lossRate = s.matches ? s.losses / s.matches : 0;
    s.cleanSheetRate = s.matches ? s.cleanSheets / s.matches : 0;
    s.averageMatchRating = s.ratedMatches ? rounded(s.ratingTotal / s.ratedMatches, 2) : null;
    s.goalScore = s.matches ? s.goals / s.matches : 0;
    s.assistScore = s.matches ? s.assists / s.matches : 0;
    s.offensiveRaw = (s.goalScore * 1) + (s.assistScore * 0.75);
    s.defensiveRaw = (s.cleanSheetRate * 1) + (s.winRate * 0.5);
    s.resultScore = s.matches ? 5 + ((s.winRate - s.lossRate) * 5) : 5;
  }

  const eligibleOffensive = rows.filter((s) => s.matches >= 5);
  const eligibleDefensive = rows.filter((s) => s.matches >= 5);
  const maxOff = eligibleOffensive.map((s) => s.offensiveRaw).sort((a, b) => a - b);
  const maxDef = eligibleDefensive.map((s) => s.defensiveRaw).sort((a, b) => a - b);

  function percentile(value, values) {
    if (!values.length) return 0;
    if (values.length === 1) return 1;
    const below = values.filter((v) => v < value).length;
    const equal = values.filter((v) => v === value).length;
    return (below + equal * 0.5) / (values.length - 1);
  }

  for (const s of rows) {
    if (s.matches < 5) {
      s.offensiveRating = 0;
      s.defensiveRating = 0;
      s.ggRating = null;
      continue;
    }
    s.offensiveRating = rounded(percentile(s.offensiveRaw, maxOff) * 10, 2);
    s.defensiveRating = rounded(percentile(s.defensiveRaw, maxDef) * 10, 2);
    if (s.averageMatchRating === null) {
      s.ggRating = null;
      continue;
    }
    s.ggRating = rounded(
      (s.averageMatchRating * 0.4) +
      (s.offensiveRating * 0.2) +
      (s.defensiveRating * 0.2) +
      (clamp10(s.resultScore) * 0.2),
      2
    );
  }

  return rows.sort((a, b) => {
    const ar = a.ggRating ?? -1;
    const br = b.ggRating ?? -1;
    if (br !== ar) return br - ar;
    if ((b.averageMatchRating ?? -1) !== (a.averageMatchRating ?? -1)) return (b.averageMatchRating ?? -1) - (a.averageMatchRating ?? -1);
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.goalContributions !== a.goalContributions) return b.goalContributions - a.goalContributions;
    if (b.cleanSheetRate !== a.cleanSheetRate) return b.cleanSheetRate - a.cleanSheetRate;
    if (b.matches !== a.matches) return b.matches - a.matches;
    return a.name.localeCompare(b.name);
  }).map((row, index) => ({ rank: index + 1, ...row }));
}

async function calculateStats(query = {}) {
  const [players, matches, metaMap] = await Promise.all([
    Player.find().sort({ name: 1 }).lean(),
    Match.find(query).populate("participants.player", "name profileImage").populate("events.player", "name profileImage").sort({ date: -1 }).lean(),
    loadMetaMap(),
  ]);
  const ratings = await loadRatingsForMatches(matches);
  return { players, matches, ratings, metaMap, stats: buildPlayerStats(players, matches, ratings, { metaMap }) };
}

// --------------------------------------------------
// LEADERBOARD / RATING
// --------------------------------------------------
router.get("/leaderboard", async (req, res) => {
  try {
    const query = {};
    const year = req.query.year ? Number(req.query.year) : null;
    const month = req.query.month ? Number(req.query.month) : null;
    if (year) {
      const range = dateRange(year, month);
      if (!range) return res.status(400).json({ message: "Invalid year or month." });
      query.date = range;
    }
    const { stats } = await calculateStats(query);
    const position = String(req.query.position || "").toUpperCase();
    const filtered = position ? stats.filter((s) => s.position.toUpperCase() === position || s.preferredPositions.includes(position)) : stats;
    res.json({ season: year || new Date().getFullYear(), leaderboard: filtered });
  } catch (error) {
    console.error("V2 leaderboard error:", error);
    res.status(500).json({ message: "Failed to calculate GG ratings." });
  }
});

router.get("/player/:id", async (req, res) => {
  try {
    const { players, stats } = await calculateStats();
    const player = players.find((p) => String(p._id) === String(req.params.id));
    const row = stats.find((s) => String(s.playerId) === String(req.params.id));
    if (!player || !row) return res.status(404).json({ message: "Player not found." });
    const achievements = [];
    const add = (id, label, unlocked) => achievements.push({ id, label, unlocked });
    add("first-goal", "First Goal", row.goals >= 1);
    add("10-goals", "10 Goals", row.goals >= 10);
    add("25-goals", "25 Goals", row.goals >= 25);
    add("50-goals", "50 Goals", row.goals >= 50);
    add("first-assist", "First Assist", row.assists >= 1);
    add("10-assists", "10 Assists", row.assists >= 10);
    add("25-assists", "25 Assists", row.assists >= 25);
    add("10-matches", "10 Matches Played", row.matches >= 10);
    add("clean-sheet", "First Clean Sheet", row.cleanSheets >= 1);
    res.json({ player, stats: row, achievements: achievements.filter((a) => a.unlocked) });
  } catch (error) {
    console.error("V2 player error:", error);
    res.status(500).json({ message: "Failed to load player profile." });
  }
});

router.get("/player/:id/achievements", async (req, res) => {
  try {
    const response = await fetch(`${req.protocol}://${req.get("host")}/api/v2/player/${req.params.id}`);
    if (!response.ok) return res.status(response.status).json({ message: "Failed to load achievements." });
    const data = await response.json();
    res.json({ achievements: data.achievements || [] });
  } catch {
    res.status(500).json({ message: "Failed to load achievements." });
  }
});

// --------------------------------------------------
// MATCH RATINGS
// --------------------------------------------------
router.get("/matches/:matchId/ratings", async (req, res) => {
  try {
    const rows = await MatchRating.find({ match: req.params.matchId }).populate("player", "name profileImage").lean();
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to load match ratings." });
  }
});

router.post("/matches/:matchId/ratings", requireAuth, requireEditor, async (req, res) => {
  try {
    const match = await Match.findById(req.params.matchId).lean();
    if (!match) return res.status(404).json({ message: "Match not found." });
    const submitted = Array.isArray(req.body?.ratings) ? req.body.ratings : [];
    const participants = new Set((match.participants || []).map((p) => String(p.player)));
    const clean = submitted.map((item) => ({
      player: String(item.player),
      rating: Number(item.rating),
    })).filter((item) => participants.has(item.player) && Number.isFinite(item.rating) && item.rating >= 0 && item.rating <= 10);
    await MatchRating.deleteMany({ match: match._id });
    if (clean.length) await MatchRating.insertMany(clean.map((item) => ({ match: match._id, player: item.player, rating: rounded(item.rating, 2) })), { ordered: false });
    res.json({ message: "Match ratings saved.", ratings: clean });
  } catch (error) {
    console.error("Rating save error:", error);
    res.status(400).json({ message: "Could not save match ratings." });
  }
});

// --------------------------------------------------
// POTM VOTING (ONE-WAY, ONE VOTE PER USER/MATCH)
// --------------------------------------------------
router.get("/matches/:matchId/potm", async (req, res) => {
  try {
    const votes = await MotmVote.find({ match: req.params.matchId }).populate("player", "name profileImage").lean();
    const counts = {};
    for (const vote of votes) {
      const id = String(vote.player?._id || vote.player);
      counts[id] = (counts[id] || 0) + 1;
    }
    res.json({ votes: counts, totalVotes: votes.length });
  } catch (error) {
    res.status(500).json({ message: "Failed to load POTM voting." });
  }
});

router.post("/matches/:matchId/potm", requireAuth, async (req, res) => {
  try {
    const match = await Match.findById(req.params.matchId).lean();
    const playerId = String(req.body?.playerId || "");
    if (!match || !playerId) return res.status(400).json({ message: "Valid match and player are required." });
    const participantIds = new Set((match.participants || []).map((p) => String(p.player)));
    if (!participantIds.has(playerId)) return res.status(400).json({ message: "Only match participants can receive a POTM vote." });
    const existing = await MotmVote.findOne({ match: match._id, voter: req.user._id });
    if (existing) return res.status(409).json({ message: "You have already voted for this match." });
    await MotmVote.create({ match: match._id, player: playerId, voter: req.user._id });
    res.status(201).json({ message: "POTM vote recorded." });
  } catch (error) {
    if (error?.code === 11000) return res.status(409).json({ message: "You have already voted for this match." });
    res.status(400).json({ message: "Could not record POTM vote." });
  }
});

// --------------------------------------------------
// AWARDS / SEASONS
// --------------------------------------------------
async function getAwardCandidates(year, month = null) {
  const query = { date: dateRange(year, month) };
  const { stats } = await calculateStats(query);
  const eligible = stats.filter((s) => s.matches >= (month ? 3 : 10) && s.ggRating !== null);
  const offensive = stats.filter((s) => s.matches >= 5).sort((a, b) => b.offensiveRating - a.offensiveRating || b.goals - a.goals || b.assists - a.assists || (b.averageMatchRating || 0) - (a.averageMatchRating || 0))[0] || null;
  const defensive = stats.filter((s) => s.matches >= 5).sort((a, b) => b.defensiveRating - a.defensiveRating || b.cleanSheetRate - a.cleanSheetRate || b.cleanSheets - a.cleanSheets || b.winRate - a.winRate || (b.averageMatchRating || 0) - (a.averageMatchRating || 0))[0] || null;
  const winner = eligible[0] || null;
  return { stats, winner, offensive, defensive };
}

router.get("/awards", async (req, res) => {
  try {
    const year = Number(req.query.year || new Date().getFullYear());
    const month = req.query.month ? Number(req.query.month) : null;
    const result = await getAwardCandidates(year, month);
    res.json({ year, month, playerOfMonth: month ? result.winner : null, playerOfYear: month ? null : result.winner, bestOffensive: result.offensive, bestDefensive: result.defensive });
  } catch (error) {
    res.status(500).json({ message: "Failed to calculate V2 awards." });
  }
});

router.post("/awards/snapshot", requireAuth, requireAdmin, async (req, res) => {
  try {
    const year = Number(req.body?.year || new Date().getFullYear());
    const month = req.body?.month ? Number(req.body.month) : null;
    const result = await getAwardCandidates(year, month);
    const entries = [];
    if (month && result.winner) entries.push(["player_of_month", result.winner]);
    if (!month && result.winner) entries.push(["player_of_year", result.winner]);
    if (result.offensive) entries.push(["best_offensive", result.offensive]);
    if (result.defensive) entries.push(["best_defensive", result.defensive]);
    for (const [awardType, player] of entries) {
      await Award.findOneAndUpdate(
        { awardType, year, month: month || null },
        { player: player.playerId, rating: player.ggRating, metadata: { goals: player.goals, assists: player.assists, cleanSheets: player.cleanSheets } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    res.json({ message: "Award snapshot saved.", year, month, entries: entries.map(([type, player]) => ({ type, player: player.name })) });
  } catch (error) {
    res.status(500).json({ message: "Failed to save award snapshot." });
  }
});

router.get("/seasons", async (req, res) => {
  try {
    const matches = await Match.find().select("date").sort({ date: 1 }).lean();
    const years = [...new Set(matches.map((m) => new Date(m.date).getUTCFullYear()))];
    res.json({ seasons: years });
  } catch (error) {
    res.status(500).json({ message: "Failed to load seasons." });
  }
});

router.get("/seasons/:year", async (req, res) => {
  try {
    const year = Number(req.params.year);
    const range = dateRange(year);
    if (!range) return res.status(400).json({ message: "Invalid season year." });
    const { stats, matches } = await calculateStats({ date: range });
    const awards = await Award.find({ year }).populate("player", "name profileImage position").sort({ month: 1, awardType: 1 }).lean();
    res.json({ year, stats, matches, awards });
  } catch (error) {
    res.status(500).json({ message: "Failed to load season." });
  }
});

// --------------------------------------------------
// PLAYER PREFERENCES: POSITIONS + EL CLASICO SIDE
// --------------------------------------------------
router.get("/preferences/me", requireAuth, async (req, res) => {
  try {
    const linkedPlayer = req.user.playerProfile ? String(req.user.playerProfile) : null;
    if (!linkedPlayer) return res.json({ linkedPlayer: null, meta: null, pending: null });
    const [meta, pending] = await Promise.all([
      PlayerV2Meta.findOne({ player: linkedPlayer }).lean(),
      ProfilePreferenceRequest.findOne({ requestedBy: req.user._id, status: "pending" }).lean(),
    ]);
    res.json({ linkedPlayer, meta, pending, positionOptions: POSITION_OPTIONS });
  } catch (error) {
    res.status(500).json({ message: "Failed to load profile preferences." });
  }
});

router.post("/preferences/me", requireAuth, async (req, res) => {
  try {
    if (!req.user.playerProfile) return res.status(400).json({ message: "Your account is not linked to a player profile yet." });
    const positions = normalizePositionList(req.body?.preferredPositions);
    const side = ["", "Messi", "Ronaldo"].includes(req.body?.elClasicoSide) ? req.body.elClasicoSide : "";
    if (!positions.length && !side) return res.status(400).json({ message: "Choose at least one preferred position or an El Clásico side." });
    const pending = await ProfilePreferenceRequest.findOne({ requestedBy: req.user._id, status: "pending" });
    if (pending) return res.status(409).json({ message: "You already have a profile preference request pending." });
    const request = await ProfilePreferenceRequest.create({ requestedBy: req.user._id, player: req.user.playerProfile, preferredPositions: positions, elClasicoSide: side });
    res.status(201).json(request);
  } catch (error) {
    res.status(400).json({ message: "Could not submit preference request." });
  }
});

router.get("/preferences/admin", requireAuth, requireAdmin, async (req, res) => {
  try {
    const requests = await ProfilePreferenceRequest.find({ status: "pending" })
      .populate("requestedBy", "name email")
      .populate("player", "name profileImage position")
      .sort({ createdAt: -1 })
      .lean();
    res.json(requests);
  } catch (error) {
    res.status(500).json({ message: "Failed to load preference requests." });
  }
});

router.post("/preferences/admin/:id/approve", requireAuth, requireAdmin, async (req, res) => {
  try {
    const request = await ProfilePreferenceRequest.findOne({ _id: req.params.id, status: "pending" });
    if (!request) return res.status(404).json({ message: "Pending request not found." });
    const meta = await PlayerV2Meta.findOneAndUpdate(
      { player: request.player },
      { preferredPositions: request.preferredPositions || [], elClasicoSide: request.elClasicoSide || "" },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    request.status = "approved";
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    await request.save();
    res.json({ message: "Preference request approved.", meta });
  } catch (error) {
    res.status(500).json({ message: "Failed to approve preference request." });
  }
});

router.post("/preferences/admin/:id/reject", requireAuth, requireAdmin, async (req, res) => {
  try {
    const request = await ProfilePreferenceRequest.findOne({ _id: req.params.id, status: "pending" });
    if (!request) return res.status(404).json({ message: "Pending request not found." });
    request.status = "rejected";
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    request.rejectionReason = String(req.body?.reason || "").slice(0, 300);
    await request.save();
    res.json({ message: "Preference request rejected." });
  } catch (error) {
    res.status(500).json({ message: "Failed to reject preference request." });
  }
});

// --------------------------------------------------
// SQUAD
// --------------------------------------------------
router.get("/squad", async (req, res) => {
  try {
    const { players, metaMap, stats } = await calculateStats();
    const enriched = players.map((player) => {
      const stat = stats.find((row) => row.playerId === String(player._id));
      return {
        ...player,
        preferredPositions: metaMap.get(String(player._id))?.preferredPositions || [],
        elClasicoSide: metaMap.get(String(player._id))?.elClasicoSide || "",
        stats: stat ? { matches: stat.matches, goals: stat.goals, assists: stat.assists, ggRating: stat.ggRating } : null,
      };
    });
    res.json({ players: enriched, positionOptions: POSITION_OPTIONS });
  } catch (error) {
    res.status(500).json({ message: "Failed to load squad." });
  }
});

// --------------------------------------------------
// EL CLASICO
// --------------------------------------------------
router.get("/el-clasico", async (req, res) => {
  try {
    const allMatches = await Match.find().populate("participants.player", "name profileImage").populate("events.player", "name profileImage").sort({ date: -1 }).lean();
    const matches = allMatches.filter((match) => normalizeElClasicoName(match.name));
    const playerIds = [...new Set(matches.flatMap((m) => (m.participants || []).map((p) => String(p.player?._id || p.player))))];
    const players = await Player.find({ _id: { $in: playerIds } }).lean();
    const metaMap = await loadMetaMap();
    const result = { Messi: { matches: 0, wins: 0, losses: 0, draws: 0, goals: 0, assists: 0, cleanSheets: 0, players: [] }, Ronaldo: { matches: 0, wins: 0, losses: 0, draws: 0, goals: 0, assists: 0, cleanSheets: 0, players: [] } };
    const perPlayer = new Map(players.map((p) => [String(p._id), { playerId: String(p._id), name: p.name, profileImage: p.profileImage || "", side: metaMap.get(String(p._id))?.elClasicoSide || "", matches: 0, wins: 0, losses: 0, draws: 0, goals: 0, assists: 0, cleanSheets: 0, ratings: [] }]));
    const ratingRows = await loadRatingsForMatches(matches);
    const ratingMap = new Map(ratingRows.map((r) => [`${String(r.match)}:${String(r.player)}`, safeNumber(r.rating, null)]));
    for (const match of matches) {
      const a = safeNumber(match.teamA?.score);
      const b = safeNumber(match.teamB?.score);
      const outcome = a === b ? "draws" : a > b ? "wins" : "losses";
      for (const p of match.participants || []) {
        const id = String(p.player?._id || p.player);
        const row = perPlayer.get(id);
        if (!row || !row.side) continue;
        row.matches += 1;
        const own = p.team === "A" ? a : b;
        const opp = p.team === "A" ? b : a;
        if (own > opp) row.wins += 1;
        else if (own < opp) row.losses += 1;
        else row.draws += 1;
        if (opp === 0) row.cleanSheets += 1;
        const rating = ratingMap.get(`${String(match._id)}:${id}`);
        if (rating !== undefined && rating !== null) row.ratings.push(rating);
      }
      for (const event of match.events || []) {
        const id = String(event.player?._id || event.player);
        const row = perPlayer.get(id);
        if (!row || !row.side) continue;
        if (event.type === "goal") row.goals += 1;
        if (event.type === "assist") row.assists += 1;
      }
    }
    for (const row of perPlayer.values()) {
      if (!result[row.side]) continue;
      const side = result[row.side];
      side.matches += row.matches;
      side.wins += row.wins;
      side.losses += row.losses;
      side.draws += row.draws;
      side.goals += row.goals;
      side.assists += row.assists;
      side.cleanSheets += row.cleanSheets;
    }
    result.Messi.players = [...perPlayer.values()].filter((p) => p.side === "Messi").sort((a, b) => b.goals + b.assists - (a.goals + a.assists));
    result.Ronaldo.players = [...perPlayer.values()].filter((p) => p.side === "Ronaldo").sort((a, b) => b.goals + b.assists - (a.goals + a.assists));
    res.json({ matches, sides: result, note: "Only matches named El Clásico are included." });
  } catch (error) {
    console.error("El Clasico error:", error);
    res.status(500).json({ message: "Failed to load El Clásico data." });
  }
});

router.post("/el-clasico/commentary", requireAuth, async (req, res) => {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(503).json({ message: "Gemini is not configured." });
    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
    const payload = JSON.stringify(req.body?.data || {});
    const prompt = `You are the immersive GG Matchday football commentator. Use ONLY the supplied recorded data. Never invent a match, player, stat or event. Compare the Messi Fans and Ronaldo Fans in an engaging but concise football-broadcast tone. Mention the leading contributors and the current balance of the rivalry. Do not mention that you are an AI. Data: ${payload}`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ message: "Gemini commentary failed." });
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join(" ").trim();
    if (!text) return res.status(502).json({ message: "Gemini returned no commentary." });
    res.json({ commentary: text });
  } catch (error) {
    console.error("El Clasico commentary error:", error);
    res.status(500).json({ message: "Failed to generate El Clásico commentary." });
  }
});

// --------------------------------------------------
// GALLERY ASSOCIATIONS
// --------------------------------------------------
router.post("/gallery/:id/associate", requireAuth, async (req, res) => {
  try {
    const photo = await Gallery.findById(req.params.id);
    if (!photo) return res.status(404).json({ message: "Photo not found." });
    const matchId = req.body?.matchId || null;
    const playerId = req.body?.playerId || null;
    if (matchId) {
      const match = await Match.findById(matchId).select("_id");
      if (!match) return res.status(400).json({ message: "Match not found." });
    }
    if (playerId) {
      const player = await Player.findById(playerId).select("_id");
      if (!player) return res.status(400).json({ message: "Player not found." });
    }
    photo.matchId = matchId;
    photo.playerId = playerId;
    await photo.save();
    res.json({ message: "Gallery association saved.", photo });
  } catch (error) {
    res.status(400).json({ message: "Could not associate gallery photo." });
  }
});

export default router;
