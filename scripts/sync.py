#!/usr/bin/env python3
"""
ATLAS — The Open Source Universe
Google Sheets -> Static JSON + Open Graph Stubs Sync Pipeline.

Reads all rows from sheet "المستودعات", extracts underlying HYPERLINK URLs,
preserves original added dates (leaving empty dates as null without fabricating),
and maintains deterministic incremental 3D coordinates in public/data/positions.json.
"""

import argparse
import hashlib
import html
import json
import math
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse

DEFAULT_SHEET_ID = "1iXCenfm8tuLPaxchUxb8G3VFixLXqOJFh1zKpcAoeeY"
SHEET_NAME = "المستودعات"
DATA_DIR = Path("public/data")
OG_DIR = Path("public/r")

DOMAIN_MAPPING: Dict[str, str] = {
    "AI Agents": "Intelligence",
    "AI Memory": "Intelligence",
    "AI Decision Models": "Intelligence",
    "AI Evaluation": "Intelligence",
    "Browser Agents": "Intelligence",
    "Agent Infrastructure": "Infrastructure",
    "MCP": "Infrastructure",
    "MCP Infrastructure": "Infrastructure",
    "LLM Infrastructure": "Infrastructure",
    "Data Infrastructure": "Infrastructure",
    "Cloud Infrastructure": "Infrastructure",
    "Cloud AI": "Infrastructure",
    "Search Infrastructure": "Infrastructure",
    "Local AI": "Infrastructure",
    "Developer Tools": "Engineering",
    "Automation": "Engineering",
    "CAD AI": "Engineering",
    "Data & Office AI": "Engineering",
    "Document AI": "Engineering",
    "Mobile AI": "Engineering",
    "Voice AI": "Perception",
    "Audio AI": "Perception",
    "Image AI": "Creative Systems",
    "Video AI": "Creative Systems",
    "Design AI": "Creative Systems",
    "Cybersecurity": "Security",
    "AI Security": "Security",
    "MCP Security": "Security",
    "Research AI": "Frontier Research",
    "Robotics": "Frontier Research",
    "AI Hardware": "Frontier Research",
}

DOMAIN_CENTERS: Dict[str, Tuple[float, float, float]] = {
    "Intelligence": (28.0, 12.0, 18.0),
    "Infrastructure": (-28.0, 14.0, 16.0),
    "Engineering": (0.0, -28.0, 22.0),
    "Perception": (32.0, -14.0, -18.0),
    "Creative Systems": (-32.0, -16.0, -16.0),
    "Security": (16.0, 28.0, -24.0),
    "Frontier Research": (-18.0, 26.0, -26.0),
}


def sanitize_text(value: Optional[str]) -> str:
    if not value:
        return ""
    cleaned = str(value).strip()
    cleaned = re.sub(r"<[^>]*>", "", cleaned)
    return cleaned


def normalize_github_url(raw_url: str) -> Optional[str]:
    url = raw_url.strip().rstrip("/")
    if url.endswith(".git"):
        url = url[:-4]
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    if "github.com" in parsed.netloc.lower():
        parts = [p for p in parsed.path.split("/") if p]
        if len(parts) >= 2:
            return f"https://github.com/{parts[0]}/{parts[1]}"
    return url


def extract_github_url(cell_data: Dict[str, Any]) -> Optional[str]:
    if not cell_data:
        return None
    if cell_data.get("hyperlink"):
        return normalize_github_url(cell_data["hyperlink"])
    formula = cell_data.get("userEnteredValue", {}).get("formulaValue", "")
    if formula:
        match = re.search(r'HYPERLINK\s*\(\s*"([^"]+)"', formula, re.IGNORECASE)
        if match:
            return normalize_github_url(match.group(1))
    formatted = cell_data.get("formattedValue", "")
    if formatted and formatted.startswith(("http://", "https://")):
        return normalize_github_url(formatted)
    return None


def make_stable_id(name: str, github_url: Optional[str]) -> str:
    if github_url and "github.com/" in github_url:
        slug = github_url.split("github.com/")[-1].lower().replace("/", "__")
        return re.sub(r"[^a-z0-9_\-]", "", slug)
    digest = hashlib.sha1(name.strip().lower().encode("utf-8")).hexdigest()[:8]
    safe_name = re.sub(r"[^a-z0-9]", "", name.lower()) or "repo"
    return f"{safe_name}_{digest}"


def deterministic_3d_offset(
    seed_key: str, index: int, total: int, radius: float
) -> Tuple[float, float, float]:
    h = int(hashlib.sha256(seed_key.encode("utf-8")).hexdigest()[:8], 16)
    golden_angle = math.pi * (3.0 - math.sqrt(5.0))
    y = 1.0 - (index / float(max(total - 1, 1))) * 2.0
    r = math.sqrt(max(0.0, 1.0 - y * y))
    theta = golden_angle * index + ((h % 360) * 0.01745)
    return (
        round(math.cos(theta) * r * radius, 3),
        round(y * radius, 3),
        round(math.sin(theta) * r * radius, 3),
    )


def update_incremental_positions(
    repositories: List[Dict[str, Any]], existing_pos: Dict[str, Any]
) -> Dict[str, Any]:
    positions: Dict[str, Any] = {
        "domains": {k: list(v) for k, v in DOMAIN_CENTERS.items()},
        "categories": existing_pos.get("categories", {}),
        "repositories": existing_pos.get("repositories", {}),
    }

    domain_cats: Dict[str, List[str]] = {}
    for repo in repositories:
        domain_cats.setdefault(repo["domain"], [])
        if repo["category"] not in domain_cats[repo["domain"]]:
            domain_cats[repo["domain"]].append(repo["category"])

    for dom, cats in domain_cats.items():
        dx, dy, dz = DOMAIN_CENTERS.get(dom, (0.0, 0.0, 0.0))
        for idx, cat in enumerate(sorted(cats)):
            if cat not in positions["categories"]:
                ox, oy, oz = deterministic_3d_offset(cat, idx, len(cats), radius=11.5)
                positions["categories"][cat] = {
                    "domain": dom,
                    "x": round(dx + ox, 3),
                    "y": round(dy + oy, 3),
                    "z": round(dz + oz, 3),
                }

    cat_repos: Dict[str, List[Dict[str, Any]]] = {}
    for repo in repositories:
        cat_repos.setdefault(repo["category"], []).append(repo)

    for cat, repos in cat_repos.items():
        cpos = positions["categories"][cat]
        for idx, repo in enumerate(repos):
            rid = repo["id"]
            prev = positions["repositories"].get(rid)
            if prev and prev.get("category") == cat:
                continue
            ox, oy, oz = deterministic_3d_offset(rid, idx, len(repos), radius=7.5)
            positions["repositories"][rid] = {
                "category": cat,
                "x": round(cpos["x"] + ox, 3),
                "y": round(cpos["y"] + oy, 3),
                "z": round(cpos["z"] + oz, 3),
            }

    return positions


def generate_static_og_pages(repositories: List[Dict[str, Any]], base_url: str) -> None:
    OG_DIR.mkdir(parents=True, exist_ok=True)
    for repo in repositories:
        rid = repo["id"]
        repo_dir = OG_DIR / rid
        repo_dir.mkdir(parents=True, exist_ok=True)
        title = html.escape(f"{repo['name']} — {repo['category']} | ATLAS Universe")
        desc = html.escape(repo["whatItDoes"] or repo["howItHelps"])
        target_hash_url = f"{base_url}/#repo={rid}"
        og_html = f"""<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>{title}</title>
  <meta name="description" content="{desc}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="{title}" />
  <meta property="og:description" content="{desc}" />
  <meta property="og:url" content="{base_url}/r/{rid}/" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{title}" />
  <meta name="twitter:description" content="{desc}" />
  <meta http-equiv="refresh" content="0;url={target_hash_url}" />
  <script>window.location.replace("{target_hash_url}");</script>
</head>
<body style="background:#050608;color:#F6F5F1;font-family:sans-serif;text-align:center;padding:4rem;">
  <p>جاري الانتقال إلى نجمة <strong>{html.escape(repo['name'])}</strong> داخل عالم ATLAS...</p>
</body>
</html>"""
        (repo_dir / "index.html").write_text(og_html, encoding="utf-8")


def fetch_from_google_sheets(sheet_id: str) -> List[Dict[str, Any]]:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build

    creds_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
    if not creds_json:
        raise RuntimeError(
            "GOOGLE_SERVICE_ACCOUNT_JSON is not set. Configure a read-only Service Account JSON in GitHub Secrets."
        )

    creds_info = json.loads(creds_json)
    creds = service_account.Credentials.from_service_account_info(
        creds_info, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
    )
    service = build("sheets", "v4", credentials=creds, cache_discovery=False)
    response = (
        service.spreadsheets()
        .get(
            spreadsheetId=sheet_id,
            ranges=[f"{SHEET_NAME}!A1:I2000"],
            includeGridData=True,
        )
        .execute()
    )

    sheets = response.get("sheets", [])
    if not sheets:
        raise RuntimeError("No sheets returned from Google Sheets API.")

    row_data = sheets[0].get("data", [{}])[0].get("rowData", [])
    repositories: List[Dict[str, Any]] = []
    seen_ids = set()

    for row_idx, row in enumerate(row_data[1:], start=2):
        values = row.get("values", [])
        if len(values) < 2:
            continue

        def cell_str(col_idx: int) -> str:
            if col_idx >= len(values):
                return ""
            return sanitize_text(values[col_idx].get("formattedValue", ""))

        category = cell_str(0)
        name = cell_str(1)
        if not category or not name:
            continue

        github_url = extract_github_url(values[7] if len(values) > 7 else {})
        raw_date = cell_str(8)
        added_at = raw_date if re.match(r"^\d{4}-\d{2}-\d{2}$", raw_date) else None

        repo_id = make_stable_id(name, github_url)
        if repo_id in seen_ids:
            continue
        seen_ids.add(repo_id)

        repositories.append(
            {
                "id": repo_id,
                "name": name,
                "category": category,
                "domain": DOMAIN_MAPPING.get(category, "Frontier Research"),
                "whatItDoes": cell_str(2),
                "howItHelps": cell_str(3),
                "whyUnique": cell_str(4),
                "useCase": cell_str(5),
                "targetAudience": cell_str(6),
                "githubUrl": github_url,
                "addedAt": added_at,
                "sheetRow": row_idx,
            }
        )

    return repositories


def main() -> int:
    parser = argparse.ArgumentParser(description="ATLAS Google Sheets Sync")
    parser.add_argument(
        "--use-local-fallback",
        action="store_true",
        help="Validate and refresh positions/OG pages from existing public/data/repositories.json without calling Google API.",
    )
    args = parser.parse_args()

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    repos_path = DATA_DIR / "repositories.json"
    pos_path = DATA_DIR / "positions.json"
    meta_path = DATA_DIR / "metadata.json"

    if args.use_local_fallback:
        if not repos_path.exists():
            print("[ERROR] Local repositories.json not found.", file=sys.stderr)
            return 1
        repos = json.loads(repos_path.read_text(encoding="utf-8"))
        data_mode = "snapshot_seed"
    else:
        sheet_id = os.getenv("ATLAS_SHEET_ID", DEFAULT_SHEET_ID)
        repos = fetch_from_google_sheets(sheet_id)
        if len(repos) < 10:
            print(
                f"[ERROR] Sync returned only {len(repos)} rows. Preserving existing good dataset.",
                file=sys.stderr,
            )
            return 1
        data_mode = "live_sync"

    existing_pos = (
        json.loads(pos_path.read_text(encoding="utf-8")) if pos_path.exists() else {}
    )
    updated_pos = update_incremental_positions(repos, existing_pos)

    categories = sorted({r["category"] for r in repos})
    metadata = {
        "totalRepositories": len(repos),
        "totalCategories": len(categories),
        "lastSyncedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sourceSheet": os.getenv("ATLAS_SHEET_ID", DEFAULT_SHEET_ID),
        "dataMode": data_mode,
    }

    repos_path.write_text(json.dumps(repos, ensure_ascii=False, indent=2), encoding="utf-8")
    pos_path.write_text(json.dumps(updated_pos, ensure_ascii=False, indent=2), encoding="utf-8")
    meta_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2), encoding="utf-8")
    generate_static_og_pages(repos, "https://faiisalxll-collab.github.io/atlas")

    print(f"[OK] Processed {len(repos)} repositories across {len(categories)} categories ({data_mode}).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
