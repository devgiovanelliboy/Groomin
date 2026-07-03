/**
 * One-time script: sets isSuperAdmin: true claim for the Groomin admin account.
 * Run once from the functions/ directory with Application Default Credentials:
 *
 *   cd functions
 *   npx firebase-admin-script set-super-admin.js
 *   -- OR --
 *   GOOGLE_APPLICATION_CREDENTIALS=../service-account.json node set-super-admin.js
 *
 * After running and verifying super-admin access still works, the email
 * fallback in firestore.rules can be fully removed.
 */

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const ADMIN_EMAIL = "contato.groominbarber@gmail.com";

initializeApp({ projectId: "groomin-952d0" });
const auth = getAuth();

(async () => {
  const user = await auth.getUserByEmail(ADMIN_EMAIL);
  const current = user.customClaims || {};
  await auth.setCustomUserClaims(user.uid, { ...current, isSuperAdmin: true });
  console.log(`isSuperAdmin: true set for uid=${user.uid} (${ADMIN_EMAIL})`);
  console.log("Done. The user must sign out and back in (or wait 1h) for the new token to take effect.");
})().catch((e) => { console.error(e); process.exit(1); });
