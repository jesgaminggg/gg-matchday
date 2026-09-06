import mongoose from "mongoose";

const gallerySchema =
  new mongoose.Schema(
    {
      imageUrl: {
        type: String,
        required: true,
        trim: true,
      },

      caption: {
        type: String,
        default: "",
        trim: true,
        maxlength: 160,
      },

      uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        default: null,
      },

      uploadedByName: {
        type: String,
        default: "",
      },

      uploadedByEmail: {
        type: String,
        default: "",
      },

      matchId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Match",
        default: null,
      },

      playerId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Player",
        default: null,
      },
    },
    {
      timestamps: true,
    }
  );

export default mongoose.model(
  "Gallery",
  gallerySchema
);