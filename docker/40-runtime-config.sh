#!/bin/sh
# runtime-config - fill the app's config file from its template when the container starts.
# https://github.com/taljacob2/runtime-config
#
# Every ${NAME} in the template must be a set, non-empty environment variable;
# otherwise the container stops here and names each one that is missing.
#
# Made for the official nginx images, which run every executable *.sh in
# /docker-entrypoint.d/ before nginx starts (and stop if one fails):
#
#   COPY --from=build /app/node_modules/@taljacob2/runtime-config/docker/40-runtime-config.sh /docker-entrypoint.d/
#   RUN chmod +x /docker-entrypoint.d/40-runtime-config.sh
#
# Any image with sh, grep, sed and envsubst can run it too, before its server starts.
#
# Settings (all optional):
#   RUNTIME_CONFIG_DIR       the folder the app is served from   (default /usr/share/nginx/html)
#   RUNTIME_CONFIG_TEMPLATE  the template's file name in it       (default config.json.template)
# The file written is the template's name without ".template".

set -eu

dir="${RUNTIME_CONFIG_DIR:-/usr/share/nginx/html}"
template="$dir/${RUNTIME_CONFIG_TEMPLATE:-config.json.template}"
target="${template%.template}"

fail() {
  echo "runtime-config: $*" >&2
  exit 1
}

[ -f "$template" ] || fail "$template is missing - the app's build ships it next to index.html."
[ "$target" != "$template" ] || fail "$template must end in .template - the file written is its name without it."
[ -w "$dir" ] || fail "$dir is not writable by this container's user ($(id -un 2>/dev/null || id -u)) - $target can't be written."

names=$(grep -o '\${[A-Za-z_][A-Za-z0-9_]*}' "$template" | tr -d '${}' | sort -u)

if [ -z "$names" ]; then
  cp "$template" "$target"
  echo "runtime-config: $template has no placeholders - copied it to $target as is"
  exit 0
fi

newline='
'
carriage_return=$(printf '\r')
tab=$(printf '\t')
missing=""
unusable=""

for name in $names; do
  # Safe: the grep above only lets letters, digits and _ through.
  eval "value=\${$name:-}"

  case "$value" in
    *[!\ ]*) ;;
    *) missing="$missing $name"; continue ;;
  esac

  case "$value" in
    *"$newline"* | *"$carriage_return"* | *"$tab"*)
      unusable="$unusable $name"
      continue
      ;;
  esac

  # The placeholders sit inside JSON strings: a \ or " in a value must be escaped.
  escaped=$(printf '%s' "$value" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')
  export "$name=$escaped"
done

if [ -n "$missing" ] || [ -n "$unusable" ]; then
  [ -z "$missing" ] || echo "runtime-config: these environment variables are not set:$missing" >&2
  [ -z "$unusable" ] || echo "runtime-config: these hold a line break or tab, which a setting can't:$unusable" >&2
  exit 1
fi

# Only these placeholders are replaced - any other $ in the template stays as it is.
# shellcheck disable=SC2086,SC2016
envsubst "$(printf '${%s} ' $names)" < "$template" > "$target"
echo "runtime-config: wrote $target from $template ($(echo $names | wc -w | tr -d ' ') settings)"
