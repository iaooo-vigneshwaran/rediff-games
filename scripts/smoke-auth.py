"""Verify the cookie-auth boundary against a running local stack."""
import json
import os
from base64 import urlsafe_b64encode
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

ROOT = os.environ.get('GAMES_TEST_URL', 'http://localhost:8080')
GAMES = ('chess', 'checkers', 'backgammon', 'solitaire', 'sudoku')

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None

opener = build_opener(ProxyHandler({}), NoRedirect())
def request(path, user=None):
    headers = {}
    if user:
        token = urlsafe_b64encode(f'games-local:{user}:v1'.encode()).decode().rstrip('=')
        headers['Cookie'] = f'games_dev_session={token}'
    try:
        return opener.open(Request(ROOT + path, headers=headers), timeout=10)
    except HTTPError as error:
        return error

assert request('/').status == 200
login = request('/auth/login')
assert login.status == 200
assert b'id="login-form"' in login.read()
logout = request('/auth/logout')
assert logout.status == 200
assert b'/assets/dev-logout.js' in logout.read()
assert logout.headers['Cache-Control'] == 'no-store'
assert request('/api/auth/session').status == 401
for user in ('alice', 'bob', 'user1', 'user2', 'user3'):
    response = request('/api/auth/session', user)
    assert response.status == 200
    assert json.load(response)['user']['name'].lower() == user
assert request('/api/auth/session', 'expired').status == 401
assert request('/api/auth/session', 'unavailable').status == 503
for game in GAMES:
    assert request(f'/{game}').status == 308
    for path in (f'/{game}/', f'/{game}/assets/protected-check.js'):
        for user in (None, 'expired'):
            response = request(path, user)
            assert response.status == 302, (path, response.status)
            assert response.headers['Location'].endswith('/auth/login?return=' + path)
        assert request(path, 'unavailable').status == 503
    assert request(f'/{game}/', 'alice').status == 200
    assert request(f'/{game}/assets/protected-check.js', 'alice').status == 404
path = '/chess/?invite=abc&mode=friend'
assert request(path).headers['Location'].endswith('/auth/login?return=' + path)
assert request('/_auth_check').status == 404
print('Cookie session API, five protected games/assets, outage handling and return URL: passed')
