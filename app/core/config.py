from pydantic import PostgresDsn, SecretStr
from pydantic_settings import BaseSettings
import os
from typing import Optional


class Settings(BaseSettings):
    API_V1_STR: str = "/api/v1"
    PROJECT_NAME: str = "User Authentication"
    
    # Секретный ключ для подписи JWT
    SECRET_KEY: str = os.getenv("SECRET_KEY", "supersecretkey")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", 30))
    JWT_ALGORITHM: str = "HS256"
    
    # Флаг для использования in-memory SQLite для тестирования
    USE_SQLITE_MEMORY: bool = os.getenv("USE_SQLITE_MEMORY", "False").lower() in ("true", "1", "t")
    
    # Настройки базы данных
    POSTGRES_SERVER: str = os.getenv("POSTGRES_SERVER", "localhost")
    POSTGRES_USER: str = os.getenv("POSTGRES_USER", "postgres")
    POSTGRES_PASSWORD: str = os.getenv("POSTGRES_PASSWORD", "postgres")
    POSTGRES_DB: str = os.getenv("POSTGRES_DB", "auth_app")
    POSTGRES_PORT: str = os.getenv("POSTGRES_PORT", "5432")
    
    # Формирование строки подключения к БД
    DATABASE_URI: Optional[str] = None
    
    @property
    def get_database_uri(self) -> str:
        if self.USE_SQLITE_MEMORY:
            return "sqlite:///:memory:"
            
        if self.DATABASE_URI:
            return self.DATABASE_URI
            
        return f"postgresql://{self.POSTGRES_USER}:{self.POSTGRES_PASSWORD}@{self.POSTGRES_SERVER}:{self.POSTGRES_PORT}/{self.POSTGRES_DB}"
    
    # Настройки CORS
    BACKEND_CORS_ORIGINS: list = ["*"]
    
    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings() 