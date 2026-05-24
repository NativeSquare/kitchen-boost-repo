import { authTables } from "@convex-dev/auth/server";
import { defineSchema } from "convex/server";
import { adminInvites } from "./table/adminInvites";
import { feedback } from "./table/feedback";
import { users } from "./table/users";

export default defineSchema({
  ...authTables,
  adminInvites,
  feedback,
  users,
});
