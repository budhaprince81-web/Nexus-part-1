from dataclasses import dataclass


@dataclass(frozen=True)
class RoutePolicy:
    module: str
    permission: str
    description: str


ROUTE_POLICIES = (
    RoutePolicy("auth", "public", "Register, login, refresh and revoke sessions"),
    RoutePolicy("users", "profile:read", "Manage the authenticated user's profile"),
    RoutePolicy("memory", "memory:read", "Store and semantically search private memories"),
    RoutePolicy("agents", "agents:invoke", "Run and inspect AI agent jobs"),
    RoutePolicy("voice", "voice:use", "Interpret voice transcripts and return spoken-response text"),
    RoutePolicy("vision", "vision:analyze", "Analyze images with the Vision agent"),
    RoutePolicy("automation", "automation:read", "Operate on files inside the isolated NEXUS workspace"),
    RoutePolicy("research", "research:run", "Research and retain structured research results"),
    RoutePolicy("coding", "coding:run", "Generate and persist coding sessions"),
    RoutePolicy("tasks", "tasks:read", "Manage personal tasks"),
    RoutePolicy("notifications", "notifications:read", "Manage personal notifications"),
    RoutePolicy("plugins", "plugins:read", "Register and invoke constrained HTTPS plugins"),
    RoutePolicy("developer", "developer_keys:manage", "Create scoped developer API keys"),
    RoutePolicy("settings", "settings:read", "Manage personal preferences"),
    RoutePolicy("telemetry", "telemetry:write", "Record and inspect telemetry events"),
    RoutePolicy("analytics", "analytics:read", "View account-level usage metrics"),
    RoutePolicy("permissions", "permissions:read", "Inspect and administer role policies"),
    RoutePolicy("gateway", "public", "Inspect API capabilities and service health"),
)


def get_gateway_manifest() -> list[dict[str, str]]:
    return [
        {"module": policy.module, "permission": policy.permission, "description": policy.description}
        for policy in ROUTE_POLICIES
    ]
