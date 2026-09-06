import express from "express";
import mongoose from "mongoose";
import User from "../models/User.js";
import Player from "../models/Player.js";
import ProfileChangeRequest from "../models/ProfileChangeRequest.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";

const router = express.Router();
const fields = ["profileImage", "height", "weight", "position", "preferredFoot", "jerseyNumber", "dateOfBirth", "bio"];

router.post("/", requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== "viewer") return next();
    if (!req.user.playerProfile) return res.status(403).json({ message: "Your account has not been linked to a player profile yet." });
    const player = await Player.findById(req.user.playerProfile);
    if (!player) return res.status(404).json({ message: "Your linked player profile was not found." });
    if (req.body.playerId && String(req.body.playerId) !== String(player._id)) return res.status(403).json({ message: "You can only request changes to your own linked profile." });
    const pending = await ProfileChangeRequest.findOne({ requestedBy: req.user._id, status: "pending" });
    if (pending) return res.status(409).json({ message: "You already have a profile update request pending." });

    const changes = {};
    for (const field of fields) {
      if (Object.prototype.hasOwnProperty.call(req.body.changes || {}, field)) changes[field] = req.body.changes[field];
    }
    if (!Object.keys(changes).length) return res.status(400).json({ message: "No profile changes were submitted." });

    const before = {};
    for (const field of Object.keys(changes)) before[field] = player[field] ?? null;
    const request = await ProfileChangeRequest.create({ requestedBy: req.user._id, player: player._id, changes, before, status: "pending" });
    res.status(201).json(request);
  } catch (error) {
    res.status(400).json({ message: error.message || "Failed to submit profile update request." });
  }
});

router.get("/admin/users", requireAuth, requireAdmin, async (req, res) => {
  const users = await User.find({ role: "viewer" }).select("_id name email photoURL profileImage playerProfile role").sort({ name: 1 });
  res.json(users);
});

router.post("/admin/link", requireAuth, requireAdmin, async (req, res) => {
  const { userId, playerId } = req.body;
  if (!mongoose.isValidObjectId(userId) || !mongoose.isValidObjectId(playerId)) return res.status(400).json({ message: "Choose a valid user and player." });
  const [user, player] = await Promise.all([User.findById(userId), Player.findById(playerId)]);
  if (!user || !player) return res.status(404).json({ message: "User or player not found." });
  if (user.role !== "viewer") return res.status(400).json({ message: "Only viewer accounts can be linked here." });
  const conflict = await User.findOne({ playerProfile: player._id, _id: { $ne: user._id } });
  if (conflict) return res.status(409).json({ message: `${player.name} is already linked to another account.` });
  user.playerProfile = player._id;
  await user.save();
  res.json({ message: `${user.name || user.email} is linked to ${player.name}.`, user });
});

router.post("/admin/unlink", requireAuth, requireAdmin, async (req, res) => {
  if (!mongoose.isValidObjectId(req.body.userId)) return res.status(400).json({ message: "Choose a valid user." });
  const user = await User.findById(req.body.userId);
  if (!user) return res.status(404).json({ message: "User not found." });
  user.playerProfile = null;
  await user.save();
  res.json({ message: "Player profile unlinked.", user });
});

export default router;
