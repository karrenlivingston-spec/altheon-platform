"""Retry helpers for transient Supabase / HTTP connection failures."""

from __future__ import annotations

import logging
import time
from typing import Callable, TypeVar

from postgrest.exceptions import APIError

logger = logging.getLogger(__name__)

T = TypeVar("T")

_MAX_ATTEMPTS = 3
_BACKOFF_SECONDS = (0.1, 0.3)

_TRANSIENT_EXCEPTION_TYPES: tuple[type[BaseException], ...] = (
    ConnectionError,
    TimeoutError,
    OSError,
)


def _httpx_transient_types() -> tuple[type[BaseException], ...]:
    try:
        import httpx
    except ImportError:
        return ()
    return (
        httpx.ConnectError,
        httpx.ConnectTimeout,
        httpx.ReadTimeout,
        httpx.WriteTimeout,
        httpx.PoolTimeout,
        httpx.NetworkError,
        httpx.RemoteProtocolError,
        httpx.ReadError,
        httpx.WriteError,
        httpx.LocalProtocolError,
        httpx.ProxyError,
    )


def is_transient_supabase_failure(exc: BaseException) -> bool:
    """Return True when a short retry may succeed (connection/socket pressure)."""
    if isinstance(exc, APIError):
        return False

    try:
        import httpx

        if isinstance(exc, httpx.HTTPStatusError):
            return exc.response.status_code in (429, 502, 503, 504)
    except ImportError:
        pass

    transient_types = _TRANSIENT_EXCEPTION_TYPES + _httpx_transient_types()
    if isinstance(exc, transient_types):
        return True

    cause = exc.__cause__
    if cause is not None and cause is not exc and isinstance(cause, BaseException):
        return is_transient_supabase_failure(cause)

    return False


def supabase_execute(fn: Callable[[], T]) -> T:
    """Run a Supabase `.execute()` call with short exponential backoff on transient errors."""
    last_exc: BaseException | None = None
    for attempt in range(_MAX_ATTEMPTS):
        try:
            return fn()
        except Exception as exc:
            last_exc = exc
            if not is_transient_supabase_failure(exc) or attempt >= _MAX_ATTEMPTS - 1:
                raise
            delay = _BACKOFF_SECONDS[min(attempt, len(_BACKOFF_SECONDS) - 1)]
            logger.warning(
                "Supabase transient failure (attempt %s/%s): %s; retrying in %.0fms",
                attempt + 1,
                _MAX_ATTEMPTS,
                exc,
                delay * 1000,
            )
            time.sleep(delay)
    assert last_exc is not None
    raise last_exc
