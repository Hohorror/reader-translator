import logging
from sqlalchemy.orm import Session

from app.db.base import Base
from app.db.session import engine


# Создание всех таблиц в базе данных
def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    logging.info("Database tables created") 