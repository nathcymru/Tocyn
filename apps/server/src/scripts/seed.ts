/// <reference types="node" />
import { AuthService } from "../services/auth/auth.service";
import * as fs from 'fs';

/**
 * This script generates the SQL for seeding the Luminatick database.
 * Usage: npm run seed [-- --file seed.sql]
 */

async function seed() {
  // This legacy seed targets the pre-tenant schema. Never apply it implicitly to Phase 1.
  if (!process.argv.includes('--legacy-schema')) {
    throw new Error('Legacy seed requires --legacy-schema and an explicitly reviewed pre-tenant local database; Phase 1 provisioning is tracked in #42.');
  }
  const authService = new AuthService();
  const adminId = "00000000-0000-0000-0000-000000000001";
  const adminEmail = "admin@luminatick.local";

  // Generate a secure random temporary password for the initial admin
  const adminPassword = crypto.randomUUID();
  const passwordHash = await authService.hashPassword(adminPassword);

  const sqlStatements: string[] = [];

  // Enable foreign keys
  sqlStatements.push("PRAGMA foreign_keys = ON;");

  // 1. Initial Config
  sqlStatements.push(
    `INSERT OR IGNORE INTO config (key, value) VALUES ('COMPANY_NAME', 'Luminatick Support');`,
    `INSERT OR IGNORE INTO config (key, value) VALUES ('PORTAL_URL', 'https://support.example.com');`,
    `INSERT OR IGNORE INTO config (key, value) VALUES ('SYSTEM_TIMEZONE', 'UTC');`,
    `INSERT OR IGNORE INTO config (key, value) VALUES ('TICKET_PREFIX', 'SUP-');`,
    `INSERT OR IGNORE INTO config (key, value) VALUES ('DEFAULT_EMAIL_SIGNATURE', '---\\nLuminatick Support Team');`,
    `INSERT OR IGNORE INTO config (key, value) VALUES ('ALLOW_PUBLIC_SIGNUP', 'false');`,
    `INSERT OR IGNORE INTO config (key, value) VALUES ('DEFAULT_TICKET_STATUS', 'open');`
  );

  // 2. Default Group
  const groupId = "00000000-0000-0000-0000-000000000002";
  sqlStatements.push(
    `INSERT OR IGNORE INTO groups (id, name, description) VALUES ('${groupId}', 'General Support', 'The default group for all incoming tickets.');`
  );

  // 3. Admin User
  sqlStatements.push(
    `INSERT OR IGNORE INTO users (id, email, full_name, password_hash, role, mfa_enabled) VALUES ('${adminId}', '${adminEmail}', 'System Admin', '${passwordHash}', 'admin', FALSE);`
  );

  // 4. Assign Admin to General Support
  sqlStatements.push(
    `INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES ('${adminId}', '${groupId}');`
  );

  const sqlOutput = "-- Luminatick Seed Data\n" + sqlStatements.join("\n");

  // Check for --file argument
  const fileArgIndex = process.argv.indexOf("--file");
  if (fileArgIndex !== -1 && process.argv[fileArgIndex + 1]) {
    const filePath = process.argv[fileArgIndex + 1];
    fs.writeFileSync(filePath, sqlOutput);
  } else {
    console.log(sqlOutput);
  }

  console.error("\n--- LEGACY SQL GENERATED (NOT APPLIED) ---");
  console.error(`Admin Email: ${adminEmail}`);
  console.error(`Password for a newly inserted admin only: ${adminPassword}`);
  console.error("---------------------\n");

  console.error("\n--- POST-DEPLOYMENT ACTION REQUIRED ---");
  console.error("Before your customers can log into the Customer Portal:");
  console.error("1. Log into the Admin Dashboard using the credentials above.");
  console.error("2. Navigate to Settings -> Channels -> Email.");
  console.error("3. Configure your Outbound Email provider (e.g., Resend).");
  console.error("The portal relies on Passwordless Magic Link & OTP authentication,");
  console.error("which will fail until outbound email is configured.");
  console.error("---------------------------------------\n");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
