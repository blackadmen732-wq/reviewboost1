#!/usr/bin/env python3
"""Install the user-selected, commit-pinned design references without running them."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
LOCK = ROOT / "docs/design/reference-lock.json"


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], text=True).strip()


def main() -> None:
    skills = ROOT / ".agents/skills"
    skills.mkdir(parents=True, exist_ok=True)
    for entry in json.loads(LOCK.read_text())["references"]:
        target = ROOT / entry["destination"]
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True)
            subprocess.run(["git", "clone", "--filter=blob:none", "--no-checkout",
                            entry["url"], str(target)], check=True)
            subprocess.run(["git", "-C", str(target), "checkout", "--detach",
                            entry["commit"]], check=True)
        elif git("-C", str(target), "rev-parse", "HEAD") != entry["commit"]:
            raise SystemExit(f"Preserved existing {target}: commit differs from lock.")
        if entry["skill"]:
            link = skills / entry["name"]
            if not link.exists() and not link.is_symlink():
                link.symlink_to(target / entry["skill"], target_is_directory=True)
            elif not (link / "SKILL.md").is_file():
                raise SystemExit(f"Preserved existing {link}: inspect its installation.")
        print(f"Ready: {entry['name']} @ {entry['commit'][:12]}")
    print("Read each SKILL.md before use. No upstream hooks or executables were run.")


if __name__ == "__main__":
    main()
