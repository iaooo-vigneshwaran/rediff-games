# Rediff Games

A static games portal and five independent builds of the games in
[HeyPuter/everything](https://github.com/HeyPuter/everything), pinned at
`7702e237b7945293158c50c4f3839b41287b51d4`.

The upstream source is vendored in `upstream/everything/src/{chess,checkers,backgammon,solitaire,sudoku}`.
Each app has its own `package.json`, dependencies, Vite configuration, and build.
The Solitaire entry point has one local adaptation: it retires its offline service
worker so an older cached game page cannot bypass the new session check.
The portal is plain HTML, CSS, and JavaScript.

## Build locally

Use Node.js 22.12 or newer. This command installs dependencies and builds each
game independently, then assembles `dist/`:

```sh
sh scripts/build.sh
```

The generated `dist/` is only a static build. Serving it with a plain static
server makes every game public; use the NGINX and OAuth2 Proxy stack below to
enforce login. The NGINX configuration also redirects `/game` to `/game/` for
each game.

## Local login test

The local stack runs five services. NGINX serves the portal and games, and OAuth2
Proxy manages the Games session using OIDC directly with Authentik.
Authentik server, Authentik worker, and PostgreSQL provide the temporary Rediff
SSO. No real Rediff account is used.

The request path is:

```text
Browser -> NGINX -> OAuth2 Proxy -> Authentik
Authentik -> PostgreSQL (identity and session storage)
```

The Authentik worker handles background jobs and applies the declarative
configuration in `authentik/blueprints/rediff-sso.yaml`; it is not in the
browser request path. Alice and Bob, their password hashes, Authentik sessions,
and the OIDC provider configuration are stored in PostgreSQL's persistent
`authentik-database` Docker volume.

First, generate an ignored `.env` file containing random local client secrets,
database credentials, admin credentials, and passwords for the test users
`alice` and `bob`. Running the command again safely adds missing settings and
does not replace existing values:

```sh
python3 scripts/setup-local-auth.py
```

Open `.env` locally to see the generated test-user passwords. Then build and
start all five local services. On the first start, Authentik initializes its
database and can take a few minutes to become healthy:

```sh
docker compose up --build -d
```

Open `http://localhost:8080/` and click a game. Authentik asks for the username
and then the password; sign in as `alice` or `bob`. You return to the exact game
URL originally requested. The portal shows the signed-in username and provides
Log out. The next game visit after a complete logout requires signing in again.

The local administration endpoints are:

- Authentik: `http://sso.localhost:9000/if/admin/`, username `akadmin`, password
  `AUTHENTIK_ADMIN_PASSWORD` from `.env`.

After the services are healthy, this dependency-free smoke check verifies
Authentik health and discovery, all protected game routes, the login redirect,
and preservation of the requested URL:

```sh
python3 scripts/smoke-auth.py
```

Check the portal logout handler and its discovery-failure fallback with Node.js:

```sh
node scripts/check-portal-logout.mjs
```

The interactive username/password and logout steps must be checked in a browser
because Authentik's flow UI is JavaScript-driven. Direct requests for `/chess/`,
`/checkers/`, `/backgammon/`, `/solitaire/`, and `/sudoku/`, including their
asset files, pass through NGINX's session check. The portal remains public. The
development stack uses HTTP and sets `OAUTH2_PROXY_COOKIE_SECURE=false` only to
make local testing possible.

These URLs and Authentik users are local fixtures, not production settings. For
production, expose Games and the SSO provider over HTTPS, set the session cookie's
Secure flag, and use production secrets. To replace the temporary Authentik fixture
with real Rediff SSO, configure OAuth2 Proxy's issuer, client credentials, scopes,
and allowed logout destination; set Games' `OIDC_ISSUER_URL` and `OIDC_CLIENT_ID`
to match. Register the Games callback and post-logout URLs with that provider.
This requires Rediff's actual OIDC endpoints, identity claims, and logout contract.
In particular, this fixture marks local email addresses as verified; review that
trust against Rediff's actual email-verification guarantee. The temporary Authentik
server, worker, and PostgreSQL services can then be removed.

OAuth2 Proxy requests authorization code flow with PKCE and `offline_access` for
refresh tokens. The portal discovers the OIDC end-session endpoint, then sends
logout through OAuth2 Proxy so it inserts the ID token hint and clears the Games
cookie before redirecting to Authentik. Complete Authentik's logout flow to end
the SSO session. If discovery fails, the fallback clears only the Games session.

When upgrading an existing local stack, apply the updated provider blueprint
before recreating OAuth2 Proxy. This preserves the Authentik database and users:

```sh
docker compose exec -T authentik-worker ak apply_blueprint /blueprints/custom/rediff-sso.yaml
docker compose up --build -d
```

The old Keycloak container may remain as an unused orphan after upgrading. It
can be stopped without deleting it or the Authentik database. Existing `.env`
files may retain unused `KEYCLOAK_ADMIN_PASSWORD` and `GAMES_WEB_CLIENT_SECRET`
entries; the new stack does not use them. The new Games cookie name requires
users to sign in again after migration.

Chess, Checkers, and Backgammon use direct WebRTC multiplayer with manual
offer/answer exchange and no Puter, signaling backend, STUN, or TURN service.
Both players should use the same LAN; separate networks or restrictive firewalls
may prevent connections. See each game’s README for setup. Existing optional
cloud saves in Solitaire and Sudoku may still request a Puter account. The Games
login only controls access to the site. Like any browser-only game, previously downloaded code can be copied or
run outside this server; server access checks cannot prevent that.

## Container image

The image contains the assembled static site and NGINX, but protected game
paths depend on OAuth2 Proxy. Run it with the Compose stack above or provide
a compatible OIDC-configured OAuth2 Proxy and set `OIDC_ISSUER_URL` and
`OIDC_CLIENT_ID`. The discovery endpoint must permit browser access for logout.
Generated metadata points to `games.rediff.com`.

## Licensing

The Everything repository is MIT licensed. The assembled site includes its
`LICENSE.txt`. Chess piece art has its own attribution in
`chess/pieces/LICENSE.txt`.
