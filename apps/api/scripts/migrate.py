from pathlib import Path
from alembic import command
from alembic.config import Config


def main() -> None:
    root = Path(__file__).resolve().parents[3]
    config = Config(str(root / 'apps' / 'api' / 'alembic.ini'))
    command.upgrade(config, 'head')


if __name__ == '__main__':
    main()
