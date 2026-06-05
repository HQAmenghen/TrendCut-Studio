from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from .settings import get_settings


class Base(DeclarativeBase):
    pass


def create_db_engine():
    settings = get_settings()
    return create_engine(settings.database_url, pool_pre_ping=True, connect_args={'connect_timeout': 2})


engine = create_db_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def check_database() -> None:
    with engine.connect() as connection:
        connection.execute(text('select 1'))
