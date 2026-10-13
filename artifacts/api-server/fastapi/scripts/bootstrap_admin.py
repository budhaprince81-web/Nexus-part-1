import asyncio
import os
import sys

from sqlalchemy import func, select

from app.db.session import SessionFactory, engine
from app.models import User


async def bootstrap_admin(email: str) -> bool:
    normalized_email = email.strip().lower()
    if not normalized_email:
        raise ValueError("NEXUS_BOOTSTRAP_ADMIN_EMAIL must be a non-empty email address")
    async with SessionFactory() as session:
        existing_admins = await session.scalar(
            select(func.count(User.id)).where(User.role == "admin", User.is_active.is_(True))
        )
        if existing_admins:
            return False
        user = await session.scalar(
            select(User).where(func.lower(User.email) == normalized_email, User.is_active.is_(True))
        )
        if user is None:
            raise LookupError("No active account matches NEXUS_BOOTSTRAP_ADMIN_EMAIL")
        user.role = "admin"
        await session.commit()
        return True


async def main() -> int:
    email = os.environ.get("NEXUS_BOOTSTRAP_ADMIN_EMAIL", "")
    try:
        if await bootstrap_admin(email):
            print("Administrator role assigned to the matching active account.")
        else:
            print("An active administrator already exists; no changes were made.")
        return 0
    except (LookupError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    finally:
        await engine.dispose()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
