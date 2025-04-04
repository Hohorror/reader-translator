from typing import Optional
from pydantic import BaseModel, EmailStr, Field
from datetime import datetime


# Базовые свойства пользователя
class UserBase(BaseModel):
    username: str
    email: Optional[EmailStr] = None
    is_active: Optional[bool] = True
    is_superuser: bool = False


# Свойства для создания пользователя
class UserCreate(UserBase):
    password: str = Field(..., min_length=6)


# Свойства для обновления пользователя
class UserUpdate(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    is_superuser: Optional[bool] = None


# Дополнительные свойства, хранящиеся в БД
class UserInDBBase(UserBase):
    id: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# Дополнительные свойства, возвращаемые из API
class User(UserInDBBase):
    pass


# Дополнительные свойства, хранящиеся в БД, не для API
class UserInDB(UserInDBBase):
    hashed_password: str 