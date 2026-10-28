"""Check the local Authentik-backed login boundary without user interaction.

The Authentik login flow is JavaScript-driven, so this dependency-free script
checks the services, protected routes, redirect chain, and requested URL. Use a
browser for the documented Alice/Bob login and logout check.
"""

from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit
from urllib.request import HTTPCookieProcessor, HTTPRedirectHandler, ProxyHandler, Request, build_opener
import json


ROOT = "http://localhost:8080"
AUTHENTIK = "http://sso.localhost:9000"
GAME_NAMES = ("chess", "checkers", "backgammon", "solitaire", "sudoku")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        return None


cookies = CookieJar()
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
    Request(
        f"{AUTHENTIK}/application/o/rediff-sso/.well-known/openid-configuration",
        headers={"Origin": ROOT},
    ), timeout=20
) as response:
    assert response.headers.get("Access-Control-Allow-Origin") in (ROOT, "*"), "Portal logout needs discovery CORS access"
    discovery = json.load(response)
    assert discovery["issuer"] == f"{AUTHENTIK}/application/o/rediff-sso/"
    assert discovery["authorization_endpoint"] == f"{AUTHENTIK}/application/o/authorize/"
    assert discovery["end_session_endpoint"] == f"{AUTHENTIK}/application/o/rediff-sso/end-session/"

with opener.open(f"{ROOT}/auth/config", timeout=20) as response:
    config = json.load(response)
    assert config["issuer"] == discovery["issuer"]
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
    authorization = parse_qs(urlsplit(response.url).query)
    assert authorization["client_id"] == ["games-web"]
    assert authorization["redirect_uri"] == [f"{ROOT}/oauth2/callback"]
    assert authorization["code_challenge_method"] == ["S256"]
    assert authorization["state"][0].endswith(f":{requested}"), "The requested game URL was not preserved"
    assert "auth.localhost" not in response.url

print("Authentik health, OIDC discovery, protected routes, redirect, and requested URL: passed")
