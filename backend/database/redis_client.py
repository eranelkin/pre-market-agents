from typing import Any

import orjson
import structlog

log = structlog.get_logger()

_redis = None


async def _get_client():
    global _redis
    if _redis is not None:
        return _redis

    from backend.config import settings

    if not settings.redis_url:
        return None

    try:
        import redis.asyncio as aioredis

        client = aioredis.from_url(settings.redis_url, decode_responses=True)
        await client.ping()
        _redis = client
        log.info("redis_connected")
    except Exception as e:
        log.warning("redis_unavailable", error=str(e))
        _redis = None

    return _redis


async def set_key(key: str, value: Any, ttl: int = 86400) -> None:
    client = await _get_client()
    if client is None:
        return
    try:
        await client.setex(key, ttl, orjson.dumps(value).decode())
    except Exception as e:
        log.warning("redis_set_failed", key=key, error=str(e))


async def get_key(key: str) -> Any | None:
    client = await _get_client()
    if client is None:
        return None
    try:
        data = await client.get(key)
        return orjson.loads(data) if data else None
    except Exception as e:
        log.warning("redis_get_failed", key=key, error=str(e))
        return None


async def set_run_status(run_id: str, status: str) -> None:
    await set_key(f"run:{run_id}:status", status)


async def get_run_status(run_id: str) -> str | None:
    return await get_key(f"run:{run_id}:status")


async def set_run_progress(run_id: str, progress: dict) -> None:
    await set_key(f"run:{run_id}:progress", progress)


async def get_run_progress(run_id: str) -> dict | None:
    return await get_key(f"run:{run_id}:progress")


async def publish_run_event(run_id: str, payload: dict) -> None:
    """Publish a JSON event to the run's pub/sub channel. No-op if Redis absent."""
    client = await _get_client()
    if client is None:
        return
    try:
        await client.publish(f"run:{run_id}:events", orjson.dumps(payload).decode())
    except Exception as e:
        log.warning("redis_publish_failed", run_id=run_id, error=str(e))


async def subscribe_run_events(run_id: str):
    """
    Return a PubSub object subscribed to run:{run_id}:events, or None.
    Caller must unsubscribe + aclose() in a finally block.
    """
    client = await _get_client()
    if client is None:
        return None
    try:
        pubsub = client.pubsub()
        await pubsub.subscribe(f"run:{run_id}:events")
        return pubsub
    except Exception as e:
        log.warning("redis_subscribe_failed", run_id=run_id, error=str(e))
        return None
