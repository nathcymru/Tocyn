import tseslint from "typescript-eslint";

const d1Restriction = [
  "error",
  {
    selector: "MemberExpression[property.name='DB']",
    message: "Raw D1 bindings (env.DB) are strictly prohibited outside the repository boundary."
  },
  {
    selector: "CallExpression[callee.property.name='prepare']",
    message: "Raw SQL preparation is prohibited outside the repository boundary."
  }
];

const r2Restriction = [
  "error",
  {
    selector: "MemberExpression[property.name='ATTACHMENTS_BUCKET']",
    message: "Raw R2 bindings (env.ATTACHMENTS_BUCKET) are strictly prohibited outside the storage boundary."
  }
];

const combinedRestrictions = [
  "error",
  ...d1Restriction.slice(1),
  ...r2Restriction.slice(1)
];

export default tseslint.config(
  {
    files: ["**/*.ts"],
    ignores: ["node_modules/**", "dist/**", ".wrangler/**"],
    languageOptions: {
      parser: tseslint.parser,
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/auth/scope", "*/auth/scope", "../auth/scope", "../../auth/scope"],
              importNames: ["createVerifiedTenantScope"],
              message: "VerifiedTenantScope can only be constructed by the trusted auth boundary."
            }
          ]
        }
      ],
      "no-restricted-syntax": combinedRestrictions
    }
  },
  {
    files: [
      "src/repositories/**/*.ts"
    ],
    rules: {
      "no-restricted-syntax": r2Restriction
    }
  },
  {
    files: [
      "src/storage/adapters.ts"
    ],
    rules: {
      "no-restricted-syntax": d1Restriction
    }
  },
  {
    files: [
      "src/middleware/tenant.middleware.ts"
    ],
    rules: {
      "no-restricted-syntax": "off"
    }
  },
  {
    files: [
      "scripts/**/*.ts",
      "src/repositories/__tests__/**/*.ts",
      "src/storage/__tests__/**/*.ts"
    ],
    rules: {
      "no-restricted-syntax": "off",
      "no-restricted-imports": "off"
    }
  },
  {
    files: [
      "src/handlers/auth.handler.ts",
      "src/handlers/channels.handler.ts",
      "src/handlers/dashboard.handler.ts",
      "src/handlers/email.handler.ts",
      "src/handlers/filters.handler.ts",
      "src/handlers/permissions.handler.ts",
      "src/handlers/settings.handler.ts",
      "src/handlers/v1.handler.ts",
      "src/handlers/widget.handler.ts",
      "src/middleware/permission.guard.ts",
      "src/services/__tests__/automation.service.test.ts",
      "src/services/__tests__/knowledge.service.test.ts",
      "src/services/auth/apiKey.service.ts",
      "src/services/auth/auth.service.ts",
      "src/services/automation.service.ts",
      "src/services/cloudflare.service.ts",
      "src/services/customer-auth.service.ts",
      "src/services/email/outbound.service.ts",
      "src/services/knowledge.service.ts",
      "src/services/ticket.service.ts",
      "src/services/storage.service.ts",
      "src/utils/turnstile.ts",
      "src/workflows/vectorize.workflow.ts"
    ],
    rules: {
      "no-restricted-syntax": "off"
    }
  },
  {
    files: ["src/auth/scope.ts", "src/middleware/auth.middleware.ts"],
    rules: {
      "no-restricted-imports": "off"
    }
  }
);
