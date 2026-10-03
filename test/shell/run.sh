#!/bin/sh
# Tests for docker/40-runtime-config.sh - plain sh, like the script itself.
# Needs sh, grep, sed, envsubst and node (to check the JSON written). Run: npm run test:shell
set -u

here=$(cd "$(dirname "$0")" && pwd)
script="$here/../../docker/40-runtime-config.sh"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

passed=0
failed=0

pass() { passed=$((passed + 1)); echo "  ok   $1"; }
fail() { failed=$((failed + 1)); echo "  FAIL $1"; [ -z "${2:-}" ] || printf '       %s\n' "$2"; }

# A fresh folder holding $1 as config.json.template.
fresh() {
  rm -rf "$work/html"
  mkdir -p "$work/html"
  printf '%s\n' "$1" > "$work/html/config.json.template"
}

# Runs the script with only PATH, the folder, and the given NAME=value pairs set.
run() {
  env -i PATH="$PATH" RUNTIME_CONFIG_DIR="$work/html" "$@" sh "$script" > "$work/out" 2> "$work/err"
  echo $? > "$work/code"
}

code() { cat "$work/code"; }

# Does the written file parse as JSON and equal the expected JSON?
json_equals() {
  node -e '
    const fs = require("node:fs");
    const actual = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const expected = JSON.parse(process.argv[2]);
    process.exit(JSON.stringify(actual) === JSON.stringify(expected) ? 0 : 1);
  ' "$work/html/config.json" "$1" 2> /dev/null
}

template='{
  "apiBaseUrl": "${MYAPP_API_BASE_URL}",
  "sentryDsn": "${MYAPP_SENTRY_DSN}"
}'

echo "docker/40-runtime-config.sh"

fresh "$template"
run MYAPP_API_BASE_URL=https://api.example.com MYAPP_SENTRY_DSN=dsn
if [ "$(code)" = 0 ] && json_equals '{"apiBaseUrl":"https://api.example.com","sentryDsn":"dsn"}' \
  && grep -q "wrote $work/html/config.json from $work/html/config.json.template (2 settings)" "$work/out"; then
  pass "fills every placeholder and says so"
else
  fail "fills every placeholder and says so" "code $(code): $(cat "$work/err" "$work/out")"
fi

fresh "$template"
run MYAPP_SENTRY_DSN="   "
if [ "$(code)" = 1 ] && grep -q "these environment variables are not set: MYAPP_API_BASE_URL MYAPP_SENTRY_DSN" "$work/err" \
  && [ ! -f "$work/html/config.json" ]; then
  pass "stops, naming every missing or blank variable, and writes nothing"
else
  fail "stops, naming every missing or blank variable, and writes nothing" "code $(code): $(cat "$work/err")"
fi

fresh "$template"
tricky='say "hi" \ C:\path\ & a|b /x $HOME ${OTHER} 50%'
run MYAPP_API_BASE_URL="$tricky" MYAPP_SENTRY_DSN=dsn
expected=$(node -e 'process.stdout.write(JSON.stringify({ apiBaseUrl: process.argv[1], sentryDsn: "dsn" }))' "$tricky")
if [ "$(code)" = 0 ] && json_equals "$expected"; then
  pass "escapes \\ and \" so any value round-trips through the JSON exactly"
else
  fail "escapes \\ and \" so any value round-trips through the JSON exactly" "code $(code): $(cat "$work/html/config.json" 2> /dev/null)"
fi

# Windows builds of envsubst read the environment through the system code page and
# turn non-ASCII text into "?"; Linux - every container image - passes the bytes through.
case "$(uname -s)" in
  MINGW* | MSYS* | CYGWIN*)
    echo "  skip keeps non-ASCII text intact (this Windows shell's envsubst can't - Linux runs it)"
    ;;
  *)
    fresh "$template"
    unicode='שלום · café · 東京 · 🚀'
    run MYAPP_API_BASE_URL="$unicode" MYAPP_SENTRY_DSN=dsn
    expected=$(node -e 'process.stdout.write(JSON.stringify({ apiBaseUrl: process.argv[1], sentryDsn: "dsn" }))' "$unicode")
    if [ "$(code)" = 0 ] && json_equals "$expected"; then
      pass "keeps non-ASCII text intact"
    else
      fail "keeps non-ASCII text intact" "code $(code): $(cat "$work/html/config.json" 2> /dev/null)"
    fi
    ;;
esac

fresh "$template"
run MYAPP_API_BASE_URL="line one
line two" MYAPP_SENTRY_DSN="$(printf 'a\tb')"
if [ "$(code)" = 1 ] && grep -q "these hold a line break or tab, which a setting can't: MYAPP_API_BASE_URL MYAPP_SENTRY_DSN" "$work/err"; then
  pass "refuses a value with a line break or a tab"
else
  fail "refuses a value with a line break or a tab" "code $(code): $(cat "$work/err")"
fi

fresh '{ "a": "${ONLY_THIS}", "price": "$5", "home": "$HOME", "brace": "${not-a-name}" }'
run ONLY_THIS=x HOME=/root
if [ "$(code)" = 0 ] && json_equals '{"a":"x","price":"$5","home":"$HOME","brace":"${not-a-name}"}'; then
  pass "replaces only its placeholders - any other \$ stays as it is"
else
  fail "replaces only its placeholders - any other \$ stays as it is" "code $(code): $(cat "$work/html/config.json" 2> /dev/null)"
fi

fresh '{ "fixed": "value" }'
run
if [ "$(code)" = 0 ] && json_equals '{"fixed":"value"}' && grep -q "has no placeholders - copied it" "$work/out"; then
  pass "copies a template with no placeholders as it is"
else
  fail "copies a template with no placeholders as it is" "code $(code): $(cat "$work/err" "$work/out")"
fi

rm -rf "$work/html" && mkdir -p "$work/html"
run
if [ "$(code)" = 1 ] && grep -q "config.json.template is missing - the app's build ships it next to index.html" "$work/err"; then
  pass "stops when the template is missing"
else
  fail "stops when the template is missing" "code $(code): $(cat "$work/err")"
fi

rm -rf "$work/html" && mkdir -p "$work/html"
printf '{ "x": "${SETTING_X}" }\n' > "$work/html/app.settings.template"
run RUNTIME_CONFIG_TEMPLATE=app.settings.template SETTING_X=1
if [ "$(code)" = 0 ] && [ -f "$work/html/app.settings" ]; then
  pass "takes another template name, writing it without .template"
else
  fail "takes another template name, writing it without .template" "code $(code): $(cat "$work/err")"
fi

rm -rf "$work/html" && mkdir -p "$work/html"
printf '{}\n' > "$work/html/config.json"
run RUNTIME_CONFIG_TEMPLATE=config.json
if [ "$(code)" = 1 ] && grep -q "must end in .template" "$work/err"; then
  pass "refuses a template name without .template - it would overwrite itself"
else
  fail "refuses a template name without .template - it would overwrite itself" "code $(code): $(cat "$work/err")"
fi

# A folder the container's user can't write to. Root writes anyway, and some
# Windows shells ignore chmod - skip there rather than pass by accident.
fresh "$template"
chmod 555 "$work/html"
if [ -w "$work/html" ]; then
  echo "  skip refuses a folder it can't write to (this user can write regardless)"
else
  run MYAPP_API_BASE_URL=x MYAPP_SENTRY_DSN=y
  if [ "$(code)" = 1 ] && grep -q "is not writable by this container's user" "$work/err"; then
    pass "refuses a folder it can't write to"
  else
    fail "refuses a folder it can't write to" "code $(code): $(cat "$work/err")"
  fi
fi
chmod 755 "$work/html"

echo
echo "$passed passed, $failed failed"
[ "$failed" = 0 ]
