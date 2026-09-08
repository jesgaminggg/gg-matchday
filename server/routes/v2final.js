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
import Like from "../models/Like.js";
import { requireAuth, requireEditor, requireAdmin } from "../middleware/auth.js";

const router = express.Router();

const POSITION_OPTIONS = [
  "GK", "LB", "CB", "RB", "LWB", "RWB",
  "CDM", "CM", "CAM", "LM", "RM", "LW", "RW", "ST", "CF",
];

const ATTACK_POSITIONS = new Set(["LW", "RW", "ST", "CF"]);
const MID_POSITIONS = new Set(["CDM", "CM", "CAM", "LM", "RM"]);
const DEF_POSITIONS = new Set(["LB", "CB", "RB", "LWB", "RWB"]);

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round(value, digits = 2) {
  return Number(num(value).toFixed(digits));
}

function clamp10(value) {
  return Math.max(0, Math.min(10, num(value)));
}

function yearRange(year, month = null) {
  const y = Number(year);
  if (!Number.isInteger(y) || y < 2000 || y > 2100) return null;
  if (!month) return { $gte: new Date(Date.UTC(y, 0, 1)), $lt: new Date(Date.UTC(y + 1, 0, 1)) };
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

function normalizePositions(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((v) => String(v).trim().toUpperCase()).filter((v) => POSITION_OPTIONS.includes(v)))].slice(0, 5);
}

function playerCategory(player) {
  const positions = [
    ...(Array.isArray(player.preferredPositions) ? player.preferredPositions : []),
    player.position,
  ].map((p) => String(p || "").toUpperCase()).filter(Boolean);
  if (positions.includes("GK")) return "goalkeeper";
  if (positions.some((p) => DEF_POSITIONS.has(p))) return "defender";
  if (positions.some((p) => MID_POSITIONS.has(p))) return "midfielder";
  if (positions.some((p) => ATTACK_POSITIONS.has(p))) return "attacker";
  return "other";
}

async function loadMetaMap() {
  const docs = await PlayerV2Meta.find().lean();
  return new Map(docs.map((doc) => [String(doc.player), doc]));
}

async function buildStats(query = {}) {
  const [players, matches, metaMap] = await Promise.all([
    Player.find().sort({ name: 1 }).lean(),
    Match.find(query)
      .populate("participants.player", "name profileImage")
      .populate("events.player", "name profileImage")
      .sort({ date: -1 })
      .lean(),
    loadMetaMap(),
  ]);

  const matchIds = matches.map((m) => m._id);
  const ratingRows = matchIds.length ? await MatchRating.find({ match: { $in: matchIds } }).lean() : [];
  const ratingMap = new Map(ratingRows.map((r) => [`${String(r.match)}:${String(r.player)}`, num(r.rating, null)]));

  const stats = new Map(players.map((p) => [String(p._id), {
    playerId: String(p._id), name: p.name, profileImage: p.profileImage || "",
    position: p.position || "", preferredPositions: metaMap.get(String(p._id))?.preferredPositions || [],
    elClasicoSide: metaMap.get(String(p._id))?.elClasicoSide || "",
    category: playerCategory({ ...p, preferredPositions: metaMap.get(String(p._id))?.preferredPositions || [] }),
    matches: 0, wins: 0, draws: 0, losses: 0,
    goals: 0, assists: 0, goalContributions: 0,
    cleanSheets: 0, cleanSheetRate: 0, winRate: 0, lossRate: 0,
    ratedMatches: 0, ratingTotal: 0, averageMatchRating: null,
    goalScore: 0, assistScore: 0, offensiveRaw: 0, defensiveRaw: 0,
    offensiveRating: 0, defensiveRating: 0, resultScore: 5, ggRating: null,
  }]));

  for (const match of matches) {
    const a = num(match.teamA?.score);
    const b = num(match.teamB?.score);
    for (const participant of match.participants || []) {
      const pid = String(participant.player?._id || participant.player);
      const row = stats.get(pid);
      if (!row) continue;
      row.matches += 1;
      const own = participant.team === "A" ? a : b;
      const opp = participant.team === "A" ? b : a;
      if (own > opp) row.wins += 1;
      else if (own < opp) row.losses += 1;
      else row.draws += 1;
      if (opp === 0) row.cleanSheets += 1;
      const rating = ratingMap.get(`${String(match._id)}:${pid}`);
      if (rating !== undefined && rating !== null) {
        row.ratedMatches += 1;
        row.ratingTotal += rating;
      }
    }
    for (const event of match.events || []) {
      const pid = String(event.player?._id || event.player);
      const row = stats.get(pid);
      if (!row) continue;
      if (event.type === "goal") row.goals += 1;
      if (event.type === "assist") row.assists += 1;
    }
  }

  const rows = [...stats.values()];
  const eligible = rows.filter((r) => r.matches >= 5);
  const offValues = eligible.map((r) => r.offensiveRaw).sort((a, b) => a - b);
  const defValues = eligible.map((r) => r.defensiveRaw).sort((a, b) => a - b);

  const percentile = (value, values) => {
    if (values.length <= 1) return values.length ? 1 : 0;
    let below = 0;
    let equal = 0;
    for (const v of values) {
      if (v < value) below += 1;
      else if (v === value) equal += 1;
    }
    return (below + equal * 0.5) / (values.length - 1);
  };

  for (const row of rows) {
    row.goalContributions = row.goals + row.assists;
    row.winRate = row.matches ? row.wins / row.matches : 0;
    row.lossRate = row.matches ? row.losses / row.matches : 0;
    row.cleanSheetRate = row.matches ? row.cleanSheets / row.matches : 0;
    row.averageMatchRating = row.ratedMatches ? round(row.ratingTotal / row.ratedMatches) : null;
    row.goalScore = row.matches ? row.goals / row.matches : 0;
    row.assistScore = row.matches ? row.assists / row.matches : 0;
    row.offensiveRaw = row.goalScore + row.assistScore * 0.75;
    row.defensiveRaw = row.cleanSheetRate + row.winRate * 0.5;
    row.resultScore = row.matches ? 5 + (row.winRate - row.lossRate) * 5 : 5;
    if (row.matches >= 5) {
      row.offensiveRating = round(percentile(row.offensiveRaw, offValues) * 10);
      row.defensiveRating = round(percentile(row.defensiveRaw, defValues) * 10);
      if (row.averageMatchRating !== null) {
        row.ggRating = round(
          row.averageMatchRating * 0.4 +
          row.offensiveRating * 0.2 +
          row.defensiveRating * 0.2 +
          clamp10(row.resultScore) * 0.2
        );
      }
    }
  }

  rows.sort((a, b) => {
    if ((b.ggRating ?? -1) !== (a.ggRating ?? -1)) return (b.ggRating ?? -1) - (a.ggRating ?? -1);
    if ((b.averageMatchRating ?? -1) !== (a.averageMatchRating ?? -1)) return (b.averageMatchRating ?? -1) - (a.averageMatchRating ?? -1);
    if (b.winRate !== a.winRate) return b.winRate - a.winRate;
    if (b.goalContributions !== a.goalContributions) return b.goalContributions - a.goalContributions;
    if (b.cleanSheetRate !== a.cleanSheetRate) return b.cleanSheetRate - a.cleanSheetRate;
    if (b.matches !== a.matches) return b.matches - a.matches;
    return a.name.localeCompare(b.name);
  });

  return { players, matches, ratings: ratingRows, metaMap, stats: rows };
}

async function awardCandidates(year, month = null) {
  const range = yearRange(year, month);
  if (!range) return null;
  const { stats } = await buildStats({ date: range });
  const eligible = stats.filter((s) => s.matches >= (month ? 3 : 10) && s.ggRating !== null);
  const offensive = stats
    .filter((s) => s.matches >= 5)
    .sort((a, b) => b.offensiveRating - a.offensiveRating || b.goals - a.goals || b.assists - a.assists || (b.averageMatchRating ?? -1) - (a.averageMatchRating ?? -1) || b.matches - a.matches)[0] || null;
  const defensive = stats
    .filter((s) => s.matches >= 5)
    .sort((a, b) => b.defensiveRating - a.defensiveRating || b.cleanSheetRate - a.cleanSheetRate || b.cleanSheets - a.cleanSheets || b.winRate - a.winRate || (b.averageMatchRating ?? -1) - (a.averageMatchRating ?? -1))[0] || null;
  return { stats, winner: eligible[0] || null, offensive, defensive };
}

async function snapshotAwards(year) {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const yearResult = await awardCandidates(year, null);
  if (yearResult?.winner) {
    await Award.findOneAndUpdate(
      { awardType: "player_of_year", year, month: null },
      { player: yearResult.winner.playerId, rating: yearResult.winner.ggRating, metadata: { goals: yearResult.winner.goals, assists: yearResult.winner.assists, cleanSheets: yearResult.winner.cleanSheets } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  for (const month of months) {
    const result = await awardCandidates(year, month);
    if (result?.winner) {
      await Award.findOneAndUpdate(
        { awardType: "player_of_month", year, month },
        { player: result.winner.playerId, rating: result.winner.ggRating, metadata: { goals: result.winner.goals, assists: result.winner.assists, cleanSheets: result.winner.cleanSheets } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
  }
}

// Ratings / leaderboard ------------------------------------------------------
router.get("/leaderboard", async (req, res) => {
  try {
    const year = req.query.year ? Number(req.query.year) : null;
    const month = req.query.month ? Number(req.query.month) : null;
    const query = {};
    if (year) {
      const range = yearRange(year, month);
      if (!range) return res.status(400).json({ message: "Invalid year or month." });
      query.date = range;
    }
    const { stats } = await buildStats(query);
    const category = String(req.query.category || "").toLowerCase();
    const filtered = category && category !== "all" ? stats.filter((s) => s.category === category) : stats;
    const eligible = filtered.filter((s) => s.matches >= 5 && s.ggRating !== null);
    const unrated = filtered.filter((s) => s.ggRating === null);
    res.json({
      season: year || new Date().getFullYear(),
      leaderboard: [...eligible, ...unrated],
    });
  } catch (error) {
    console.error("V2 leaderboard error:", error);
    res.status(500).json({ message: "Failed to calculate GG ratings." });
  }
});

router.get("/player/:id", async (req, res) => {
  try {
    const { players, stats, metaMap } = await buildStats();
    const player = players.find((p) => String(p._id) === String(req.params.id));
    const row = stats.find((s) => s.playerId === String(req.params.id));
    if (!player || !row) return res.status(404).json({ message: "Player not found." });
    const awards = await Award.find({ player: player._id }).sort({ year: -1, month: -1 }).lean();
    const achievements = [];
    const add = (id, label, unlocked) => { if (unlocked) achievements.push({ id, label }); };
    add("first-goal", "First Goal", row.goals >= 1);
    add("10-goals", "10 Goals", row.goals >= 10);
    add("25-goals", "25 Goals", row.goals >= 25);
    add("50-goals", "50 Goals", row.goals >= 50);
    add("first-assist", "First Assist", row.assists >= 1);
    add("10-assists", "10 Assists", row.assists >= 10);
    add("25-assists", "25 Assists", row.assists >= 25);
    add("10-matches", "10 Matches Played", row.matches >= 10);
    add("first-clean-sheet", "First Clean Sheet", row.cleanSheets >= 1);
    res.json({
      player,
      stats: row,
      preferredPositions: metaMap.get(String(player._id))?.preferredPositions || [],
      elClasicoSide: metaMap.get(String(player._id))?.elClasicoSide || "",
      awards,
      achievements,
    });
  } catch (error) {
    console.error("V2 player error:", error);
    res.status(500).json({ message: "Failed to load player profile." });
  }
});

router.get("/matches/:matchId/ratings", async (req, res) => {
  try {
    const rows = await MatchRating.find({ match: req.params.matchId }).populate("player", "name profileImage").lean();
    res.json(rows);
  } catch {
    res.status(500).json({ message: "Failed to load match ratings." });
  }
});

router.post("/matches/:matchId/ratings", requireAuth, requireEditor, async (req, res) => {
  try {
    const match = await Match.findById(req.params.matchId).lean();
    if (!match) return res.status(404).json({ message: "Match not found." });
    const submitted = Array.isArray(req.body?.ratings) ? req.body.ratings : [];
    const participants = new Set((match.participants || []).map((p) => String(p.player)));
    const clean = submitted
      .map((item) => ({ player: String(item.player), rating: num(item.rating, NaN) }))
      .filter((item) => participants.has(item.player) && Number.isFinite(item.rating) && item.rating >= 0 && item.rating <= 10);
    if (clean.length !== participants.size) return res.status(400).json({ message: "Every participating player must have a rating from 0 to 10." });
    await MatchRating.deleteMany({ match: match._id });
    await MatchRating.insertMany(clean.map((item) => ({ match: match._id, player: item.player, rating: round(item.rating, 2) })));
    res.json({ message: "Match ratings saved.", ratings: clean });
  } catch (error) {
    console.error("Rating save error:", error);
    res.status(400).json({ message: "Could not save match ratings." });
  }
});

// Match detail + POTM --------------------------------------------------------
router.get("/matches/:matchId", async (req, res) => {
  try {
    const match = await Match.findById(req.params.matchId)
      .populate("participants.player", "name profileImage position")
      .populate("events.player", "name profileImage")
      .lean();
    if (!match) return res.status(404).json({ message: "Match not found." });
    const [ratings, votes] = await Promise.all([
      MatchRating.find({ match: match._id }).populate("player", "name profileImage").lean(),
      MotmVote.find({ match: match._id }).populate("player", "name profileImage").lean(),
    ]);
    const counts = {};
    for (const vote of votes) {
      const pid = String(vote.player?._id || vote.player);
      counts[pid] = (counts[pid] || 0) + 1;
    }
    const winnerId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    res.json({ match, ratings, potm: { votes: counts, totalVotes: votes.length, winnerId } });
  } catch (error) {
    res.status(500).json({ message: "Failed to load match details." });
  }
});

router.get("/matches/:matchId/potm", async (req, res) => {
  try {
    const votes = await MotmVote.find({ match: req.params.matchId }).populate("player", "name profileImage").lean();
    const counts = {};
    for (const vote of votes) {
      const id = String(vote.player?._id || vote.player);
      counts[id] = (counts[id] || 0) + 1;
    }
    const winnerId = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    res.json({ votes: counts, totalVotes: votes.length, winnerId });
  } catch {
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

// Awards / seasons -----------------------------------------------------------
router.get("/awards", async (req, res) => {
  try {
    const year = Number(req.query.year || new Date().getFullYear());
    const month = req.query.month ? Number(req.query.month) : null;
    const result = await awardCandidates(year, month);
    res.json({
      year, month,
      playerOfMonth: month ? result?.winner : null,
      playerOfYear: month ? null : result?.winner,
      bestOffensive: result?.offensive || null,
      bestDefensive: result?.defensive || null,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to calculate V2 awards." });
  }
});

router.get("/awards/history", async (req, res) => {
  try {
    const awards = await Award.find().populate("player", "name profileImage position").sort({ year: -1, month: -1, awardType: 1 }).lean();
    res.json(awards);
  } catch {
    res.status(500).json({ message: "Failed to load award history." });
  }
});

router.post("/awards/snapshot", requireAuth, requireAdmin, async (req, res) => {
  try {
    const year = Number(req.body?.year || new Date().getFullYear());
    await snapshotAwards(year);
    res.json({ message: "Award history snapshot updated.", year });
  } catch {
    res.status(500).json({ message: "Failed to snapshot awards." });
  }
});

router.get("/seasons", async (req, res) => {
  try {
    const matches = await Match.find().select("date").sort({ date: 1 }).lean();
    res.json({ seasons: [...new Set(matches.map((m) => new Date(m.date).getUTCFullYear()))] });
  } catch {
    res.status(500).json({ message: "Failed to load seasons." });
  }
});

router.get("/seasons/:year", async (req, res) => {
  try {
    const year = Number(req.params.year);
    const range = yearRange(year);
    if (!range) return res.status(400).json({ message: "Invalid season year." });
    const data = await buildStats({ date: range });
    const awards = await Award.find({ year }).populate("player", "name profileImage position").sort({ month: 1, awardType: 1 }).lean();
    res.json({ year, stats: data.stats, matches: data.matches, awards });
  } catch {
    res.status(500).json({ message: "Failed to load season." });
  }
});

// Player setup / formation ---------------------------------------------------
router.get("/preferences/me", requireAuth, async (req, res) => {
  try {
    const linkedPlayer = req.user.playerProfile ? String(req.user.playerProfile) : null;
    if (!linkedPlayer) return res.json({ linkedPlayer: null, meta: null, pending: null, positionOptions: POSITION_OPTIONS });
    const [meta, pending] = await Promise.all([
      PlayerV2Meta.findOne({ player: linkedPlayer }).lean(),
      ProfilePreferenceRequest.findOne({ requestedBy: req.user._id, status: "pending" }).lean(),
    ]);
    res.json({ linkedPlayer, meta, pending, positionOptions: POSITION_OPTIONS });
  } catch {
    res.status(500).json({ message: "Failed to load player preferences." });
  }
});

router.post("/preferences/me", requireAuth, async (req, res) => {
  try {
    if (!req.user.playerProfile) return res.status(400).json({ message: "Your account is not linked to a player profile yet." });
    const preferredPositions = normalizePositions(req.body?.preferredPositions);
    const elClasicoSide = ["", "Messi", "Ronaldo"].includes(req.body?.elClasicoSide) ? req.body.elClasicoSide : "";
    if (!preferredPositions.length && !elClasicoSide) return res.status(400).json({ message: "Choose at least one preferred position or an El Clásico side." });
    const existing = await ProfilePreferenceRequest.findOne({ requestedBy: req.user._id, status: "pending" });
    if (existing) return res.status(409).json({ message: "You already have a pending preference request." });
    const request = await ProfilePreferenceRequest.create({ requestedBy: req.user._id, player: req.user.playerProfile, preferredPositions, elClasicoSide });
    res.status(201).json({ message: "Submitted for admin approval.", request });
  } catch {
    res.status(400).json({ message: "Could not submit preference request." });
  }
});

router.get("/preferences/admin", requireAuth, requireAdmin, async (req, res) => {
  try {
    const requests = await ProfilePreferenceRequest.find({ status: "pending" })
      .populate("requestedBy", "name email")
      .populate("player", "name profileImage position")
      .sort({ createdAt: -1 }).lean();
    res.json(requests);
  } catch {
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
  } catch {
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
  } catch {
    res.status(500).json({ message: "Failed to reject preference request." });
  }
});

router.get("/squad", async (req, res) => {
  try {
    const { players, metaMap, stats } = await buildStats();
    const enriched = players.map((player) => {
      const meta = metaMap.get(String(player._id));
      const stat = stats.find((row) => row.playerId === String(player._id));
      return {
        ...player,
        preferredPositions: meta?.preferredPositions || [],
        elClasicoSide: meta?.elClasicoSide || "",
        category: playerCategory({ ...player, preferredPositions: meta?.preferredPositions || [] }),
        stats: stat ? {
          matches: stat.matches, wins: stat.wins, draws: stat.draws, losses: stat.losses,
          goals: stat.goals, assists: stat.assists, cleanSheets: stat.cleanSheets,
          ggRating: stat.ggRating, averageMatchRating: stat.averageMatchRating,
        } : null,
      };
    });
    res.json({ players: enriched, positionOptions: POSITION_OPTIONS });
  } catch {
    res.status(500).json({ message: "Failed to load squad." });
  }
});

// El Clásico -----------------------------------------------------------------
router.get("/el-clasico", async (req, res) => {
  try {
    const allMatches = await Match.find().populate("participants.player", "name profileImage").populate("events.player", "name profileImage").sort({ date: -1 }).lean();
    const matches = allMatches.filter((m) => normalizeElClasicoName(m.name));
    const playerIds = [...new Set(matches.flatMap((m) => (m.participants || []).map((p) => String(p.player?._id || p.player))))];
    const players = await Player.find({ _id: { $in: playerIds } }).lean();
    const metaMap = await loadMetaMap();
    const sideData = () => ({ matches: 0, wins: 0, losses: 0, draws: 0, goals: 0, assists: 0, cleanSheets: 0, players: [] });
    const sides = { Messi: sideData(), Ronaldo: sideData() };
    const perPlayer = new Map(players.map((p) => [String(p._id), {
      playerId: String(p._id), name: p.name, profileImage: p.profileImage || "",
      side: metaMap.get(String(p._id))?.elClasicoSide || "", matches: 0, wins: 0, losses: 0, draws: 0,
      goals: 0, assists: 0, cleanSheets: 0,
    }]));
    for (const match of matches) {
      const a = num(match.teamA?.score), b = num(match.teamB?.score);
      for (const participant of match.participants || []) {
        const row = perPlayer.get(String(participant.player?._id || participant.player));
        if (!row || !sides[row.side]) continue;
        row.matches += 1;
        const own = participant.team === "A" ? a : b;
        const opp = participant.team === "A" ? b : a;
        if (own > opp) row.wins += 1;
        else if (own < opp) row.losses += 1;
        else row.draws += 1;
        if (opp === 0) row.cleanSheets += 1;
      }
      for (const event of match.events || []) {
        const row = perPlayer.get(String(event.player?._id || event.player));
        if (!row || !sides[row.side]) continue;
        if (event.type === "goal") row.goals += 1;
        if (event.type === "assist") row.assists += 1;
      }
    }
    for (const row of perPlayer.values()) {
      if (!sides[row.side]) continue;
      const side = sides[row.side];
      side.matches += row.matches; side.wins += row.wins; side.losses += row.losses; side.draws += row.draws;
      side.goals += row.goals; side.assists += row.assists; side.cleanSheets += row.cleanSheets;
      side.players.push(row);
    }
    sides.Messi.players.sort((a, b) => b.goals + b.assists - (a.goals + a.assists) || b.matches - a.matches);
    sides.Ronaldo.players.sort((a, b) => b.goals + b.assists - (a.goals + a.assists) || b.matches - a.matches);
    res.json({ matches, sides });
  } catch (error) {
    console.error("El Clásico error:", error);
    res.status(500).json({ message: "Failed to load El Clásico data." });
  }
});

router.post("/el-clasico/commentary", requireAuth, async (req, res) => {
  try {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return res.status(503).json({ message: "Gemini is not configured." });
    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
    const payload = JSON.stringify(req.body?.data || {});
    const prompt = `You are the immersive GG Matchday football commentator. Use ONLY the supplied recorded data. Never invent a match, player, stat or event. Compare the Messi Fans and Ronaldo Fans, highlight the leading contributors and current balance of the rivalry, and keep the tone energetic like a football broadcast. Do not mention AI. Data: ${payload}`;
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    const data = await response.json();
    if (!response.ok) return res.status(502).json({ message: "Gemini commentary failed." });
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join(" ").trim();
    if (!text) return res.status(502).json({ message: "Gemini returned no commentary." });
    res.json({ commentary: text });
  } catch {
    res.status(500).json({ message: "Failed to generate El Clásico commentary." });
  }
});

// Gallery associations + one-way likes --------------------------------------
router.post("/gallery/:id/associate", requireAuth, async (req, res) => {
  try {
    const photo = await Gallery.findById(req.params.id);
    if (!photo) return res.status(404).json({ message: "Photo not found." });
    const matchId = req.body?.matchId || null;
    const playerId = req.body?.playerId || null;
    if (matchId && !(await Match.exists({ _id: matchId }))) return res.status(400).json({ message: "Match not found." });
    if (playerId && !(await Player.exists({ _id: playerId }))) return res.status(400).json({ message: "Player not found." });
    photo.matchId = matchId;
    photo.playerId = playerId;
    await photo.save();
    res.json({ message: "Gallery association saved.", photo });
  } catch {
    res.status(400).json({ message: "Could not associate gallery photo." });
  }
});

router.get("/likes/:targetType/:targetId", async (req, res) => {
  try {
    if (!["gallery", "news", "match"].includes(req.params.targetType)) return res.status(400).json({ message: "Invalid like target." });
    const rows = await Like.find({ targetType: req.params.targetType, targetId: req.params.targetId }).select("user").lean();
    const userId = req.user?._id ? String(req.user._id) : null;
    res.json({ count: rows.length, likedByMe: userId ? rows.some((r) => String(r.user) === userId) : false });
  } catch {
    res.status(500).json({ message: "Failed to load likes." });
  }
});

router.post("/likes/:targetType/:targetId", requireAuth, async (req, res) => {
  try {
    const { targetType, targetId } = req.params;
    if (!["gallery", "news", "match"].includes(targetType)) return res.status(400).json({ message: "Invalid like target." });
    const collections = { gallery: Gallery, news: null, match: Match };
    if (targetType === "gallery" && !(await Gallery.exists({ _id: targetId }))) return res.status(404).json({ message: "Gallery item not found." });
    if (targetType === "match" && !(await Match.exists({ _id: targetId }))) return res.status(404).json({ message: "Match not found." });
    if (targetType === "news") {
      const News = (await import("../models/News.js")).default;
      if (!(await News.exists({ _id: targetId }))) return res.status(404).json({ message: "News item not found." });
    }
    const exists = await Like.findOne({ targetType, targetId, user: req.user._id });
    if (exists) {
      const count = await Like.countDocuments({ targetType, targetId });
      return res.json({ message: "Already liked.", count, likedByMe: true });
    }
    await Like.create({ targetType, targetId, user: req.user._id });
    const count = await Like.countDocuments({ targetType, targetId });
    res.status(201).json({ message: "Liked.", count, likedByMe: true });
  } catch (error) {
    if (error?.code === 11000) return res.json({ message: "Already liked.", likedByMe: true });
    res.status(400).json({ message: "Could not like this item." });
  }
});

export default router;
