from fastapi import APIRouter

from app.api.v1.routers import (
    agents,
    analytics,
    auth,
    automation,
    coding,
    developer,
    gateway,
    memory,
    notifications,
    permissions,
    plugins,
    research,
    settings,
    tasks,
    telemetry,
    users,
    vision,
    voice,
)

api_router = APIRouter()
for domain_router in (
    auth.router,
    users.router,
    memory.router,
    agents.router,
    voice.router,
    vision.router,
    automation.router,
    research.router,
    coding.router,
    tasks.router,
    notifications.router,
    plugins.router,
    developer.router,
    settings.router,
    telemetry.router,
    analytics.router,
    permissions.router,
    gateway.router,
):
    api_router.include_router(domain_router)
