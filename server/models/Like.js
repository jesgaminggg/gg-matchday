import mongoose from "mongoose";

const likeSchema = new mongoose.Schema(
  {
    targetType: {
      type: String,
      enum: ["gallery", "news", "match"],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

likeSchema.index(
  { targetType: 1, targetId: 1, user: 1 },
  { unique: true }
);
likeSchema.index({ targetType: 1, targetId: 1 });

export default mongoose.model("Like", likeSchema);
