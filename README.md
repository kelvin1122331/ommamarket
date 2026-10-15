# ommamarket

A focused Shopee affiliate storefront with a server-side admin dashboard.

## What is included

- Responsive storefront with live product search.
- Product cards with Rupiah formatting, image fallback, affiliate links, and an explicit empty state.
- Hidden admin entry: click the `ommamarket` logo three times within two seconds.
- Server-side admin authentication with scrypt password verification, rate-limited login attempts, HTTP-only session cookies, CSRF tokens, and same-origin checks.
- Product CRUD backed by JSON files so the project runs without a database dependency.
- Frontend is a single `public/index.html` file with inline CSS and JavaScript.

## Run locally

```bash
cp .env.example .env
npm start
```

The development fallback credentials are:

- Username: `admin`
- Password: `kelvin5757`

For a real deployment, set a strong `ADMIN_PASSWORD` and `SESSION_SECRET` in the environment. When `NODE_ENV=production`, the server refuses to start without `ADMIN_PASSWORD`. Do not commit `.env`.

Open [http://localhost:3000](http://localhost:3000).

## Data files

The server creates these files on first run:

- `data/products.json` — product catalog.
- `data/sessions.json` — hashed session token metadata.

They are ignored by Git intentionally. Replace the JSON persistence layer with a managed database before operating at high traffic or across multiple server instances.

## Security boundary

This version moves authentication and product mutations to the server. It is substantially safer than hardcoded browser-only credentials, but production deployment should still add HTTPS termination, a managed database, centralized session storage, monitoring, backups, and secret management.
