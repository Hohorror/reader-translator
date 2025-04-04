from fastapi import APIRouter, Depends
from app.auth import get_current_user
from app.models import User

router = APIRouter()

@router.get("/users/me", response_model=User)
async def read_users_me(current_user = Depends(get_current_user)):
    return {"username": current_user["username"]} 