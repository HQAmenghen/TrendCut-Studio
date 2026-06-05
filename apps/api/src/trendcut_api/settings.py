from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')

    api_env: str = 'local'
    database_url: str = 'postgresql+psycopg://trendcut:trendcut@127.0.0.1:5432/trendcut'
    redis_url: str = 'redis://127.0.0.1:6379/0'


@lru_cache
def get_settings() -> Settings:
    return Settings()
