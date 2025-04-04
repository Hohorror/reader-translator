from fastapi import FastAPI, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel
from typing import Optional
import uvicorn

# Создаем приложение
app = FastAPI(title="Demo Auth App")

# Простая in-memory база данных
fake_users_db = {
    "johndoe": {
        "username": "johndoe",
        "full_name": "John Doe",
        "email": "johndoe@example.com",
        "hashed_password": "fakehashedsecret",
        "disabled": False,
    },
    "alice": {
        "username": "alice",
        "full_name": "Alice Wonderland",
        "email": "alice@example.com",
        "hashed_password": "fakehashedsecret2",
        "disabled": True,
    },
}

# Функции для работы с паролями
def fake_hash_password(password: str):
    return "fakehashed" + password

def fake_decode_token(token: str):
    # Это не безопасно для реального приложения!
    user = fake_users_db.get(token)
    return user

# Схемы данных
class User(BaseModel):
    username: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    disabled: Optional[bool] = None

class UserInDB(User):
    hashed_password: str

class Token(BaseModel):
    access_token: str
    token_type: str

# OAuth2 схема
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# Получение текущего пользователя
async def get_current_user(token: str = Depends(oauth2_scheme)):
    user = fake_decode_token(token)
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user

async def get_current_active_user(current_user: UserInDB = Depends(get_current_user)):
    if current_user.get("disabled"):
        raise HTTPException(status_code=400, detail="Inactive user")
    return current_user

# Маршруты
@app.post("/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    user_dict = fake_users_db.get(form_data.username)
    if not user_dict:
        raise HTTPException(status_code=400, detail="Incorrect username or password")
    
    # В реальном проекте здесь должна быть проверка хеша пароля
    hashed_password = fake_hash_password(form_data.password)
    if not hashed_password == user_dict["hashed_password"]:
        raise HTTPException(status_code=400, detail="Incorrect username or password")

    # В реальном проекте здесь должна быть генерация JWT
    return {"access_token": user_dict["username"], "token_type": "bearer"}

@app.get("/users/me", response_model=User)
async def read_users_me(current_user: UserInDB = Depends(get_current_active_user)):
    return current_user

@app.get("/")
async def read_root():
    return {"message": "Hello World"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True) 