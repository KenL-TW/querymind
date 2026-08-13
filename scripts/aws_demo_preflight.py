from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AWS_DEMO_DIR = ROOT / "infra" / "aws-demo"
FRONTEND_DIR = ROOT / "frontend"


REQUIRED_ENV_KEYS = (
    "PUBLIC_HOST",
    "JWT_SECRET",
    "DEFAULT_OWNER_API_KEY",
    "OPENAI_API_KEY",
    "POSTGRES_PASSWORD",
)

PLACEHOLDER_MARKERS = (
    "replace-",
    "sk-your-",
    "your-",
    "localhost",
)


def run(cmd: list[str], *, cwd: Path = ROOT, env: dict[str, str] | None = None) -> None:
    print(f"==> {' '.join(cmd)}")
    subprocess.run(cmd, cwd=str(cwd), env=env, check=True)


def resolve_executable(name: str) -> str:
    found = shutil.which(name)
    if found:
        return found
    if os.name == "nt" and not name.lower().endswith(".cmd"):
        found = shutil.which(f"{name}.cmd")
        if found:
            return found
    return name


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def check_env(path: Path, *, allow_placeholders: bool) -> None:
    if not path.exists():
        raise SystemExit(f"Missing env file: {path}")

    values = parse_env(path)
    missing = [key for key in REQUIRED_ENV_KEYS if not values.get(key)]
    if missing:
        raise SystemExit(f"Missing required env value(s): {', '.join(missing)}")

    if allow_placeholders:
        return

    placeholder_keys: list[str] = []
    for key in REQUIRED_ENV_KEYS:
        value = values.get(key, "").strip().lower()
        if any(marker in value for marker in PLACEHOLDER_MARKERS):
            placeholder_keys.append(key)
    if placeholder_keys:
        raise SystemExit(
            "Replace placeholder env value(s) before deploying: "
            + ", ".join(placeholder_keys)
        )

    if values.get("NUXT_PUBLIC_API_BASE", ""):
        print("NOTE: NUXT_PUBLIC_API_BASE is set. Default same-origin AWS demo usually leaves it empty.")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run QueryMind AWS demo preflight checks.")
    parser.add_argument(
        "--env-file",
        default=str(AWS_DEMO_DIR / ".env.aws-demo"),
        help="Path to the AWS demo env file.",
    )
    parser.add_argument(
        "--allow-placeholders",
        action="store_true",
        help="Allow placeholder env values. Useful for validating .env.aws-demo.example in CI/local checks.",
    )
    parser.add_argument(
        "--skip-build-checks",
        action="store_true",
        help="Only check env and Docker Compose config.",
    )
    parser.add_argument(
        "--skip-compose",
        action="store_true",
        help="Skip Docker Compose config validation. Use only in restricted local environments.",
    )
    args = parser.parse_args()

    env_file = Path(args.env_file)
    if not env_file.is_absolute():
        env_file = (ROOT / env_file).resolve()

    check_env(env_file, allow_placeholders=args.allow_placeholders)

    if not args.skip_compose:
        compose_env = os.environ.copy()
        compose_env["QUERYMIND_ENV_FILE"] = str(env_file)
        run(
            [
                "docker",
                "compose",
                "--env-file",
                str(env_file),
                "-f",
                "docker-compose.aws-demo.yml",
                "config",
            ],
            cwd=AWS_DEMO_DIR,
            env=compose_env,
        )

    if not args.skip_build_checks:
        run([sys.executable, "-m", "compileall", "api", "config", "core", "tools", "adapters", "ui"])
        npm = resolve_executable("npm")
        run([npm, "run", "typecheck"], cwd=FRONTEND_DIR)
        run([npm, "run", "generate"], cwd=FRONTEND_DIR)

    print("AWS demo preflight passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
