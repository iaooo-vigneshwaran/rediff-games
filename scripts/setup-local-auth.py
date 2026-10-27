"""Create missing credentials for the local Games and Authentik stack."""

from base64 import urlsafe_b64encode
from os import open as os_open
from pathlib import Path
from secrets import token_bytes, token_urlsafe


PROJECT = Path(__file__).resolve().parent.parent
TARGET = PROJECT / ".env"

generated = {
    "KEYCLOAK_ADMIN_PASSWORD": token_urlsafe(24),
    "GAMES_WEB_CLIENT_SECRET": token_urlsafe(32),
    "OAUTH2_PROXY_COOKIE_SECRET": urlsafe_b64encode(token_bytes(32)).decode("ascii"),
    "AUTHENTIK_POSTGRES_PASSWORD": token_urlsafe(32),
    "AUTHENTIK_SECRET_KEY": token_urlsafe(48),
    "AUTHENTIK_ADMIN_PASSWORD": token_urlsafe(24),
    "AUTHENTIK_GAMES_CLIENT_SECRET": token_urlsafe(32),
    "MOCK_ALICE_PASSWORD": token_urlsafe(18),
    "MOCK_BOB_PASSWORD": token_urlsafe(18),
}

if TARGET.exists():
    existing = {
        line.split("=", 1)[0]
        for line in TARGET.read_text(encoding="utf-8").splitlines()
        if line and not line.startswith("#") and "=" in line
    }
    missing = {key: value for key, value in generated.items() if key not in existing}
    if missing:
        with TARGET.open("a", encoding="utf-8") as output:
            output.write("\n# Authentik-backed temporary Rediff SSO.\n")
            for key, value in missing.items():
                output.write(f"{key}={value}\n")
        print(f"Added {len(missing)} missing local credentials to {TARGET}.")
    else:
        print(f"Existing {TARGET} already contains all required credentials.")
else:
    with open(TARGET, "x", encoding="utf-8", opener=lambda path, flags: os_open(path, flags, 0o600)) as output:
        output.write("# Local development only. Do not use these credentials in production.\n")
        for key, value in generated.items():
            output.write(f"{key}={value}\n")
    print(f"Created {TARGET} with local test credentials.")
