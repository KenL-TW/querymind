from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def run(cmd: list[str], *, cwd: Path = ROOT, env: dict[str, str] | None = None) -> None:
    print(f"==> {' '.join(cmd)}")
    subprocess.run(cmd, cwd=str(cwd), env=env, check=True)


def python_exe() -> str:
    return sys.executable


def cmd_dev_db_up(_: argparse.Namespace) -> None:
    run(["docker", "compose", "-f", "infra/dev/docker-compose.dev.yml", "up", "-d"])


def cmd_dev_db_down(_: argparse.Namespace) -> None:
    run(["docker", "compose", "-f", "infra/dev/docker-compose.dev.yml", "down"])


def cmd_dev_init(_: argparse.Namespace) -> None:
    run([python_exe(), "infra/scripts/init_meta_db.py"])
    run([python_exe(), "infra/scripts/seed_metadata.py"])
    run([python_exe(), "seed_full_schema.py"])
    run([python_exe(), "scripts/seed_recent_sales.py"])


def cmd_check(args: argparse.Namespace) -> None:
    if not args.skip_python:
        run([python_exe(), "-m", "compileall", "api", "config", "core", "tools", "adapters", "ui", "scripts"])
    if not args.skip_frontend:
        npm = "npm.cmd" if os.name == "nt" else "npm"
        run([npm, "run", "typecheck"], cwd=ROOT / "frontend")


def cmd_aws_preflight(args: argparse.Namespace) -> None:
    cmd = [python_exe(), "scripts/aws_demo_preflight.py", "--env-file", args.env_file]
    if args.allow_placeholders:
        cmd.append("--allow-placeholders")
    if args.skip_compose:
        cmd.append("--skip-compose")
    if args.skip_build_checks:
        cmd.append("--skip-build-checks")
    run(cmd)


def cmd_aws_make_env(args: argparse.Namespace) -> None:
    cmd = [
        python_exe(),
        "scripts/aws_demo_make_env.py",
        "--public-host",
        args.public_host,
        "--output",
        args.output,
    ]
    if args.openai_api_key:
        cmd.extend(["--openai-api-key", args.openai_api_key])
    if args.openai_api_key_file:
        cmd.extend(["--openai-api-key-file", args.openai_api_key_file])
    if args.force:
        cmd.append("--force")
    if args.owner_email:
        cmd.extend(["--owner-email", args.owner_email])
    if args.openai_model:
        cmd.extend(["--openai-model", args.openai_model])
    run(cmd)


def cmd_aws_smoke(args: argparse.Namespace) -> None:
    cmd = [python_exe(), "scripts/aws_demo_smoke_test.py", "--base-url", args.base_url]
    if args.email:
        cmd.extend(["--email", args.email])
    if args.password:
        cmd.extend(["--password", args.password])
    if args.include_chat:
        cmd.append("--include-chat")
    run(cmd)


def cmd_aws_compose(args: argparse.Namespace) -> None:
    env = os.environ.copy()
    env["QUERYMIND_ENV_FILE"] = args.env_file
    run(
        ["docker", "compose", "--env-file", args.env_file, "-f", "docker-compose.aws-demo.yml", *args.compose_args],
        cwd=ROOT / "infra" / "aws-demo",
        env=env,
    )


def cmd_aws_backup(_: argparse.Namespace) -> None:
    run(["bash", "backup.sh"], cwd=ROOT / "infra" / "aws-demo")


def cmd_aws_restore(args: argparse.Namespace) -> None:
    cmd = ["bash", "restore.sh", "--backup-dir", args.backup_dir]
    if args.yes:
        cmd.append("--yes")
    run(cmd, cwd=ROOT / "infra" / "aws-demo")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="QueryMind repo task runner.")
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("dev-db-up", help="Start local development PostgreSQL.")
    p.set_defaults(func=cmd_dev_db_up)

    p = sub.add_parser("dev-db-down", help="Stop local development PostgreSQL.")
    p.set_defaults(func=cmd_dev_db_down)

    p = sub.add_parser("dev-init", help="Initialize local metadata and demo schema.")
    p.set_defaults(func=cmd_dev_init)

    p = sub.add_parser("check", help="Run Python compileall and frontend typecheck.")
    p.add_argument("--skip-python", action="store_true")
    p.add_argument("--skip-frontend", action="store_true")
    p.set_defaults(func=cmd_check)

    p = sub.add_parser("aws-preflight", help="Run AWS demo preflight checks.")
    p.add_argument("--env-file", default="infra/aws-demo/.env.aws-demo")
    p.add_argument("--allow-placeholders", action="store_true")
    p.add_argument("--skip-compose", action="store_true")
    p.add_argument("--skip-build-checks", action="store_true")
    p.set_defaults(func=cmd_aws_preflight)

    p = sub.add_parser("aws-make-env", help="Create infra/aws-demo/.env.aws-demo with generated secrets.")
    p.add_argument("--public-host", required=True)
    p.add_argument("--openai-api-key", default="")
    p.add_argument("--openai-api-key-file", default="")
    p.add_argument("--output", default="infra/aws-demo/.env.aws-demo")
    p.add_argument("--force", action="store_true")
    p.add_argument("--owner-email", default="")
    p.add_argument("--openai-model", default="")
    p.set_defaults(func=cmd_aws_make_env)

    p = sub.add_parser("aws-smoke", help="Run AWS demo smoke test against a public URL.")
    p.add_argument("--base-url", required=True)
    p.add_argument("--email", default="")
    p.add_argument("--password", default="")
    p.add_argument("--include-chat", action="store_true")
    p.set_defaults(func=cmd_aws_smoke)

    p = sub.add_parser("aws-compose", help="Run docker compose for the AWS demo stack.")
    p.add_argument("--env-file", default=".env.aws-demo")
    p.add_argument("compose_args", nargs=argparse.REMAINDER, help="Arguments after '--', e.g. -- ps")
    p.set_defaults(func=cmd_aws_compose)

    p = sub.add_parser("aws-backup", help="Create an AWS demo backup on the EC2 host.")
    p.set_defaults(func=cmd_aws_backup)

    p = sub.add_parser("aws-restore", help="Restore an AWS demo backup on the EC2 host.")
    p.add_argument("--backup-dir", required=True)
    p.add_argument("--yes", action="store_true")
    p.set_defaults(func=cmd_aws_restore)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
