from collections.abc import Generator
from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from .settings import get_settings


class Base(DeclarativeBase):
    pass


def create_db_engine():
    settings = get_settings()
    connect_args = {}
    if settings.database_url.startswith('postgresql'):
        connect_args['connect_timeout'] = 2
    if settings.database_url.startswith('sqlite'):
        connect_args['check_same_thread'] = False
    return create_engine(settings.database_url, pool_pre_ping=True, connect_args=connect_args)


engine = create_db_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_session() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def check_database() -> None:
    with engine.connect() as connection:
        connection.execute(text('select 1'))
