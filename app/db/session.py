from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.ext.declarative import declarative_base
import os

from app.core.config import settings

# Определяем, использовать ли SQLite для локальной разработки
USE_SQLITE = os.getenv("USE_SQLITE", "True").lower() in ("true", "1", "t")

if settings.USE_SQLITE_MEMORY:
    # SQLite в памяти для быстрого тестирования
    SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
    )
elif USE_SQLITE:
    # SQLite для локальной разработки
    SQLALCHEMY_DATABASE_URL = "sqlite:///./app.db"
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False}
    )
else:
    # PostgreSQL для продакшена
    engine = create_engine(settings.get_database_uri)

# Фабрика сессий
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Функция-провайдер для получения сессии БД
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close() 