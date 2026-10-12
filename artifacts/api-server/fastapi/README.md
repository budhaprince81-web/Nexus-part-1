# NEXUS FastAPI Backend

An additive Python 3.11 service for NEXUS. It runs beside the existing Express API; it does not replace or migrate that service. PostgreSQL objects are isolated in the `nexus_python` schema and changes are managed only by Alembic.

## Folder structure

```text
fastapi/
├── app/
│   ├── api/v1/routers/       # REST endpoints grouped by domain
│   ├── core/                 # Settings, auth, logging, cache, errors
│   ├── db/                   # Async SQLAlchemy engine and session dependency
│   ├── models/               # PostgreSQL persistence models
│   ├── schemas/              # Pydantic request/response contracts
│   ├── services/             # Domain logic, AI, embeddings, safe file access
│   ├── middleware.py         # Request ID, payload limits, request logging
│   └── main.py               # FastAPI composition and lifespan
├── alembic/                  # Versioned database migrations
├── tests/                    # Unit and API tests
├── Dockerfile                # Python 3.11 production image
└── docker-compose.yml        # API + PostgreSQL/pgvector + Redis
```

## Run in Replit

The project expects Python 3.11, PostgreSQL (`DATABASE_URL`), Redis (`REDIS_URL`), and `SESSION_SECRET` (at least 32 characters). The current NEXUS Repl provides PostgreSQL and `SESSION_SECRET`. The local development launcher starts a disposable Redis process if `REDIS_URL` is not explicitly set.

```bash
cd artifacts/api-server/fastapi
python3.11 -m pip install -r requirements.txt
cp .env.example .env             # set only values you manage; don't commit .env
bash scripts/dev.sh
```

Apply the versioned schema before starting the API:

```bash
alembic upgrade head
```

The API is served on port `8000`; OpenAPI docs are at `/docs` in development. The `nexus_python` PostgreSQL schema and pgvector extension are separate from the existing Drizzle-managed tables.

## First administrator

Create a normal account through `/api/v1/auth/register`, then promote the first active account from a trusted shell:

```bash
NEXUS_BOOTSTRAP_ADMIN_EMAIL=admin@example.com python3.11 scripts/bootstrap_admin.py
```

The command refuses to promote anyone after an active administrator exists. It does not expose a public role-promotion endpoint.

## Production with Docker Compose

Set `POSTGRES_PASSWORD`, `SESSION_SECRET` (random, 32+ characters), and optionally `ANTHROPIC_API_KEY` in the deployment environment. Then run `docker compose up --build -d`. The API container applies Alembic migrations before serving; PostgreSQL and Redis have persistent volumes and health checks. Do not use the example credentials in production.

For Replit, run Alembic as a release/deploy step before starting the API. Do not expose Redis or PostgreSQL ports publicly.

## API modules

All REST paths are under `/api/v1`. JWT login/refresh and developer API keys are supported. Resource queries are tenant-scoped to the authenticated user. Admin routes use an explicit role/permission policy. The API gateway applies request IDs, payload limits, structured logging, rate limits, and centralized error responses.

Implemented domains include authentication, users, memory with 384-dimension local embeddings and PostgreSQL vector search, agents, voice transcript interpretation, vision analysis, sandboxed workspace automation, research, coding sessions, tasks, notifications, plugins, developer API keys, settings, telemetry, analytics, permission policy, and gateway metadata.

## Security and operations

- Access tokens are short-lived; refresh tokens are rotated and stored hashed in Redis.
- Passwords use Argon2id. API keys are returned once and stored as hashes.
- Sensitive mutations are audited. File operations reject traversal and symlink escapes.
- Plugin invocation is restricted to HTTPS public hosts, bounded request sizes, safe paths, and non-redirecting timeouts; plugins do not execute arbitrary code.
- Redis and PostgreSQL are checked by readiness probes. Missing AI credentials produce a clear `503` only for AI-backed features.
- Logs are JSON, include request IDs, and omit authorization headers, tokens, passwords, and request bodies.

Run unit tests with `pytest`; run the static quality checks with `ruff check app tests`.
