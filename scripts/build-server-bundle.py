#!/usr/bin/env python3
"""Rebuild deploy/esf-server-bundle.zip from the current server/ source.

Why this exists: the old bundle shipped a 0.1.0 backend (7 SQL files, no
settle_* procedures), so a fresh deploy would silently lack ranked/challenge
settlement. This script always builds from the working tree and emits a
manifest that scripts/check-versions.cjs validates in CI.

Usage:
    python scripts/build-server-bundle.py

Outputs:
    deploy/esf-server-bundle.zip
    deploy/esf-server-bundle.manifest.json   (no BOM, UTF-8)
"""

import hashlib
import json
import zipfile
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'server'
OUT_DIR = ROOT / 'deploy'
ZIP_PATH = OUT_DIR / 'esf-server-bundle.zip'
MANIFEST_PATH = OUT_DIR / 'esf-server-bundle.manifest.json'

TOP_FILES = ['package.json', 'package-lock.json', '.env.example', 'README.md']
INCLUDE_DIRS = ['src', 'sql']
SCRIPT_EXCLUDE = {'acceptance-sim.cjs'}  # local-only acceptance harness
SENSITIVE_KEY_PARTS = ('PASSWORD', 'SECRET', 'TOKEN', '_KEY', 'CREDENTIAL')
NON_SECRET_MARKERS = ('TTL', 'SECONDS', 'MINUTES', 'MAX', 'HOST', 'PORT', 'USER', 'URL', 'DIR', 'SIZE')


def check_env_template(path):
    """Never ship a template with real-looking secret values; only CHANGE_ME / empty."""
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        upper = key.upper()
        if not any(part in upper for part in SENSITIVE_KEY_PARTS):
            continue
        if any(marker in upper for marker in NON_SECRET_MARKERS):
            continue
        if value and not value.startswith('CHANGE_ME'):
            raise SystemExit(f'refusing to bundle {path.name}: {key} has a non-placeholder value')


def collect():
    files = []
    for name in TOP_FILES:
        p = SRC / name
        if p.exists():
            files.append((p, name))
    for d in INCLUDE_DIRS:
        base = SRC / d
        if not base.is_dir():
            continue
        for p in sorted(base.rglob('*')):
            if not p.is_file():
                continue
            if p.suffix not in ('.js', '.cjs', '.sql', '.json'):
                continue
            files.append((p, str(p.relative_to(SRC)).replace('\\', '/')))
    scripts = SRC / 'scripts'
    for p in sorted(scripts.iterdir()):
        if p.is_file() and p.suffix in ('.js', '.cjs') and p.name not in SCRIPT_EXCLUDE:
            files.append((p, 'scripts/' + p.name))
    return files


def main():
    files = collect()
    if not files:
        raise SystemExit('no source files found')

    migrate = (SRC / 'scripts' / 'migrate.js').read_text(encoding='utf-8')
    has_procedures = 'settle_ranked_match' in migrate and 'settle_challenge_match' in migrate
    sql_count = len(list((SRC / 'sql').glob('*.sql')))
    route_count = len(list((SRC / 'src' / 'routes').glob('*.js')))
    env_text = (SRC / '.env.example').read_text(encoding='utf-8')
    env_vars = sum(1 for line in env_text.splitlines()
                   if line and not line.startswith('#') and '=' in line)

    # never ship real credentials
    for p, arc in files:
        if p.name == '.env':
            raise SystemExit('refusing to bundle server/.env')
    check_env_template(SRC / '.env.example')

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(ZIP_PATH, 'w', zipfile.ZIP_DEFLATED) as z:
        for p, arc in files:
            z.write(p, arc)

    digest = hashlib.sha256(ZIP_PATH.read_bytes()).hexdigest()
    launcher_version = json.loads((ROOT / 'esf-launcher' / 'package.json').read_text(encoding='utf-8'))['version']
    server_version = json.loads((SRC / 'package.json').read_text(encoding='utf-8'))['version']

    manifest = {
        'launcherVersion': launcher_version,
        'serverVersion': server_version,
        'sha256': digest,
        'size': ZIP_PATH.stat().st_size,
        'fileCount': len(files),
        'sqlCount': sql_count,
        'routeCount': route_count,
        'envTemplateVars': env_vars,
        'hasSettlementProcedures': has_procedures,
        'builtAt': datetime.now().astimezone().isoformat(timespec='seconds'),
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')

    print(f'zip      : {ZIP_PATH} ({manifest["size"]} bytes, {len(files)} files)')
    print(f'sha256   : {digest}')
    print(f'manifest : {MANIFEST_PATH}')
    print(f'sql={sql_count} routes={route_count} envVars={env_vars} settlement={has_procedures}')
    print(f'launcherVersion={launcher_version} serverVersion={server_version}')

    if not has_procedures or sql_count < 16 or route_count < 19:
        raise SystemExit('bundle looks stale: expected 16+ SQL, 19+ routes and both settle procedures')


if __name__ == '__main__':
    main()
