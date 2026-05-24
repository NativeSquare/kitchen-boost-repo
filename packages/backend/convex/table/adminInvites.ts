import { defineTable } from "convex/server";
import { v } from "convex/values";

const documentSchema = {
  email: v.string(),
  name: v.string(),
  token: v.string(),
  invitedBy: v.id("users"),
  expiresAt: v.number(),
  acceptedAt: v.optional(v.number()),
};

export const adminInvites = defineTable(documentSchema)
  .index("by_token", ["token"])
  .index("by_email", ["email"]);

export const adminInviteValidator = v.object({
  _id: v.id("adminInvites"),
  _creationTime: v.number(),
  email: v.string(),
  name: v.string(),
  token: v.string(),
  invitedBy: v.id("users"),
  expiresAt: v.number(),
  acceptedAt: v.optional(v.number()),
});
