import { RuleTester } from "eslint";
import tsParser from "@typescript-eslint/parser";
import { describe, it, afterAll } from "vitest";
import rule from "./no-untenanted-query.js";

// Wire ESLint's RuleTester into Vitest's test framework.
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.afterAll = afterAll;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

ruleTester.run("no-untenanted-query", rule, {
  valid: [
    // Goes through a helper — never touches ctx.db.*
    "const f = tenantQuery({ handler: async (ctx) => ctx.table('orders').collect() });",
    // A .query that is NOT on .db (Convex client call)
    "async function h(client){ return client.query(api.foo.bar); }",
    // .db but a non-datastore method
    "function h(ctx){ return ctx.db.normalizeId('orders', id); }",
  ],
  invalid: [
    {
      code: "async function h(ctx){ return await ctx.db.query('orders').collect(); }",
      errors: [{ messageId: "untenanted" }],
    },
    {
      code: "async function h(ctx){ return await ctx.db.get(id); }",
      errors: [{ messageId: "untenanted" }],
    },
    {
      code: "async function h(ctx){ return await ctx.db.insert('orders', doc); }",
      errors: [{ messageId: "untenanted" }],
    },
    {
      code: "function h(ctx){ ctx.db.patch(id, { x: 1 }); }",
      errors: [{ messageId: "untenanted" }],
    },
  ],
});
