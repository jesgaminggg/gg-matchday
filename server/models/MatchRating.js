import mongoose from "mongoose";

const matchRatingSchema = new mongoose.Schema(
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
    rating: {
      type: Number,
      required: true,
      min: 0,
      max: 10,
    },
  },
  { timestamps: true }
);

matchRatingSchema.index({ match: 1, player: 1 }, { unique: true });
matchRatingSchema.index({ player: 1, match: 1 });

export default mongoose.model("MatchRating", matchRatingSchema);
