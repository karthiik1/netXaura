from fastapi import APIRouter

router = APIRouter()


@router.get("/health", summary="Liveness probe", tags=["system"])
async def health() -> dict:
    return {"status": "ok"}
