# Import all the models, so that SQLAlchemy knows about them
from app.db.base_class import Base  # noqa
try:
    from app.models.user import User  # noqa
except ImportError:
    pass 