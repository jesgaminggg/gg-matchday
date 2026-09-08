import mongoose from "mongoose";

const motmVoteSchema = new mongoose.Schema(
  {
    match: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Match",
      required: true,
      index: true,
    },
    player: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      required: true,
      index: true,
    },
    voter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

motmVoteSchema.index({ match: 1, voter: 1 }, { unique: true });
motmVoteSchema.index({ match: 1, player: 1 });

export default mongoose.model("MotmVote", motmVoteSchema);
