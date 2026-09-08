import mongoose from "mongoose";

const awardSchema = new mongoose.Schema(
  {
    awardType: {
      type: String,
      enum: [
        "player_of_month",
        "player_of_year",
        "best_offensive",
        "best_defensive",
        "el_clasico_player_of_year",
      ],
      required: true,
      index: true,
    },
    year: {
      type: Number,
      required: true,
      index: true,
    },
    month: {
      type: Number,
      min: 1,
      max: 12,
      default: null,
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
      min: 0,
      max: 10,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

awardSchema.index(
  { awardType: 1, year: 1, month: 1 },
  { unique: true }
);

export default mongoose.model("Award", awardSchema);
