import express from "express";

import Gallery from "../models/Gallery.js";

import {
  requireAuth,
} from "../middleware/auth.js";

const router =
  express.Router();

// ==========================================
// GET GALLERY
// PUBLIC
// ==========================================

router.get(
  "/",
  async (req, res) => {
    try {
      const photos =
        await Gallery.find()
          .populate(
            "matchId",
            "name date teamA teamB"
          )
          .populate(
            "playerId",
            "name profileImage"
          )
          .sort({
            createdAt: -1,
          });

      res.json(
        photos
      );
    } catch (error) {
      console.error(
        "Gallery fetch error:",
        error
      );

      res.status(
        500
      ).json({
        message:
          "Failed to load gallery.",
      });
    }
  }
);

// ==========================================
// ADD PHOTO
// SIGNED-IN USERS
// ==========================================

router.post(
  "/",
  requireAuth,
  async (req, res) => {
    try {
      const {
        imageUrl,
        caption,
        matchId,
        playerId,
      } = req.body;

      if (
        !imageUrl ||
        typeof imageUrl !==
          "string"
      ) {
        return res.status(
          400
        ).json({
          message:
            "Image URL is required.",
        });
      }

      const photo =
        await Gallery.create({
          imageUrl:
            imageUrl.trim(),

          caption:
            typeof caption ===
            "string"
              ? caption.trim()
              : "",

          uploadedBy:
            req.user._id,

          uploadedByName:
            req.user.name ||
            "",

          uploadedByEmail:
            req.user.email ||
            "",

          matchId:
            matchId ||
            null,

          playerId:
            playerId ||
            null,
        });

      res.status(
        201
      ).json(
        photo
      );
    } catch (error) {
      console.error(
        "Gallery upload error:",
        error
      );

      res.status(
        500
      ).json({
        message:
          "Failed to save gallery photo.",
      });
    }
  }
);

// ==========================================
// DELETE PHOTO
// ADMIN / EDITOR
// ==========================================

router.delete(
  "/:id",
  requireAuth,
  async (req, res) => {
    try {
      const user =
        req.user;

      const photo =
        await Gallery.findById(
          req.params.id
        );

      if (!photo) {
        return res.status(
          404
        ).json({
          message:
            "Photo not found.",
        });
      }

      /*
        Admin can delete anything.

        An editor can delete only
        photos they uploaded.
      */

      const isAdmin =
        user.role ===
        "admin";

      const isOwner =
        String(
          photo.uploadedBy
        ) ===
        String(
          user._id
        );

      const isEditor =
        user.role ===
        "editor";

      if (
        !isAdmin &&
        !(isEditor &&
          isOwner)
      ) {
        return res.status(
          403
        ).json({
          message:
            "You do not have permission to delete this photo.",
        });
      }

      await Gallery.findByIdAndDelete(
        req.params.id
      );

      res.json({
        message:
          "Photo deleted.",
      });
    } catch (error) {
      console.error(
        "Gallery delete error:",
        error
      );

      res.status(
        500
      ).json({
        message:
          "Failed to delete photo.",
      });
    }
  }
);

export default router;