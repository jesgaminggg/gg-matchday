import mongoose from "mongoose";

const userSchema =
  new mongoose.Schema(
    {
      firebaseUid: {
        type: String,
        required: true,
        unique: true,
        index: true,
      },

      name: {
        type: String,
        required: true,
        trim: true,
      },

      email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
      },

      profileImage: {
        type: String,
        default: "",
      },

      role: {
        type: String,
        enum: [
          "viewer",
          "editor",
          "admin",
        ],
        default: "viewer",
      },

      accessRequest: {
        type: String,
        enum: [
          "none",
          "pending",
          "approved",
          "rejected",
        ],
        default: "none",
      },
    },
    {
      timestamps: true,
    }
  );

export default mongoose.model(
  "User",
  userSchema
);