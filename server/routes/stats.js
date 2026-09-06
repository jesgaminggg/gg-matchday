import express from "express";
import Player from "../models/Player.js";
import Match from "../models/Match.js";

const router = express.Router();

/*
  Build player statistics from actual match records.

  Points formula:

  ((Goals + Assists + Wins) - Losses) / Total Matches
*/

function buildStatistics(players, matches) {
  const stats = new Map();

  // Start every registered player at zero.
  for (const player of players) {
    stats.set(String(player._id), {
      playerId: String(player._id),
      name: player.name,
      matches: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      goals: 0,
      assists: 0,
      points: 0,
    });
  }

  for (const match of matches) {
    const teamAScore = match.teamA.score;
    const teamBScore = match.teamB.score;

    // Determine each participant's result from THEIR team.
    for (const participant of match.participants || []) {
      const playerId = String(participant.player?._id || participant.player);

      const playerStats = stats.get(playerId);

      if (!playerStats) continue;

      playerStats.matches += 1;

      if (teamAScore === teamBScore) {
        playerStats.draws += 1;
      } else if (
        participant.team === "A" &&
        teamAScore > teamBScore
      ) {
        playerStats.wins += 1;
      } else if (
        participant.team === "B" &&
        teamBScore > teamAScore
      ) {
        playerStats.wins += 1;
      } else {
        playerStats.losses += 1;
      }
    }

    // Count goals and assists from events.
    for (const event of match.events || []) {
      const playerId = String(event.player?._id || event.player);

      const playerStats = stats.get(playerId);

      if (!playerStats) continue;

      if (event.type === "goal") {
        playerStats.goals += 1;
      }

      if (event.type === "assist") {
        playerStats.assists += 1;
      }
    }
  }

  // Calculate the user's exact points formula.
  for (const playerStats of stats.values()) {
    if (playerStats.matches === 0) {
      playerStats.points = 0;
      continue;
    }

    playerStats.points =
      (playerStats.goals +
        playerStats.assists +
        playerStats.wins -
        playerStats.losses) /
      playerStats.matches;

    playerStats.points = Number(playerStats.points.toFixed(2));
  }

  // Highest points first.
  // Then goals, assists, wins as tie breakers.
  return [...stats.values()]
    .sort((a, b) => {
      if (b.points !== a.points) {
        return b.points - a.points;
      }

      if (b.goals !== a.goals) {
        return b.goals - a.goals;
      }

      if (b.assists !== a.assists) {
        return b.assists - a.assists;
      }

      if (b.wins !== a.wins) {
        return b.wins - a.wins;
      }

      return a.name.localeCompare(b.name);
    })
    .map((player, index) => ({
      rank: index + 1,
      ...player,
    }));
}

/*
  Optional date filtering.

  Examples:

  /api/stats/leaderboard
  /api/stats/leaderboard?year=2026
  /api/stats/leaderboard?year=2026&month=9
*/

function buildDateQuery(year, month) {
  const query = {};

  if (!year) {
    return query;
  }

  const numericYear = Number(year);

  if (
    !Number.isInteger(numericYear) ||
    numericYear < 2000 ||
    numericYear > 2100
  ) {
    return null;
  }

  if (!month) {
    query.date = {
      $gte: new Date(`${numericYear}-01-01T00:00:00.000Z`),
      $lt: new Date(`${numericYear + 1}-01-01T00:00:00.000Z`),
    };

    return query;
  }

  const numericMonth = Number(month);

  if (
    !Number.isInteger(numericMonth) ||
    numericMonth < 1 ||
    numericMonth > 12
  ) {
    return null;
  }

  const start = new Date(
    Date.UTC(numericYear, numericMonth - 1, 1)
  );

  const end = new Date(
    Date.UTC(
      numericYear,
      numericMonth,
      1
    )
  );

  query.date = {
    $gte: start,
    $lt: end,
  };

  return query;
}

/*
  GET /api/stats/leaderboard

  All-time:
  /api/stats/leaderboard

  Year:
  /api/stats/leaderboard?year=2026

  Month:
  /api/stats/leaderboard?year=2026&month=9
*/

router.get("/leaderboard", async (req, res) => {
  try {
    const { year, month } = req.query;

    const dateQuery = buildDateQuery(year, month);

    if (dateQuery === null) {
      return res.status(400).json({
        message: "Invalid year or month.",
      });
    }

    const [players, matches] = await Promise.all([
      Player.find().sort({ name: 1 }),
      Match.find(dateQuery)
        .populate("participants.player", "name")
        .populate("events.player", "name")
        .sort({ date: -1 }),
    ]);

    const leaderboard = buildStatistics(players, matches);

    res.json({
      filters: {
        year: year ? Number(year) : null,
        month: month ? Number(month) : null,
      },
      leaderboard,
    });
  } catch (error) {
    console.error("Leaderboard error:", error);

    res.status(500).json({
      message: "Failed to calculate leaderboard.",
    });
  }
});

/*
  GET /api/stats/awards

  Example:

  /api/stats/awards?year=2026&month=9

  Returns Player of the Month.

  /api/stats/awards?year=2026

  Returns Player of the Year.
*/

router.get("/awards", async (req, res) => {
  try {
    const { year, month } = req.query;

    if (!year) {
      return res.status(400).json({
        message: "Year is required.",
      });
    }

    const dateQuery = buildDateQuery(year, month);

    if (dateQuery === null) {
      return res.status(400).json({
        message: "Invalid year or month.",
      });
    }

    const [players, matches] = await Promise.all([
      Player.find().sort({ name: 1 }),
      Match.find(dateQuery)
        .populate("participants.player", "name")
        .populate("events.player", "name")
        .sort({ date: -1 }),
    ]);

    const leaderboard = buildStatistics(players, matches);

    const eligiblePlayers = leaderboard.filter(
      (player) => player.matches > 0
    );

    const winner = eligiblePlayers[0] || null;

    res.json({
      award: month ? "Player of the Month" : "Player of the Year",
      year: Number(year),
      month: month ? Number(month) : null,
      winner,
      leaderboard,
    });
  } catch (error) {
    console.error("Awards error:", error);

    res.status(500).json({
      message: "Failed to calculate award.",
    });
  }
});

/*
  GET /api/stats/calendar

  Example:

  /api/stats/calendar?year=2026&month=9
*/

router.get("/calendar", async (req, res) => {
  try {
    const { year, month } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        message: "Year and month are required.",
      });
    }

    const dateQuery = buildDateQuery(year, month);

    if (dateQuery === null) {
      return res.status(400).json({
        message: "Invalid year or month.",
      });
    }

    const matches = await Match.find(dateQuery)
      .populate("participants.player", "name")
      .populate("events.player", "name")
      .sort({ date: 1 });

    res.json({
      year: Number(year),
      month: Number(month),
      matches,
    });
  } catch (error) {
    console.error("Calendar error:", error);

    res.status(500).json({
      message: "Failed to load calendar.",
    });
  }
});

// --------------------------------------------------
// GET ONE PLAYER'S STATISTICS
// --------------------------------------------------

router.get("/player/:id", async (req, res) => {
  try {
    const playerId = req.params.id;

    const player = await Player.findById(playerId);

    if (!player) {
      return res.status(404).json({
        message: "Player not found.",
      });
    }

    const matches = await Match.find({
      "participants.player": playerId,
    })
      .populate("participants.player", "name")
      .populate("events.player", "name")
      .sort({ date: -1 });

    const stats = {
      playerId: String(player._id),
      name: player.name,

      matches: 0,
      wins: 0,
      draws: 0,
      losses: 0,

      goals: 0,
      assists: 0,

      points: 0,
    };

    for (const match of matches) {
      const participant = match.participants.find(
        (item) =>
          String(
            item.player?._id || item.player
          ) === String(playerId)
      );

      if (!participant) continue;

      stats.matches += 1;

      const teamScore =
        participant.team === "A"
          ? match.teamA.score
          : match.teamB.score;

      const opponentScore =
        participant.team === "A"
          ? match.teamB.score
          : match.teamA.score;

      if (teamScore > opponentScore) {
        stats.wins += 1;
      } else if (teamScore < opponentScore) {
        stats.losses += 1;
      } else {
        stats.draws += 1;
      }

      for (const event of match.events || []) {
        const eventPlayerId = String(
          event.player?._id || event.player
        );

        if (eventPlayerId !== String(playerId)) {
          continue;
        }

        if (event.type === "goal") {
          stats.goals += 1;
        }

        if (event.type === "assist") {
          stats.assists += 1;
        }
      }
    }

    if (stats.matches > 0) {
      stats.points = Number(
        (
          (stats.goals +
            stats.assists +
            stats.wins -
            stats.losses) /
          stats.matches
        ).toFixed(2)
      );
    }

    res.json({
      player,
      stats,
      matches,
    });
  } catch (error) {
    console.error(
      "Player statistics error:",
      error
    );

    res.status(500).json({
      message:
        "Failed to calculate player statistics.",
    });
  }
});

export default router;