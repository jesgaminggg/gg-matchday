import mongoose from "mongoose";

const playerV2MetaSchema = new mongoose.Schema(
  {
    player: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      required: true,
      unique: true,
      index: true,
    },
    preferredPositions: {
      type: [String],
      default: [],
    },
    elClasicoSide: {
      type: String,
      enum: ["", "Messi", "Ronaldo"],
      default: "",
    },
  },
  { timestamps: true }
);

playerV2MetaSchema.index({ elClasicoSide: 1 });

export default mongoose.model("PlayerV2Meta", playerV2MetaSchema);
