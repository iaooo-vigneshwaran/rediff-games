"""Check the local Authentik-backed login boundary without user interaction.

The Authentik login flow is JavaScript-driven, so this dependency-free script
checks the services, protected routes, redirect chain, and requested URL. Use a
browser for the documented Alice/Bob login and logout check.

This script intentionally accepts Secure Keycloak cookies over local HTTP. That
exception is for the disposable development stack only; production uses HTTPS.
"""

from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPCookieProcessor, HTTPRedirectHandler, ProxyHandler, build_opener
from base64 import urlsafe_b64decode
import json


ROOT = "http://localhost:8080"
AUTHENTIK = "http://sso.localhost:9000"
GAME_NAMES = ("chess", "checkers", "backgammon", "solitaire", "sudoku")


class LocalCookies(CookieJar):
    def set_cookie(self, cookie):
        cookie.secure = False
        super().set_cookie(cookie)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


cookies = LocalCookies()
opener = build_opener(ProxyHandler({}), HTTPCookieProcessor(cookies))
no_redirect = build_opener(ProxyHandler({}), NoRedirect())


def status_without_redirect(url):
    try:
        with no_redirect.open(url, timeout=20) as response:
            return response.status
    except HTTPError as error:
        return error.code


with opener.open(f"{AUTHENTIK}/-/health/ready/", timeout=20) as response:
    assert response.status == 200

with opener.open(
    f"{AUTHENTIK}/application/o/rediff-sso/.well-known/openid-configuration", timeout=20
) as response:
    discovery = json.load(response)
    assert discovery["issuer"] == f"{AUTHENTIK}/application/o/rediff-sso/"
    assert discovery["authorization_endpoint"] == f"{AUTHENTIK}/application/o/authorize/"

with opener.open(f"{ROOT}/auth/config", timeout=20) as response:
    config = json.load(response)
    assert config["issuer"] == "http://auth.localhost:8081/realms/games"
    assert config["clientId"] == "games-web"

assert status_without_redirect(f"{ROOT}/") == 200
assert status_without_redirect(f"{ROOT}/oauth2/userinfo") == 401

for game in GAME_NAMES:
    assert status_without_redirect(f"{ROOT}/{game}/") == 302, game
    assert status_without_redirect(f"{ROOT}/{game}/assets/protected-check.js") == 302, game

requested = f"{ROOT}/chess/?invite=abc&mode=friend"
with opener.open(requested, timeout=30) as response:
    assert response.status == 200, response.status
    assert response.url.startswith(f"{AUTHENTIK}/if/flow/default-authentication-flow/"), response.url
    broker_state = parse_qs(urlsplit(response.url).query)["state"][0]
    payload = broker_state.rsplit(".", 1)[-1]
    client_data = json.loads(urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    assert client_data["st"].endswith(f":{requested}"), "The requested game URL was not preserved"

print("Authentik health, OIDC discovery, protected routes, redirect, and requested URL: passed")
