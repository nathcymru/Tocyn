# Deployment guide (historical, not an approved runbook)

Tocyn has no owner-approved production deployment date. This document preserves an inherited Luminatick procedure for historical reference; it is not a validated Tocyn provisioning, migration, or seeding runbook. Do not run its commands against an account, and do not use `npm run setup:prod`, `deploy*`, `seed:prod`, `--remote`, or a provider setup as contributor-setup evidence. Isolated preview/beta manifests, credentials, deployment rehearsal, rollback and controlled provider testing are owned by [#57](https://github.com/nathcymru/Tocyn/issues/57).

For wholly local development, use [CONTRIBUTING.md](../CONTRIBUTING.md). It uses `apps/server/wrangler.local.json`, synthetic secrets, and local emulation for D1, R2 and Durable Objects. The local walkthrough omits AI, Vectorize and the Workflow, avoiding remote credentials and charges. The accepted beta used local mail capture; no external beta mail provider or additional API billing is required for the next operator-workspace gate.

The historical text below predates the tenant schema and Node 22 support policy. In particular, its production seed command invokes a generator that now refuses current-schema databases unless explicitly marked as a reviewed legacy schema; it must not be adapted for tenant provisioning. Repeatable two-tenant fixtures are owned by [#58](https://github.com/nathcymru/Tocyn/issues/58).

## Preserved inherited procedure

The following procedure is historical only and must not be used as authority for the published beta or future `beta.2`. The local beta checkpoint was accepted at `049ea82a02571681f834bcd87d43253603edf71f` on 9 September 2026 and published as `v0.4.0-beta.1` on 10 September 2026. A future `beta.2` requires the separate operator UX gate and the technical production/cutover gate; neither authorises remote provisioning here.

## Architecture: Option 3 (Hybrid Offloading)

Luminatick uses a **Hybrid Offloading Architecture (Option 3)** to completely bypass the Cloudflare D1 10GB storage limit and ensure massive scalability. 

Instead of storing heavy ticket payloads (such as full HTML or Markdown article bodies) directly in the database, the system:
1. Stores essential **metadata and short text snippets** in the D1 `articles` table.
2. Offloads the **full message body** (and any file attachments) as objects to Cloudflare R2.
3. Merges the metadata and R2 payloads concurrently during API retrieval.

To support this, an R2 bucket (e.g., `luminatick-attachments`) must be provisioned and bound to your backend Worker using the `ATTACHMENTS_BUCKET` binding in `apps/server/wrangler.json`. The setup scripts below handle this provisioning automatically.

## Prerequisites
- A Cloudflare Account.
- Node.js (v18+) and `npm` installed.
- Logged into Wrangler locally: `npx wrangler login`

## Deployment Steps

### 1. Provision Infrastructure
Run the following command to create your D1 database, R2 buckets, and Vectorize index. This script will automatically update your `apps/server/wrangler.json` with the new database ID and provision the `luminatick-attachments` R2 bucket required for Option 3.

```bash
npm run setup:prod
```

### 2. Configure Secrets
Run the following command to prompt for and securely upload your production secrets (`JWT_SECRET`, `APP_MASTER_KEY`, etc.) to Cloudflare.

```bash
npm run secrets:prod
```

**Important:** You must generate a strong `APP_MASTER_KEY` (e.g., a 32-byte hex string) and set it as a secret. This key powers the Application-Layer Encryption design, allowing Luminatick to securely store third-party integration tokens (like your **Resend API Key**) directly in the D1 database. This ensures that adding new integrations (e.g., email channels, chat channels, CRM syncs) doesn't require updating Cloudflare Worker secrets and redeploying the application each time. You will configure your Resend credentials in the Dashboard UI under **Settings -> Channels -> Email**.

### 3. Deploy Applications
Run the following command to build and deploy your backend Worker, Admin Dashboard (Pages), Customer Portal (Pages), and Widget (R2).

```bash
npm run deploy
```

*Note: During this process, after the backend server is deployed, the script will pause and ask you to enter the newly deployed backend URL (e.g., `https://luminatick-server.<subdomain>.workers.dev`). It uses this URL to automatically configure the environment variables for your frontend applications before they are built.*

### 4. Seed Production Database
Once everything is deployed, initialize your production database with the initial Admin account. By default, this creates an admin user with email `admin@luminatick.local` and a random password (which will be printed to your console).

```bash
npm run seed:prod
```

### 5. Post-Deployment Configuration
Before your customers can fully utilize the system, you must configure outbound email. 
1. Log into the Admin Dashboard using the credentials generated in Step 4.
2. Navigate to **Settings -> Channels -> Email** (or General Settings depending on UI).
3. Configure your Outbound Email credentials (e.g., Resend API key).

**Crucial:** The **Customer Portal** (`apps/portal`) uses Passwordless Magic Link & OTP authentication. Customers *will not* be able to log into the portal until you have configured a working outbound email provider to deliver their login codes.

## Email Setup

After deploying the system, you must configure email routing to receive support tickets.

- **[Gmail Forwarding Model](email-setup.md):** The recommended way to set up inbound and outbound email using Gmail and Cloudflare Email Routing.

## Maintenance

- **Apply Migrations:** If you add new tables locally, apply them to production with: `npm run deploy:server`.
- **Update Widget:** If you modify the widget code, update it in R2 with: `npm run deploy:widget`.
- **R2 Public Access:** After the first `setup:prod`, ensure the `luminatick-widget` R2 bucket is configured for public access in the Cloudflare Dashboard to serve the `lumina-widget.js` file.
