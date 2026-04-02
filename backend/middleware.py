"""Authentication middleware for FastAPI."""

import os
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from .auth import verify_jwt

# Routes that don't require authentication
PUBLIC_ROUTES = {
    ("POST", "/api/auth/login"),
    ("GET", "/"),
}

# Route prefixes that require admin role
ADMIN_PREFIXES = [
    "/api/admin/",
]


def _is_auth_enabled() -> bool:
    """Auth is enabled when COUNCIL_JWT_SECRET is set."""
    return bool(os.getenv("COUNCIL_JWT_SECRET"))


class AuthMiddleware(BaseHTTPMiddleware):
    """
    Middleware that enforces JWT authentication on API routes.

    - Skips auth for public routes (login, health check)
    - Extracts Bearer token from Authorization header
    - Verifies JWT and attaches user info to request.state.user
    - Returns 401 if token missing/invalid
    - Returns 403 if endpoint requires admin and user.role != 'admin'
    """

    async def dispatch(self, request: Request, call_next):
        # If auth is not configured, skip entirely (local dev mode)
        if not _is_auth_enabled():
            request.state.user = None
            return await call_next(request)

        method = request.method
        path = request.url.path

        # Allow public routes through
        if (method, path) in PUBLIC_ROUTES:
            request.state.user = None
            return await call_next(request)

        # Allow OPTIONS (CORS preflight) through
        if method == "OPTIONS":
            return await call_next(request)

        # Extract Bearer token
        auth_header = request.headers.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            return JSONResponse(
                status_code=401,
                content={"detail": "Missing or invalid authorization header"},
            )

        token = auth_header[7:]  # Strip "Bearer "
        payload = verify_jwt(token)
        if payload is None:
            return JSONResponse(
                status_code=401,
                content={"detail": "Invalid or expired token"},
            )

        # Attach user info to request state
        request.state.user = payload

        # Check admin requirement
        for prefix in ADMIN_PREFIXES:
            if path.startswith(prefix):
                if payload.get("role") != "admin":
                    return JSONResponse(
                        status_code=403,
                        content={"detail": "Admin access required"},
                    )
                break

        return await call_next(request)
