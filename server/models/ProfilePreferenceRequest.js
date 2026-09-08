import mongoose from "mongoose";

const profilePreferenceRequestSchema = new mongoose.Schema(
  {
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    player: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Player",
      required: true,
      index: true,
    },
    preferredPositions: {
      type: [String],
      default: undefined,
    },
    elClasicoSide: {
      type: String,
      enum: ["", "Messi", "Ronaldo"],
      default: undefined,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      maxlength: 300,
      default: "",
    },
  },
  { timestamps: true }
);

profilePreferenceRequestSchema.index({
  requestedBy: 1,
  status: 1,
});

export default mongoose.model(
  "ProfilePreferenceRequest",
  profilePreferenceRequestSchema
);
