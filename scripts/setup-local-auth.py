"""Compatibility notice for the retired Authentik setup command."""
print('No generated secrets are needed for the local cookie-auth stub.')
print('Run docker compose up --build -d, then open http://localhost:8080/auth/login.')
print('Existing .env credentials and Authentik data have not been changed.')
