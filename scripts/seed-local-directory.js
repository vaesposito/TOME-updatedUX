/**
 * Seed a few directory users so /api/users/search returns results locally.
 *
 * With SSO disabled nobody ever signs in, so the `users` collection stays
 * empty and the "Notify specific users" picker has nothing to find. These are
 * obviously-fake example.com identities for local development only — safe to
 * re-run, and safe to delete (see the bottom of this file for the query).
 *
 * Usage: docker exec -i <mongo> mongosh --quiet "$MONGODB_URI" \
 *          --file /path/to/seed-local-directory.js
 */

// [name, email, keycloak subject]
const PEOPLE = [
  ["Avery Chen", "avery.chen@example.com", "local-dev-avery"],
  ["Dana Okafor", "dana.okafor@example.com", "local-dev-dana"],
  ["Priya Raman", "priya.raman@example.com", "local-dev-priya"],
  ["Sam Whitfield", "sam.whitfield@example.com", "local-dev-sam"],
  // No subject: never signed in, so cannot receive in-app notifications.
  // Kept deliberately so the "couldn't be reached" path is demonstrable.
  ["Jordan Mapfumo", "jordan.mapfumo@example.com", null],
];

const now = new Date();
const users = db.getCollection("users");

PEOPLE.forEach(([name, email, subject]) => {
  users.updateOne(
    { email },
    {
      $set: {
        name,
        email,
        ...(subject ? { keycloak_sub: subject } : {}),
        updated_at: now,
        metadata: {
          sso_provider: "local-dev-seed",
          sso_id: email,
          ...(subject ? { keycloak_sub: subject } : {}),
          role: "user",
        },
      },
      $setOnInsert: { created_at: now, last_login: now },
    },
    { upsert: true },
  );
});

print(`seeded ${PEOPLE.length} directory users`);
// Remove with: db.users.deleteMany({ "metadata.sso_provider": "local-dev-seed" })
