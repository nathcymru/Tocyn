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
              importNames: ["createVerifiedTenantScope", "createSystemTenantScope"],
              message: "Scopes can only be constructed by the trusted auth boundary."
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
      "src/middleware/tenant.middleware.ts",
      "src/middleware/api-auth.middleware.ts",
      "src/middleware/auth.middleware.ts",
      "src/middleware/widget-auth.middleware.ts"
    ],
    rules: {
      "no-restricted-syntax": "off"
    }
  },
  {
    files: [
      "scripts/**/*.ts",
      "src/repositories/__tests__/**/*.ts",
      "src/storage/__tests__/**/*.ts",
      "src/services/__tests__/**/*.ts"
    ],
    rules: {
      "no-restricted-syntax": "off",
      "no-restricted-imports": "off"
    }
  },
  {
    files: [
      "src/services/auth/auth.service.ts",
      "src/services/auth/apiKey.service.ts",
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
    files: ["src/auth/scope.ts", "src/middleware/auth.middleware.ts", "src/middleware/widget-auth.middleware.ts", "src/auth/api-key-composition.ts", "src/handlers/customer.handler.ts"],
    rules: {
      "no-restricted-imports": "off"
    }
  },
  {
    files: [
      "src/auth/inbound-resolver.ts",
      "src/auth/api-key-resolver.ts",
      "src/auth/automation-resolver.ts",
      "src/auth/user-auth-resolver.ts",
      "src/auth/widget-tenant-resolver.ts"
    ],
    rules: {
      "no-restricted-syntax": r2Restriction
    }
  },
  {
    files: [
      "src/auth/inbound-composition.ts"
    ],
    rules: {
      "no-restricted-imports": "off"
    }
  }
);
