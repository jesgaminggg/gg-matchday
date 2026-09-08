import express from "express";
import Player from "../models/Player.js";
import Match from "../models/Match.js";

const router = express.Router();

const MIN_OVERALL_MATCHES = 5;
const MIN_MONTH_MATCHES = 3;
const MIN_YEAR_MATCHES = 10;

function round(value, decimals = 2) {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function rate(value, denominator) {
  if (!denominator) return 0;
  return value / denominator;
}

function buildDateQuery(year, month) {
  if (!year) return {};

  const numericYear = Number(year);
  if (!Number.isInteger(numericYear) || numericYear < 2000 || numericYear > 2100) {
    return null;
  }

  if (!month) {
    return {
      date: {
        $gte: new Date(Date.UTC(numericYear, 0, 1)),
        $lt: new Date(Date.UTC(numericYear + 1, 0, 1)),
      },
    };
  }

  const numericMonth = Number(month);
  if (!Number.isInteger(numericMonth) || numericMonth < 1 || numericMonth > 12) {
    return null;
  }

  return {
    date: {
      $gte: new Date(Date.UTC(numericYear, numericMonth - 1, 1)),
      $lt: new Date(Date.UTC(numericYear, numericMonth, 1)),
    },
  };
}

function percentileScores(valuesByPlayer) {
  const entries = [...valuesByPlayer.entries()];
  if (!entries.length) return new Map();

  entries.sort((a, b) => a[1] - b[1]);
  const scores = new Map();

  if (entries.length === 1) {
    scores.set(entries[0][0], 10);
    return scores;
  }

  entries.forEach(([playerId], index) => {
    scores.set(playerId, round((index / (entries.length - 1)) * 10));
  });

  return scores;
}

function buildStatistics(players, matches, { minimumMatches = 0 } = {}) {
  const stats = new Map();

  for (const player of players) {
    stats.set(String(player._id), {
      playerId: String(player._id),
      name: player.name,
      position: player.position || "",
      matches: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goals: 0,
      assists: 0,
      goalContributions: 0,
      cleanSheets: 0,
      cleanSheetRate: 0,
      winRate: 0,
      lossRate: 0,
      averageMatchRating: 0,
      offensiveRaw: 0,
      offensiveRating: 0,
      defensiveRaw: 0,
      defensiveRating: 0,
      resultScore: 5,
      ggRating: null,
      points: null,
      ratedMatches: 0,
      ratingTotal: 0,
    });
  }

  for (const match of matches) {
    const scoreA = Number(match.teamA?.score || 0);
    const scoreB = Number(match.teamB?.score || 0);

    for (const participant of match.participants || []) {
      const playerId = String(participant.player?._id || participant.player);
      const playerStats = stats.get(playerId);
      if (!playerStats) continue;

      playerStats.matches += 1;

      if (scoreA === scoreB) {
        playerStats.draws += 1;
      } else if (participant.team === "A" ? scoreA > scoreB : scoreB > scoreA) {
        playerStats.wins += 1;
      } else {
        playerStats.losses += 1;
      }

      if (participant.team === "A" && scoreB === 0) {
        playerStats.cleanSheets += 1;
      }

      if (participant.team === "B" && scoreA === 0) {
        playerStats.cleanSheets += 1;
      }

      const matchRating = Number(participant.rating);
      if (Number.isFinite(matchRating) && matchRating >= 0 && matchRating <= 10) {
        playerStats.ratingTotal += matchRating;
        playerStats.ratedMatches += 1;
      }
    }

    for (const event of match.events || []) {
      const playerId = String(event.player?._id || event.player);
      const playerStats = stats.get(playerId);
      if (!playerStats) continue;

      if (event.type === "goal") playerStats.goals += 1;
      if (event.type === "assist") playerStats.assists += 1;
    }
  }

  const eligible = [];
  const offensiveValues = new Map();
  const defensiveValues = new Map();

  for (const playerStats of stats.values()) {
    playerStats.goalContributions = playerStats.goals + playerStats.assists;

    if (!playerStats.matches) continue;

    playerStats.winRate = rate(playerStats.wins, playerStats.matches);
    playerStats.lossRate = rate(playerStats.losses, playerStats.matches);
    playerStats.cleanSheetRate = rate(playerStats.cleanSheets, playerStats.matches);

    playerStats.averageMatchRating = playerStats.ratedMatches
      ? round(playerStats.ratingTotal / playerStats.ratedMatches)
      : null;

    playerStats.resultScore = round(
      Math.min(10, Math.max(0, 5 + ((playerStats.winRate - playerStats.lossRate) * 5)))
    );

    const goalScore = rate(playerStats.goals, playerStats.matches);
    const assistScore = rate(playerStats.assists, playerStats.matches);

    playerStats.offensiveRaw = round((goalScore * 1) + (assistScore * 0.75), 4);
    playerStats.defensiveRaw = round(
      (playerStats.cleanSheetRate * 1) + (playerStats.winRate * 0.5),
      4
    );

    if (playerStats.matches >= minimumMatches) {
      eligible.push(playerStats);
      offensiveValues.set(playerStats.playerId, playerStats.offensiveRaw);
      defensiveValues.set(playerStats.playerId, playerStats.defensiveRaw);
    }
  }

  const offensiveScores = percentileScores(offensiveValues);
  const defensiveScores = percentileScores(defensiveValues);

  for (const playerStats of eligible) {
    playerStats.offensiveRating = round(offensiveScores.get(playerStats.playerId) ?? 0);
    playerStats.defensiveRating = round(defensiveScores.get(playerStats.playerId) ?? 0);

    if (playerStats.averageMatchRating !== null) {
      playerStats.ggRating = round(
        Math.min(
          10,
          Math.max(
            0,
            (playerStats.averageMatchRating * 0.4) +
              (playerStats.offensiveRating * 0.2) +
              (playerStats.defensiveRating * 0.2) +
              (playerStats.resultScore * 0.2)
          )
        )
      );
      playerStats.points = playerStats.ggRating;
    }
  }

  return eligible
    .filter((player) => player.ggRating !== null)
    .sort((a, b) => {
      if (b.ggRating !== a.ggRating) return b.ggRating - a.ggRating;
      if (b.averageMatchRating !== a.averageMatchRating) return b.averageMatchRating - a.averageMatchRating;
      if (b.winRate !== a.winRate) return b.winRate - a.winRate;
      if (b.goalContributions !== a.goalContributions) return b.goalContributions - a.goalContributions;
      if (b.cleanSheetRate !== a.cleanSheetRate) return b.cleanSheetRate - a.cleanSheetRate;
      return b.matches - a.matches;
    });
}

function buildPlayerStatistics(player, matches) {
  const rows = buildStatistics([player], matches, { minimumMatches: 0 });
  return rows[0] || {
    playerId: String(player._id),
    name: player.name,
    position: player.position || "",
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    goals: 0,
    assists: 0,
    goalContributions: 0,
    cleanSheets: 0,
    cleanSheetRate: 0,
    winRate: 0,
    lossRate: 0,
    averageMatchRating: null,
    offensiveRating: 0,
    defensiveRating: 0,
    resultScore: 5,
    ggRating: null,
    points: null,
  };
}

router.get("/leaderboard", async (req, res) => {
  try {
    const { year, month } = req.query;
    const dateQuery = buildDateQuery(year, month);

    if (dateQuery === null) {
      return res.status(400).json({ message: "Invalid year or month." });
    }

    const [players, matches] = await Promise.all([
      Player.find().sort({ name: 1 }),
      Match.find(dateQuery)
        .populate("participants.player", "name position")
        .populate("events.player", "name")
        .sort({ date: -1 }),
    ]);

    const leaderboard = buildStatistics(players, matches, {
      minimumMatches: MIN_OVERALL_MATCHES,
    }).map((player, index) => ({
      rank: index + 1,
      ...player,
    }));

    res.json({
      filters: {
        year: year ? Number(year) : null,
        month: month ? Number(month) : null,
      },
      leaderboard,
    });
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(500).json({ message: "Failed to calculate leaderboard." });
  }
});

router.get("/awards", async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year) return res.status(400).json({ message: "Year is required." });

    const dateQuery = buildDateQuery(year, month);
    if (dateQuery === null) {
      return res.status(400).json({ message: "Invalid year or month." });
    }

    const [players, matches] = await Promise.all([
      Player.find().sort({ name: 1 }),
      Match.find(dateQuery)
        .populate("participants.player", "name position")
        .populate("events.player", "name")
        .sort({ date: -1 }),
    ]);

    const minimum = month ? MIN_MONTH_MATCHES : MIN_YEAR_MATCHES;
    const rows = buildStatistics(players, matches, { minimumMatches: minimum });
    const winner = rows[0] || null;

    res.json({
      award: month ? "Player of the Month" : "Player of the Year",
      year: Number(year),
      month: month ? Number(month) : null,
      winner,
      leaderboard: rows,
    });
  } catch (error) {
    console.error("Awards error:", error);
    res.status(500).json({ message: "Failed to calculate award." });
  }
});

router.get("/calendar", async (req, res) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ message: "Year and month are required." });

    const dateQuery = buildDateQuery(year, month);
    if (dateQuery === null) return res.status(400).json({ message: "Invalid year or month." });

    const matches = await Match.find(dateQuery)
      .populate("participants.player", "name position")
      .populate("events.player", "name")
      .sort({ date: 1 });

    res.json({ year: Number(year), month: Number(month), matches });
  } catch (error) {
    console.error("Calendar error:", error);
    res.status(500).json({ message: "Failed to load calendar." });
  }
});

router.get("/player/:id", async (req, res) => {
  try {
    const player = await Player.findById(req.params.id);
    if (!player) return res.status(404).json({ message: "Player not found." });

    const matches = await Match.find({ "participants.player": player._id })
      .populate("participants.player", "name position")
      .populate("events.player", "name")
      .sort({ date: -1 });

    const stats = buildPlayerStatistics(player, matches);

    res.json({
      player,
      stats: {
        ...stats,
        points: stats.ggRating,
      },
      matches,
    });
  } catch (error) {
    console.error("Player statistics error:", error);
    res.status(500).json({ message: "Failed to calculate player statistics." });
  }
});

export default router;
