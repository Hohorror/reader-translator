from typing import Optional
from datetime import timedelta

from sqlalchemy.orm import Session
from fastapi import Depends, HTTPException, status

from app.core.config import settings
from app.core.security import create_access_token
from app.db.session import get_db
from app.models.user import User
from app.repositories.user import user_repository
from app.schemas.token import Token
from app.schemas.user import UserCreate, User as UserSchema


class UserService:
    def register_user(self, db: Session, user_in: UserCreate) -> UserSchema:
        # Проверка существует ли пользователь
        user = user_repository.get_by_username(db, username=user_in.username)
        if user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already registered",
            )
        
        # Проверка email если указан
        if user_in.email:
            user = user_repository.get_by_email(db, email=user_in.email)
            if user:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Email already registered",
                )
        
        # Создание пользователя
        user = user_repository.create(db, obj_in=user_in)
        return user
    
    def authenticate_user(
        self, db: Session, username: str, password: str
    ) -> Optional[User]:
        user = user_repository.authenticate(db, username=username, password=password)
        return user
    
    def create_access_token_for_user(self, user: User) -> Token:
        access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        access_token = create_access_token(
            subject=user.id, expires_delta=access_token_expires
        )
        return Token(access_token=access_token, token_type="bearer")
    
    def get_current_user(self, db: Session, user_id: int) -> Optional[User]:
        user = user_repository.get(db, id=user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        if not user_repository.is_active(user):
            raise HTTPException(status_code=400, detail="Inactive user")
        return user


user_service = UserService() 