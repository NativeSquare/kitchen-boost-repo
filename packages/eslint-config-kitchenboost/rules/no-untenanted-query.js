/**
 * @fileoverview Forbids raw Convex datastore access (`ctx.db.query/get/insert/...`)
 * in business code. Every business query/mutation must go through the tenancy
 * helpers (`tenantQuery` / `tenantMutation` / `kbAdminQuery`), which is how
 * multi-tenant isolation is enforced in the absence of Postgres RLS. See ADR 0010.
 *
 * The sanctioned exceptions (the helper definitions themselves, codegen, the
 * GLOBAL-table foundation, tests) are exempted at the flat-config level via
 * `ignores`, not inside the rule — see `index.js` `configs.backendRecommended`.
 *
 * ACTIVE on packages/backend since story 1.x-H (see ADR 0010).
 */

const DEFAULT_METHODS = [
  "query",
  "get",
  "insert",
  "patch",
  "replace",
  "delete",
];

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw Convex datastore access (ctx.db.*) outside tenancy helpers; route through tenantQuery / tenantMutation / kbAdminQuery.",
      recommended: true,
    },
    schema: [
      {
        type: "object",
        properties: {
          methods: {
            type: "array",
            items: { type: "string" },
            description:
              "Datastore methods to flag on `*.db`. Defaults to query/get/insert/patch/replace/delete.",
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      untenanted:
        "Raw `ctx.db.{{method}}()` is forbidden in business code. Route through a tenancy helper (tenantQuery / tenantMutation / kbAdminQuery). See ADR 0010.",
    },
  },

  create(context) {
    const options = context.options[0] || {};
    const methods = options.methods || DEFAULT_METHODS;

    /** Resolve a property node to its name, whether `Identifier` or string `Literal`. */
    const propName = (prop) => {
      if (!prop) return null;
      if (prop.type === "Identifier") return prop.name;
      if (prop.type === "Literal" && typeof prop.value === "string")
        return prop.value;
      return null;
    };

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== "MemberExpression") return;

        // outer member: `<something>.<method>`
        const method = propName(callee.property);
        if (!methods.includes(method)) return;

        // inner member must be `<something>.db`
        const obj = callee.object;
        if (obj.type !== "MemberExpression") return;
        if (propName(obj.property) !== "db") return;

        context.report({
          node,
          messageId: "untenanted",
          data: { method: String(method) },
        });
      },
    };
  },
};

export default rule;
