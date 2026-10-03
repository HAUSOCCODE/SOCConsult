import mongoose from "mongoose";
const schema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: { type: String, required: true, index: true },
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true },
    relatedEntityId: mongoose.Schema.Types.ObjectId,
    actionUrl: { type: String, trim: true, maxlength: 200 },
    isRead: { type: Boolean, default: false, index: true },
    readAt: Date,
  },
  { timestamps: true },
);
schema.index({ recipient: 1, createdAt: -1 });
export default mongoose.model("Notification", schema);
