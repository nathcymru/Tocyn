> Historical community draft. Current published architecture, roadmap and Wiki guidance are maintained in [the master baseline](https://github.com/nathcymru/Tocyn/blob/main/docs/planning/post-beta-2026-09-10/README.md) and `docs/wiki-sync/`. Preserve this text as drafting history; do not republish it over current guidance.

# Deployment and operating costs

The application aims to make practical use of Cloudflare's free allowances and avoid server administration. Charges depend on workload, enabled services and current provider terms.

Follow the versioned [deployment guide](https://github.com/nathcymru/Tocyn/blob/main/docs/deployment.md). It still uses inherited Luminatick resource names and Resend for outbound email. Cloudflare-native replacement is targeted for v0.3.0.

Before a real deployment, establish:
- Separate development and production resources and credentials.
- The service limits and usage controls for enabled integrations.
- Tested authentication email, replies and failure handling.
- Backup, restore, migration and rollback procedures.
- The security and tenant-isolation status of the exact version deployed.

These operational checks are work to complete, not guarantees supplied by an early-development repository. The public project's Web3Forms contact form is outside the application deployment.
