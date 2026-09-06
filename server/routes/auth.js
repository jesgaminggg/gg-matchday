import express from "express";

import User from "../models/User.js";

import {
  requireAuth,
  requireAdmin,
} from "../middleware/auth.js";

const router = express.Router();

// ==================================================
// GET CURRENT USER
// GET /api/auth/me
// ==================================================

router.get(
  "/me",
  requireAuth,
  async (req, res) => {
    try {
      const user =
        req.user;

      res.json({
        user: {
          id:
            user._id,

          firebaseUid:
            user.firebaseUid,

          name:
            user.name,

          email:
            user.email,

          photoURL:
            user.photoURL || "",

          role:
            user.role,

          accessRequest:
            user.accessRequest ||
            "none",
        },
      });
    } catch (error) {
      console.error(
        "GET /auth/me error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to load account.",
      });
    }
  }
);

// ==================================================
// REQUEST EDITOR ACCESS
// POST /api/auth/request-editor
// ==================================================

router.post(
  "/request-editor",
  requireAuth,
  async (req, res) => {
    try {
      const user =
        req.user;

      // Admins/editors don't need to request access.
      if (
        user.role ===
          "admin" ||
        user.role ===
          "editor"
      ) {
        return res.json({
          message:
            "You already have editing access.",

          user: {
            id:
              user._id,

            name:
              user.name,

            email:
              user.email,

            role:
              user.role,

            accessRequest:
              user.accessRequest ||
              "none",
          },
        });
      }

      // Prevent duplicate pending requests.
      if (
        user.accessRequest ===
        "pending"
      ) {
        return res.json({
          message:
            "Your editor request is already pending.",

          user: {
            id:
              user._id,

            name:
              user.name,

            email:
              user.email,

            role:
              user.role,

            accessRequest:
              "pending",
          },
        });
      }

      user.accessRequest =
        "pending";

      await user.save();

      res.json({
        message:
          "Editor access request submitted.",

        user: {
          id:
            user._id,

          name:
            user.name,

          email:
            user.email,

          role:
            user.role,

          accessRequest:
            user.accessRequest,
        },
      });
    } catch (error) {
      console.error(
        "Request editor error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to submit editor request.",
      });
    }
  }
);

// ==================================================
// ADMIN: LIST USERS WAITING FOR EDITOR ACCESS
// GET /api/auth/admin/requests
// ==================================================

router.get(
  "/admin/requests",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const requests =
        await User.find({
          accessRequest:
            "pending",
        })
          .select(
            "_id name email photoURL role accessRequest createdAt"
          )
          .sort({
            createdAt:
              -1,
          });

      res.json(
        requests
      );
    } catch (error) {
      console.error(
        "Load editor requests error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to load editor requests.",
      });
    }
  }
);

// ==================================================
// ADMIN: LIST ACTIVE EDITORS
// GET /api/auth/admin/editors
// ==================================================

router.get(
  "/admin/editors",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const editors =
        await User.find({
          role:
            "editor",
        })
          .select(
            "_id name email photoURL role accessRequest createdAt updatedAt"
          )
          .sort({
            name:
              1,
          });

      res.json(
        editors
      );
    } catch (error) {
      console.error(
        "Load editors error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to load editors.",
      });
    }
  }
);

// ==================================================
// ADMIN: APPROVE EDITOR REQUEST
// POST /api/auth/admin/requests/:id/approve
// ==================================================

router.post(
  "/admin/requests/:id/approve",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const user =
        await User.findById(
          req.params.id
        );

      if (!user) {
        return res.status(
          404
        ).json({
          message:
            "User not found.",
        });
      }

      if (
        user.role ===
        "admin"
      ) {
        return res.status(
          400
        ).json({
          message:
            "Admin accounts cannot be changed here.",
        });
      }

      user.role =
        "editor";

      user.accessRequest =
        "none";

      await user.save();

      res.json({
        message:
          `${user.name || user.email} is now an editor.`,

        user: {
          id:
            user._id,

          name:
            user.name,

          email:
            user.email,

          role:
            user.role,

          accessRequest:
            user.accessRequest,
        },
      });
    } catch (error) {
      console.error(
        "Approve editor error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to approve editor request.",
      });
    }
  }
);

// ==================================================
// ADMIN: REJECT EDITOR REQUEST
// POST /api/auth/admin/requests/:id/reject
// ==================================================

router.post(
  "/admin/requests/:id/reject",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const user =
        await User.findById(
          req.params.id
        );

      if (!user) {
        return res.status(
          404
        ).json({
          message:
            "User not found.",
        });
      }

      if (
        user.role ===
        "admin"
      ) {
        return res.status(
          400
        ).json({
          message:
            "Admin accounts cannot be changed here.",
        });
      }

      user.accessRequest =
        "rejected";

      await user.save();

      res.json({
        message:
          `Editor request from ${user.name || user.email} rejected.`,

        user: {
          id:
            user._id,

          name:
            user.name,

          email:
            user.email,

          role:
            user.role,

          accessRequest:
            user.accessRequest,
        },
      });
    } catch (error) {
      console.error(
        "Reject editor error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to reject editor request.",
      });
    }
  }
);

// ==================================================
// ADMIN: REVOKE EDITOR
// POST /api/auth/admin/editors/:id/revoke
// ==================================================

router.post(
  "/admin/editors/:id/revoke",
  requireAuth,
  requireAdmin,
  async (req, res) => {
    try {
      const user =
        await User.findById(
          req.params.id
        );

      if (!user) {
        return res.status(
          404
        ).json({
          message:
            "User not found.",
        });
      }

      // NEVER allow this endpoint to
      // modify an admin account.
      if (
        user.role ===
        "admin"
      ) {
        return res.status(
          400
        ).json({
          message:
            "Admin accounts cannot be demoted.",
        });
      }

      if (
        user.role !==
        "editor"
      ) {
        return res.status(
          400
        ).json({
          message:
            "This user is not an active editor.",
        });
      }

      user.role =
        "viewer";

      user.accessRequest =
        "none";

      await user.save();

      res.json({
        message:
          `${user.name || user.email} has been moved back to viewer.`,

        user: {
          id:
            user._id,

          name:
            user.name,

          email:
            user.email,

          role:
            user.role,

          accessRequest:
            user.accessRequest,
        },
      });
    } catch (error) {
      console.error(
        "Revoke editor error:",
        error
      );

      res.status(500).json({
        message:
          "Failed to revoke editor access.",
      });
    }
  }
);

export default router;