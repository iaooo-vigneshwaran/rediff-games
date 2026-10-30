# Rediff Games

A public static portal and five independently built games: Chess, Checkers,
Backgammon, Solitaire and Sudoku. Source is vendored from HeyPuter/everything,
pinned at `7702e237b7945293158c50c4f3839b41287b51d4`.

NGINX serves the files and checks authentication before serving any game path,
including assets. A small Node.js + Fastify service validates selected cookies.
The homepage calls the same endpoint to display the verified user's name.

## Local development

Build and start the two services with `docker compose up --build -d`, then open
http://localhost:8080/. Docker provides Node 22; no database or generated secrets
are needed. The backend is exposed only within the Compose network.

The committed Compose configuration explicitly enables a development-only stub.
Open http://localhost:8080/auth/login. Available users are `alice`, `bob`,
`user1`, `user2`, and `user3`; the password for every user is `test`. Credentials are matched in frontend JavaScript only.
The homepage Log out link opens `/auth/logout`, which clears the development
cookie and returns to the homepage. No login/logout backend APIs are added. This does not
log into or out of Rediff. Direct game visits redirect here and preserve the
requested game URL and query string. Only same-origin game/home destinations
are accepted by the development page.

The stub recognizes fixed base64url-encoded fixture tokens in
`games_dev_session`. Encoding is not authentication: only the known fixture
values are accepted. These tokens are public development fixtures, never real
credentials. Passwords and tokens are public in the frontend; this is not a
production credential check. The local UI sets a JavaScript-readable test cookie so no extra
backend API is required; production authentication cookies may be HttpOnly.
Do not use real Rediff cookie values for local tests.

## Authentication contract

`GET /api/auth/session` reads the browser's Cookie header. Cookie selection uses
an explicit allowlist, preserves values without URL-decoding, requires every
configured cookie, and rejects duplicate selected cookie names. Unrelated
cookies are never passed to the validator. Cookies and identity responses are
not logged. Responses use `Cache-Control: no-store`.

| Status | Response / behavior |
| --- | --- |
| 200 | `{"authenticated":true,"user":{"id":"demo-alice","name":"Alice"}}` |
| 401 | `{"authenticated":false,"user":null}`; game visits redirect to login |
| 503 | Temporary verification failure; game access remains blocked |

NGINX calls the same endpoint using an internal subrequest. Since NGINX treats
non-2xx/401/403 authentication results as errors, game locations map these
failures to a 503 error page. Proxy connection/read timeouts are 2/5 seconds.
The homepage distinguishes logged-out responses from outages. There is no
validation cache or Games-owned session; each protected request is validated.
A short cache may be added after agreeing on revocation and upstream capacity.

## Real Rediff integration: not configured yet

The Rediff API URL, request authentication, timeout/retry policy, response
contract, required cookie names, login return parameter and logout contract are
unknown. Do not infer authentication from names such as Rlo or Rl.

Replace the validator adapter in `backend/app.js` once these details are known.
The adapter receives only selected cookie values and returns a verified
`{id, name}`, null for an invalid session, or throws for service failures.
Configure `AUTH_MODE=rediff` and `AUTH_COOKIE_NAMES` with the agreed names.
The executable currently refuses to start in real mode until the adapter is
supplied; it never silently falls back to mock authentication.

Stub mode requires `NODE_ENV=development` or `test`; production startup rejects
it. Before deployment, replace the development Compose environment, replace
NGINX's local login redirect with the approved Rediff login/return flow, and
replace the `/auth/logout` route with Rediff logout and exclude the local
login/logout HTML/JavaScript from the production image. Use HTTPS.
The existing Compose file is for local development only.

Authentication cookies must be eligible for games.rediff.com, including their
domain and path. HttpOnly does not stop browsers sending eligible cookies to
the backend. The backend needs no database. Local logout clears only the development
cookie; clearing it cannot revoke a Rediff login. Real Rediff logout awaits
its contract.

The old Authentik blueprint is retained as a historical fixture but is not
loaded by Compose. OAuth2 Proxy, Authentik and PostgreSQL no longer run in this
stack. The old database volume declaration is retained and no existing data or
.env credentials are deleted. Existing old-stack containers are not stopped by
these source changes. Do not use volume-deletion commands during migration if
you wish to preserve that data. The old setup script now prints local guidance.

## Verification and builds

For backend dependencies, `npm ci --prefix backend` installs the lockfile using
Node 22 or newer. `npm test --prefix backend` checks cookie filtering, stub
restrictions, valid/invalid/expired sessions and validator failures.
`node scripts/check-portal-auth.mjs` checks the homepage states and logout link.
`node scripts/check-dev-login.mjs` checks form credentials, cookies and safe
return destinations. `node scripts/check-dev-logout.mjs` checks cookie removal
and the homepage redirect.
Against a running local stack, `python3 scripts/smoke-auth.py` checks all five
games, asset boundaries, redirects and outages. Set `GAMES_TEST_URL` to test a
different local address. The old logout check delegates to the portal check.

`sh scripts/build.sh` builds all games and assembles dist/ using Node 22.12 or
newer. A plain static server bypasses authentication; use NGINX and the backend.
Solitaire's existing service-worker retirement remains to prevent older offline
caches bypassing server checks. Previously downloaded game code cannot be revoked.

Optional Puter multiplayer/cloud-save logins remain independent of Games login.
The upstream code is MIT licensed; assembled output includes LICENSE.txt and
Chess piece attribution at chess/pieces/LICENSE.txt.
