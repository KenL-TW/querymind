from __future__ import annotations

import argparse
import getpass
import os
import secrets
import string
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXAMPLE = ROOT / "infra" / "aws-demo" / ".env.aws-demo.example"
DEFAULT_OUTPUT = ROOT / "infra" / "aws-demo" / ".env.aws-demo"


def strong_secret(length: int = 48) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def replace_value(lines: list[str], key: str, value: str) -> list[str]:
    prefix = f"{key}="
    replaced = False
    out: list[str] = []
    for line in lines:
        if line.startswith(prefix):
            out.append(f"{key}={value}")
            replaced = True
        else:
            out.append(line)
    if not replaced:
        out.append(f"{key}={value}")
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a deploy-ready QueryMind AWS demo env file.")
    parser.add_argument("--public-host", required=True, help="EC2 public DNS name or public IP, without http://.")
    parser.add_argument("--openai-api-key", default="", help="OpenAI API key for the demo. Prefer env/file/prompt to avoid shell history.")
    parser.add_argument("--openai-api-key-file", default="", help="Read the OpenAI API key from a file.")
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT), help="Output env file.")
    parser.add_argument("--force", action="store_true", help="Overwrite output if it already exists.")
    parser.add_argument("--owner-email", default="owner@local")
    parser.add_argument("--openai-model", default="gpt-4o-mini")
    args = parser.parse_args()

    output = Path(args.output)
    if not output.is_absolute():
        output = (ROOT / output).resolve()
    if output.exists() and not args.force:
        raise SystemExit(f"Refusing to overwrite existing env file: {output}. Pass --force to replace it.")

    openai_api_key = args.openai_api_key.strip()
    if not openai_api_key and args.openai_api_key_file:
        openai_api_key = Path(args.openai_api_key_file).read_text(encoding="utf-8").strip()
    if not openai_api_key:
        openai_api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not openai_api_key:
        openai_api_key = getpass.getpass("OPENAI_API_KEY: ").strip()
    if not openai_api_key:
        raise SystemExit("OPENAI_API_KEY is required.")

    public_host = args.public_host.strip().removeprefix("http://").removeprefix("https://").strip("/")
    postgres_user = "qm_user"
    postgres_password = strong_secret(40)
    jwt_secret = strong_secret(64)
    owner_api_key = "qm_owner_" + strong_secret(40)

    lines = EXAMPLE.read_text(encoding="utf-8").splitlines()
    replacements = {
        "PUBLIC_HOST": public_host,
        "JWT_SECRET": jwt_secret,
        "DEFAULT_OWNER_EMAIL": args.owner_email,
        "DEFAULT_OWNER_API_KEY": owner_api_key,
        "OPENAI_API_KEY": openai_api_key,
        "OPENAI_MODEL": args.openai_model,
        "POSTGRES_USER": postgres_user,
        "POSTGRES_PASSWORD": postgres_password,
        "METADATA_DB_URL": f"postgresql+psycopg2://{postgres_user}:{postgres_password}@postgres:5432/querymind_meta",
        "DB_CONNECTIONS": f'{{"default":"postgresql+psycopg2://{postgres_user}:{postgres_password}@postgres:5432/querymind"}}',
        "CORS_ORIGINS": f'["http://{public_host}"]',
        "NUXT_PUBLIC_API_BASE": "",
    }
    for key, value in replacements.items():
        lines = replace_value(lines, key, value)

    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(f"Wrote {output}")
    print(f"PUBLIC_HOST={public_host}")
    print(f"DEFAULT_OWNER_EMAIL={args.owner_email}")
    print("Generated JWT_SECRET, DEFAULT_OWNER_API_KEY, and POSTGRES_PASSWORD.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
