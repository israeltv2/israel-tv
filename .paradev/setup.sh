#!/bin/sh
# Link the secrets file kept outside the repo to a gitignored .env in this workspace.
set -eu
src="$HOME/.config/israel-tv/secrets.env"
if [ -f "$src" ]; then
  ln -sfn "$src" .env
  echo "linked .env -> $src"
else
  echo "warning: $src not found; copy .env.example to it and fill the values" >&2
fi
