import os

os.environ.setdefault(
    "DATABASE_URL",
    "postgresql+asyncpg://nexus:nexus@127.0.0.1:5432/nexus_unit_tests",
)
os.environ.setdefault("SESSION_SECRET", "local-unit-test-secret-that-is-not-used-in-production")
os.environ.setdefault("APP_ENV", "test")
os.environ.setdefault("REDIS_URL", "redis://127.0.0.1:6380/15")
