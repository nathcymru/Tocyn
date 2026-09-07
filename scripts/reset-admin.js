const crypto = require('crypto');

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iterations = 100000;
  const passwordBuffer = new TextEncoder().encode(password);

  const key = await crypto.subtle.importKey(
    "raw",
    passwordBuffer,
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"]
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: salt,
      iterations: iterations,
      hash: "SHA-256"
    },
    key,
    256
  );

  const hash = new Uint8Array(derivedBits);
  return `${uint8ArrayToBase64(salt)}:${iterations}:${uint8ArrayToBase64(hash)}`;
}

function uint8ArrayToBase64(arr) {
  return btoa(String.fromCharCode(...arr));
}

(async () => {
  const newPassword = process.argv[2] || crypto.randomBytes(24).toString('base64url');
  const email = process.argv[3] || "admin@luminatick.local"; 
  
  const hashedPassword = await hashPassword(newPassword);
  
  const sql = `UPDATE users SET password_hash = '${hashedPassword}' WHERE lower(trim(email)) = '${email.trim().toLowerCase().replace(/'/g, "''")}' AND role = 'admin';`;
  
  console.log("\n--- Luminatick Local Admin Password Reset ---");
  console.log(`Email: ${email}`);
  console.log(`New Password: ${newPassword}`);
  console.log("\nRun the following command from the apps/server directory to update the local D1 database:\n");
  const shellQuote = value => "'" + value.replace(/'/g, "'\\''") + "'";
  console.log(`npx wrangler d1 execute luminatick-db --local --command ${shellQuote(sql)}\n`);
})();
