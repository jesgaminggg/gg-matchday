import express from "express";

import News from "../models/News.js";
import Match from "../models/Match.js";
import Player from "../models/Player.js";

import {
  generateMatchNews,
} from "../services/aiNews.js";

const router =
  express.Router();

// ==================================================
// GET ALL NEWS
// ==================================================

router.get(
  "/",
  async (
    req,
    res
  ) => {
    try {
      const requestedLimit =
        Number(
          req.query.limit ||
            12
        );

      const limit =
        Math.min(
          Math.max(
            Number.isFinite(
              requestedLimit
            )
              ? requestedLimit
              : 12,
            1
          ),
          50
        );

      const news =
        await News.find()
          .populate(
            "match"
          )
          .populate(
            "featuredPlayer",
            "name profileImage"
          )
          .sort({
            createdAt:
              -1,
          })
          .limit(
            limit
          );

      res.json(
        news
      );
    } catch (error) {
      console.error(
        "News fetch error:",
        error
      );

      res.status(
        500
      ).json({
        message:
          "Failed to fetch news.",
      });
    }
  }
);

// ==================================================
// GET ONE NEWS ARTICLE
// ==================================================

router.get(
  "/:id",
  async (
    req,
    res
  ) => {
    try {
      const news =
        await News.findById(
          req.params.id
        )
          .populate(
            "match"
          )
          .populate(
            "featuredPlayer",
            "name profileImage"
          );

      if (!news) {
        return res
          .status(
            404
          )
          .json({
            message:
              "News article not found.",
          });
      }

      res.json(
        news
      );
    } catch (error) {
      console.error(
        "Single news fetch error:",
        error
      );

      res.status(
        500
      ).json({
        message:
          "Failed to fetch news article.",
      });
    }
  }
);

// ==================================================
// GENERATE NEWS FOR A MATCH
// ==================================================

router.post(
  "/generate/:matchId",
  async (
    req,
    res
  ) => {
    try {
      const match =
        await Match.findById(
          req.params.matchId
        )
          .populate(
            "participants.player",
            "name profileImage"
          )
          .populate(
            "events.player",
            "name profileImage"
          );

      if (!match) {
        return res
          .status(
            404
          )
          .json({
            message:
              "Match not found.",
          });
      }

      await News.deleteMany({
        match:
          match._id,
      });

      const generated =
        await generateMatchNews(
          match
        );

      const firstGoal =
        (
          match.events || []
        ).find(
          (event) =>
            event.type ===
            "goal"
        );

      const news =
        await News.create({
          type:
            "match",

          match:
            match._id,

          featuredPlayer:
            firstGoal?.player ||
            null,

          headline:
            generated.headline,

          summary:
            generated.summary,

          body:
            generated.body,

          icon:
            generated.icon ||
            "⚽",

          tags: [
            "match",
            "football",
          ],

          generatedBy:
            generated.generatedBy ||
            "fallback",
        });

      const populated =
        await news.populate([
          {
            path:
              "match",
          },
          {
            path:
              "featuredPlayer",
            select:
              "name profileImage",
          },
        ]);

      res.status(
        generated.aiError
          ? 200
          : 201
      ).json({
        article:
          populated,

        generatedBy:
          generated.generatedBy,

        aiError:
          generated.aiError ||
          null,
      });
    } catch (error) {
      console.error(
        "Manual news generation error:",
        error
      );

      res.status(
        500
      ).json({
        message:
          "Failed to generate news.",
        error:
          error.message,
      });
    }
  }
);

// ==================================================
// TEST GEMINI WITHOUT CREATING NEWS
// ==================================================

router.get(
  "/debug/gemini",
  async (
    req,
    res
  ) => {
    try {
      const testMatch =
        await Match.findOne()
          .populate(
            "participants.player",
            "name profileImage"
          )
          .populate(
            "events.player",
            "name profileImage"
          )
          .sort({
            date:
              -1,
          });

      if (!testMatch) {
        return res
          .status(
            404
          )
          .json({
            message:
              "Create at least one match before testing Gemini.",
          });
      }

      const result =
        await generateMatchNews(
          testMatch
        );

      res.json({
        success:
          true,

        generatedBy:
          result.generatedBy,

        aiError:
          result.aiError ||
          null,

        article: {
          headline:
            result.headline,

          summary:
            result.summary,

          body:
            result.body,

          icon:
            result.icon,
        },
      });
    } catch (error) {
      console.error(
        "Gemini debug error:",
        error
      );

      res.status(
        500
      ).json({
        success:
          false,

        message:
          error.message,
      });
    }
  }
);

// ==================================================
// PLAYER REVIEW
// ==================================================

router.post(
  "/player/:playerId",
  async (
    req,
    res
  ) => {
    try {
      const player =
        await Player.findById(
          req.params.playerId
        );

      if (!player) {
        return res
          .status(
            404
          )
          .json({
            message:
              "Player not found.",
          });
      }

      const matches =
        await Match.find({
          "participants.player":
            player._id,
        })
          .populate(
            "participants.player",
            "name"
          )
          .populate(
            "events.player",
            "name"
          )
          .sort({
            date:
              -1,
          });

      let matchesPlayed =
        0;

      let wins =
        0;

      let draws =
        0;

      let losses =
        0;

      let goals =
        0;

      let assists =
        0;

      for (const match of matches) {
        const participant =
          (
            match.participants ||
            []
          ).find(
            (item) =>
              String(
                item.player?._id ||
                  item.player
              ) ===
              String(
                player._id
              )
          );

        if (!participant) {
          continue;
        }

        matchesPlayed +=
          1;

        const ownScore =
          participant.team ===
          "A"
            ? Number(
                match.teamA?.score ||
                  0
              )
            : Number(
                match.teamB?.score ||
                  0
              );

        const opponentScore =
          participant.team ===
          "A"
            ? Number(
                match.teamB?.score ||
                  0
              )
            : Number(
                match.teamA?.score ||
                  0
              );

        if (
          ownScore >
          opponentScore
        ) {
          wins += 1;
        } else if (
          ownScore <
          opponentScore
        ) {
          losses += 1;
        } else {
          draws += 1;
        }

        for (
          const event of
            match.events || []
        ) {
          const eventPlayerId =
            String(
              event.player?._id ||
                event.player
            );

          if (
            eventPlayerId !==
            String(
              player._id
            )
          ) {
            continue;
          }

          if (
            event.type ===
            "goal"
          ) {
            goals +=
              1;
          }

          if (
            event.type ===
            "assist"
          ) {
            assists +=
              1;
          }
        }
      }

      const rating =
        matchesPlayed >
        0
          ? Number(
              (
                (
                  goals +
                  assists +
                  wins -
                  losses
                ) /
                matchesPlayed
              ).toFixed(
                2
              )
            )
          : 0;

      let review =
        matchesPlayed >
        0
          ? `${player.name} has recorded ${goals} goals and ${assists} assists across ${matchesPlayed} matches, with ${wins} wins, ${draws} draws and ${losses} losses.`
          : `${player.name} has no recorded matches yet.`;

      let generatedBy =
        "fallback";

      let aiError =
        null;

      if (
        process.env
          .GEMINI_API_KEY
      ) {
        try {
          const ai =
            new (
              (
                await import(
                  "@google/genai"
                )
              ).GoogleGenAI
            )({
              apiKey:
                process.env
                  .GEMINI_API_KEY,
            });

          const interaction =
            await ai.interactions.create(
              {
                model:
                  process.env
                    .GEMINI_MODEL ||
                  "gemini-3.8-flash",

                input: `
Write a short football player review.

Use ONLY these verified statistics.

Player: ${player.name}
Matches: ${matchesPlayed}
Wins: ${wins}
Draws: ${draws}
Losses: ${losses}
Goals: ${goals}
Assists: ${assists}
Rating: ${rating}

Rules:
- Do not invent statistics.
- Do not invent position.
- Do not invent playing style.
- Do not invent achievements.
- 45-80 words.
`,
              }
            );

          if (
            interaction.output_text
          ) {
            review =
              interaction
                .output_text
                .trim();

            generatedBy =
              "gemini";
          }
        } catch (error) {
          aiError =
            error.message;

          console.error(
            "Player review Gemini error:",
            error
          );
        }
      } else {
        aiError =
          "GEMINI_API_KEY is missing";
      }

      res.json({
        player: {
          id:
            player._id,

          name:
            player.name,

          profileImage:
            player.profileImage ||
            "",
        },

        stats: {
          matches:
            matchesPlayed,

          wins,

          draws,

          losses,

          goals,

          assists,

          points:
            rating,
        },

        review,

        generatedBy,

        aiError,
      });
    } catch (error) {
      console.error(
        "Player review error:",
        error
      );

      res.status(
        500
      ).json({
        message:
          "Failed to generate player review.",
      });
    }
  }
);

// ==================================================
// DELETE NEWS
// ==================================================

router.delete(
  "/:id",
  async (
    req,
    res
  ) => {
    try {
      const deleted =
        await News.findByIdAndDelete(
          req.params.id
        );

      if (!deleted) {
        return res
          .status(
            404
          )
          .json({
            message:
              "News article not found.",
          });
      }

      res.json({
        message:
          "News article deleted.",
      });
    } catch (error) {
      console.error(
        "News delete error:",
        error
      );

      res.status(
        500
      ).json({
        message:
          "Failed to delete news article.",
      });
    }
  }
);

export default router;