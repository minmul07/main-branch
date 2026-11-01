import os
from pathlib import Path
import subprocess
import sys

from pytest import mark, raises

from backend.app import config


def run_config(env_overrides: dict[str, str]) -> list[str]:
    """import 시 환경변수를 읽으므로 별도 프로세스에서 설정값을 확인한다."""
    env = os.environ.copy()
    for name in ("UPLOAD_DIR", "MAX_UPLOAD_SIZE_BYTES", "CORS_ALLOWED_ORIGINS"):
        env.pop(name, None)
    env.update(env_overrides)
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            "from backend.app import config; "
            "print(config.UPLOAD_DIR); print(config.MAX_UPLOAD_SIZE_BYTES); "
            "print(','.join(config.CORS_ALLOWED_ORIGINS))",
        ],
        cwd=Path(__file__).resolve().parents[2],
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )
    return result.stdout.splitlines()


@mark.parametrize("configured", [None, ""])
def test_config_defaults(configured: str | None) -> None:
    overrides = {}
    if configured is not None:
        overrides = {
            "UPLOAD_DIR": configured,
            "MAX_UPLOAD_SIZE_BYTES": configured,
            "CORS_ALLOWED_ORIGINS": configured,
        }

    upload_dir, max_size, origins = run_config(overrides)

    assert upload_dir == str(Path(config.__file__).resolve().parent.parent / "uploads")
    assert int(max_size) == 52_428_800
    assert origins == "http://127.0.0.1:5173,http://localhost:5173"


def test_config_custom_values(tmp_path: Path) -> None:
    upload_dir, max_size, origins = run_config(
        {
            "UPLOAD_DIR": str(tmp_path / "uploads"),
            "MAX_UPLOAD_SIZE_BYTES": "1024",
            "CORS_ALLOWED_ORIGINS": " http://127.0.0.1:3000 , http://localhost:3000,",
        }
    )

    assert upload_dir == str(tmp_path / "uploads")
    assert int(max_size) == 1024
    assert origins == "http://127.0.0.1:3000,http://localhost:3000"


@mark.parametrize("value", ["0", "-1", "abc", "1.5"])
def test_invalid_max_upload_size(value: str) -> None:
    with raises(ValueError):
        config.parse_max_upload_size(value)
