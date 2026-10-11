#!/usr/bin/env bash
# Publish docs/ to the gh-pages branch under /Colliersdemo/, with a redirect
# at the site root. GitHub Pages serves gh-pages automatically.
set -euo pipefail
SITE_DIR="Colliersdemo"
ROOT="$(git rev-parse --show-toplevel)"
WORK="$(mktemp -d)"
trap 'git -C "$ROOT" worktree remove --force "$WORK" >/dev/null 2>&1 || true' EXIT

git -C "$ROOT" fetch -q origin gh-pages || true
if git -C "$ROOT" show-ref -q --verify refs/remotes/origin/gh-pages; then
  git -C "$ROOT" worktree add -q -B gh-pages "$WORK" origin/gh-pages
else
  git -C "$ROOT" worktree add -q --orphan -b gh-pages "$WORK"
fi

find "$WORK" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
mkdir -p "$WORK/$SITE_DIR"
cp -R "$ROOT/docs/." "$WORK/$SITE_DIR/"
touch "$WORK/.nojekyll"
cat > "$WORK/index.html" <<HTML
<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="robots" content="noindex, nofollow">
<meta http-equiv="refresh" content="0; url=./$SITE_DIR/">
<link rel="canonical" href="./$SITE_DIR/">
<title>Redirecting…</title></head>
<body><p>Moved to <a href="./$SITE_DIR/">./$SITE_DIR/</a>.</p></body></html>
HTML

git -C "$WORK" add -A
if git -C "$WORK" diff --cached --quiet; then
  echo "gh-pages already up to date"
else
  git -C "$WORK" commit -q -m "Publish site from $(git -C "$ROOT" rev-parse --short HEAD)"
  git -C "$WORK" push -q -u origin gh-pages
  echo "Published to gh-pages under /$SITE_DIR/"
fi
