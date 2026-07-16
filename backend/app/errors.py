"""Canonical error envelope shared by REST and WebSocket layers (§5.1)."""

from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse

# code -> default HTTP status for the REST surface
ERROR_STATUS: dict[str, int] = {
    "workspace_not_found": 404,
    "workspace_expired": 410,
    "not_a_member": 403,
    "tab_not_found": 404,
    "self_transfer_denied": 409,
    "sender_already_has_pending_transfer": 409,
    "transfer_not_found": 404,
    "transfer_already_claimed": 409,
    "transfer_expired": 410,
    "no_recipients_available": 409,
    "invalid_message": 400,
    "target_not_available": 409,
    "not_transfer_target": 403,
    "device_id_taken": 403,
    "rate_limited": 429,
}


class AppError(Exception):
    """Raised anywhere in the app; carries a stable machine code (§5.1)."""

    def __init__(self, code: str, message: str, correlates_to: str | None = None):
        self.code = code
        self.message = message
        self.correlates_to = correlates_to
        super().__init__(message)

    def envelope(self) -> dict:
        return {
            "error": {
                "code": self.code,
                "message": self.message,
                "correlates_to": self.correlates_to,
            }
        }

    @property
    def http_status(self) -> int:
        return ERROR_STATUS.get(self.code, 400)


async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(status_code=exc.http_status, content=exc.envelope())


async def http_exception_handler(_: Request, exc: HTTPException) -> JSONResponse:
    # Normalize FastAPI's default {"detail": ...} into our envelope shape.
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": "http_error",
                "message": str(exc.detail),
                "correlates_to": None,
            }
        },
    )
