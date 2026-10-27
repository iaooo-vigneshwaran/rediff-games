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

The local stack runs six services. NGINX serves the portal and games, OAuth2
Proxy manages the Games session, and the Keycloak `games` realm brokers login.
Authentik server, Authentik worker, and PostgreSQL provide the temporary Rediff
SSO. No real Rediff account is used.

The request path is:

```text
Browser -> NGINX -> OAuth2 Proxy -> Games Keycloak -> Authentik -> PostgreSQL
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
start all six local services. On the first start, Authentik initializes its
database and can take a few minutes to become healthy:

```sh
docker compose up --build -d
```

Open `http://localhost:8080/` and click a game. Authentik asks for the username
and then the password; sign in as `alice` or `bob`. You return to the exact game
URL originally requested. The portal shows the signed-in username and provides
Log out. The next game visit after a complete logout requires signing in again.

The local administration endpoints are:

- Keycloak: `http://auth.localhost:8081/`, username `admin`, password
  `KEYCLOAK_ADMIN_PASSWORD` from `.env`.
- Authentik: `http://sso.localhost:9000/if/admin/`, username `akadmin`, password
  `AUTHENTIK_ADMIN_PASSWORD` from `.env`.

After the services are healthy, this dependency-free smoke check verifies
Authentik health and discovery, all protected game routes, the login redirect,
and preservation of the requested URL:

```sh
python3 scripts/smoke-auth.py
```

The interactive username/password and logout steps must be checked in a browser
because Authentik's flow UI is JavaScript-driven. Direct requests for `/chess/`,
`/checkers/`, `/backgammon/`, `/solitaire/`, and `/sudoku/`, including their
asset files, pass through NGINX's session check. The portal remains public. The
development stack uses HTTP and sets `OAUTH2_PROXY_COOKIE_SECURE=false` only to
make local testing possible.

These URLs and Authentik users are local fixtures, not production settings. For
production, expose Games and Keycloak over HTTPS, set the session cookie's
Secure flag, use production secrets and persistent Keycloak storage, and replace
the `rediff-sso` identity provider endpoints with the real Rediff SSO
configuration. That replacement requires Rediff's protocol, endpoints, client
registration, identity claims, and logout contract. In particular, this fixture
marks its local email addresses as verified; that trust must be reviewed against
Rediff's actual email-verification guarantee. The temporary Authentik server,
worker, and PostgreSQL services can then be removed.

The existing optional Puter integrations remain independent: online play in
Chess, Checkers, and Backgammon and cloud saves in Solitaire and Sudoku may
still request a Puter account. The Games login only controls access to the
site. Like any browser-only game, previously downloaded code can be copied or
run outside this server; server access checks cannot prevent that.

## Container image

The image contains the assembled static site and NGINX, but protected game
paths depend on OAuth2 Proxy. Run it with the Compose stack above or provide
compatible proxy and Keycloak services and set `KEYCLOAK_ISSUER_URL`.
Generated metadata points to `games.rediff.com`.

## Licensing

The Everything repository is MIT licensed. The assembled site includes its
`LICENSE.txt`. Chess piece art has its own attribution in
`chess/pieces/LICENSE.txt`.
