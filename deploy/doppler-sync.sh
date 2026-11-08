#!/usr/bin/env bash
#
# Push the console's production configuration from Doppler into Vercel.
#
#   deploy/doppler-sync.sh                      # dry run: key names and states, nothing changes
#   deploy/doppler-sync.sh --apply              # add new keys / update changed readable keys, then redeploy if any changed
#   deploy/doppler-sync.sh --apply --push KEY   # also overwrite KEY although Vercel stores it as sensitive (write-only)
#   deploy/doppler-sync.sh --apply --no-redeploy  # change variables but leave the redeploy to the next merge
#
# Doppler (project acdp-ui-console, config prd) is the source of truth for the
# keys listed in deploy/doppler-keys.txt, and only those, in the Vercel project
# zer07labs/acdp-ui-console, Production environment. The script adds and
# updates them; it never removes a Vercel variable, never touches a key outside
# the list, and never touches Preview or Development. An entry shared with
# another environment is reported and never modified.
#
# Vercel never returns the value of a "sensitive" variable, so such a key
# cannot be compared: it is reported as sensitive-unverifiable and left alone
# unless named with --push. A key marked "sensitive" in doppler-keys.txt is
# created as a sensitive variable. The production-entry metadata hash printed
# at the start and again at the end of every run that gets that far (ids,
# keys, types, targets, updatedAt; never values) shows whether anything
# changed.
#
# Values are piped from Doppler into Vercel and are never printed or written
# to disk: writes go to the Vercel REST API with the value built inside jq and
# sent on curl's stdin, and the token on a file descriptor, never in argv
# (`vercel env update` cannot change a sensitive variable). Every read must
# succeed: a failed Doppler or Vercel read stops the run with nothing changed,
# rather than looking like "no entry". Vercel holds no Doppler token. Needs
# git, jq, curl and the doppler and vercel CLIs, logged in. Refuses to run on
# a dirty working tree, so what runs is what is committed.
set -euo pipefail

VERCEL_TEAM=zer07labs
VERCEL_TEAM_ID=team_hCHZb89wQ6E3IV3p9Lafq5Sp
VERCEL_PROJECT=acdp-ui-console
VERCEL_PROJECT_ID=prj_jMhAWkgCKgktp8mcpVrXHpDno1ux
DOPPLER_PROJECT=acdp-ui-console
DOPPLER_CONFIG=prd

mode=dry-run
redeploy=yes
push=" "
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) mode=dry-run ;;
    --apply) mode=apply ;;
    --no-redeploy) redeploy=no ;;
    --push)
      [ $# -ge 2 ] || { echo "--push needs a key name" >&2; exit 2; }
      push="$push$2 "; shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '%s\n' "$*" >&2; }
die() { say "doppler-sync: $*"; exit 1; }

for c in git jq curl doppler vercel shasum; do
  command -v "$c" >/dev/null || die "needs $c on PATH"
done
repo="$(git rev-parse --show-toplevel)"
[ -z "$(git -C "$repo" status --porcelain)" ] || die "working tree is dirty; commit or stash first"

# doppler-keys.txt: one "KEY" or "KEY sensitive" per line; # starts a comment.
keys_file="$repo/deploy/doppler-keys.txt"
[ -f "$keys_file" ] || die "missing $keys_file"
entries="$(sed -e 's/#.*//' "$keys_file" | awk 'NF {print $1, (NF == 1 ? "plain" : $2), (NF > 2 ? "extra" : "")}' | sed 's/ *$//')"
if grep -Ev '^[A-Z_][A-Z0-9_]* (sensitive|plain)$' <<<"$entries" | grep -q .; then
  die "malformed line in $keys_file (expected KEY or KEY sensitive)"
fi
keys="$(cut -d' ' -f1 <<<"$entries")"
for k in $push; do
  grep -qx "$k" <<<"$keys" || die "--push $k: not listed in deploy/doppler-keys.txt"
done

say "Doppler $DOPPLER_PROJECT/$DOPPLER_CONFIG -> Vercel $VERCEL_TEAM/$VERCEL_PROJECT (production):"
if [ -z "$keys" ]; then
  say "  0 managed keys (deploy/doppler-keys.txt lists none); nothing to do"
  exit 0
fi
say "  $(wc -l <<<"$keys" | tr -d ' ') managed key(s)"

doppler me >/dev/null 2>&1 || die "doppler is not logged in (doppler login)"
vercel whoami >/dev/null 2>&1 || die "vercel is not logged in (vercel login)"

vercel_token() {
  if [ -n "${VERCEL_TOKEN:-}" ]; then printf '%s' "$VERCEL_TOKEN"; return; fi
  local f
  for f in "$HOME/Library/Application Support/com.vercel.cli/auth.json" \
    "${XDG_DATA_HOME:-$HOME/.local/share}/com.vercel.cli/auth.json"; do
    [ -f "$f" ] && { jq -r '.token' "$f"; return; }
  done
  die "no Vercel token (set VERCEL_TOKEN or run vercel login)"
}
# The token goes to curl on a file descriptor, never in argv.
vercel_api() {
  curl -fsS "https://api.vercel.com$1" -H @<(printf 'Authorization: Bearer %s\n' "$(vercel_token)")
}

# Production entries (no git-branch scope) as
# {KEY: {id, value, type, shared}}. The list endpoint returns encrypted values,
# so each non-sensitive entry is read back decrypted by id; a sensitive entry
# has no readable value (null). shared is true when the entry also targets
# Preview or Development. Fails (non-zero) if any read fails: the callers run
# it as `x="$(vercel_vars)" || die`, where set -e is suspended, so every step
# checks its own status.
production_entries() {
  vercel_api "/v9/projects/$VERCEL_PROJECT_ID/env?teamId=$VERCEL_TEAM_ID" |
    jq -c '[.envs[] | select((.target // []) | index("production")) | select(.gitBranch == null)
            | {id, key, type, updatedAt, target: ((.target // []) | sort), shared: ((.target | length) > 1)}]'
}
vercel_vars() {
  local entries ids id
  entries="$(production_entries)" || return 1
  ids="$(jq -r '.[] | select(.type != "sensitive") | .id' <<<"$entries")" || return 1
  {
    for id in $ids; do
      vercel_api "/v1/projects/$VERCEL_PROJECT_ID/env/$id?teamId=$VERCEL_TEAM_ID" | jq -ce '{id, value}' || exit 1
    done
  } | jq -sce --argjson e "$entries" '
    (map({(.id): .value}) | add // {}) as $v |
    $e | map({(.key): {id, value: $v[.id], type, shared}}) | add // {}'
}
metadata_hash() {
  production_entries | jq -c 'map({id, key, type, target, updatedAt}) | sort_by(.key, .id)' |
    shasum -a 256 | cut -c1-16
}
# Pin the CLI to this project whatever the shell exports or the checkout is
# linked to, so writes go to the same project the API reads.
vercel_cli() {
  VERCEL_ORG_ID="$VERCEL_TEAM_ID" VERCEL_PROJECT_ID="$VERCEL_PROJECT_ID" \
    vercel "$@" --scope "$VERCEL_TEAM" --cwd "$repo"
}
doppler_vars() {
  doppler secrets download --no-file --format json --project "$DOPPLER_PROJECT" --config "$DOPPLER_CONFIG"
}

# One line per key: "<KEY> <state>". Both sides are read into shell variables
# first, each with its own check, so a failed read stops the run instead of
# reading as "no entry" (set -e cannot see a failure inside <(...)). Values
# reach jq only through printf pipes, never argv or disk.
plan() {
  local d v
  d="$(doppler_vars)" || die "reading Doppler $DOPPLER_PROJECT/$DOPPLER_CONFIG failed; nothing changed"
  v="$(vercel_vars)" || die "reading Vercel environment variables failed; nothing changed"
  printf '%s' "$d" | jq -e 'type == "object"' >/dev/null || die "unexpected Doppler response; nothing changed"
  printf '%s' "$v" | jq -e 'type == "object"' >/dev/null || die "unexpected Vercel response; nothing changed"
  jq -nr --slurpfile d <(printf '%s' "$d") --slurpfile v <(printf '%s' "$v") --arg keys "$keys" --arg push "$push" '
    $d[0] as $d | $v[0] as $v |
    $keys | split("\n")[] | . as $k |
    if ($d | has($k) | not) then "\($k) missing-in-doppler"
    elif ($v | has($k) | not) then "\($k) new"
    elif $v[$k].shared then "\($k) shared-with-other-environments"
    elif $v[$k].type == "sensitive" then
      (if ($push | contains(" \($k) ")) then "\($k) push-sensitive" else "\($k) sensitive-unverifiable" end)
    elif $v[$k].value == $d[$k] then "\($k) unchanged"
    else "\($k) changed" end'
}

before="$(metadata_hash)" || die "reading Vercel environment variables failed; nothing changed"
say "  production metadata hash: $before"
result="$(plan)" || exit 1
while read -r k state; do say "  $k: $state"; done <<<"$result"
grep -q ' missing-in-doppler$' <<<"$result" && die "listed keys are missing from Doppler; nothing changed"
for k in $push; do
  grep -qx "$k push-sensitive" <<<"$result" ||
    die "--push $k: only a production-only sensitive entry can be pushed (state: $(awk -v k="$k" '$1 == k {print $2}' <<<"$result")); nothing changed"
done
todo="$(awk '$2 == "changed" || $2 == "new" || $2 == "push-sensitive" {print $1 " " $2}' <<<"$result")"

if [ -z "$todo" ]; then
  say "nothing to push (sensitive and shared entries are left as they are)"
  say "  production metadata hash: $(metadata_hash) (was $before)"
  exit 0
fi
if [ "$mode" = dry-run ]; then say "dry run: $(wc -l <<<"$todo" | tr -d ' ') key(s) would change; --apply to push"; exit 0; fi

# Writes go to the REST API: the body is built in jq from Doppler's output and
# sent on curl's stdin, the token on a file descriptor.
vercel_write() {
  curl -fsS -o /dev/null -X "$1" "https://api.vercel.com$2" \
    -H @<(printf 'Authorization: Bearer %s\n' "$(vercel_token)") -H 'content-type: application/json' --data-binary @-
}
while read -r k state; do
  class="$(awk -v k="$k" '$1 == k {print $2}' <<<"$entries")"
  type=encrypted
  { [ "$class" = sensitive ] || [ "$state" = push-sensitive ]; } && type=sensitive
  doppler_vars </dev/null | jq -e --arg k "$k" '(.[$k] // "") != ""' >/dev/null ||
    die "Doppler value for $k is empty or unreadable; nothing written"
  case "$state" in
    new)
      say "setting $k (add, $type)"
      doppler_vars </dev/null | jq -c --arg k "$k" --arg t "$type" '{key: $k, value: .[$k], type: $t, target: ["production"]}' |
        vercel_write POST "/v10/projects/$VERCEL_PROJECT_ID/env?teamId=$VERCEL_TEAM_ID" || die "adding $k failed"
      ;;
    *)
      # Only a production-only entry is ever updated (plan() already reports shared ones).
      id="$(production_entries | jq -r --arg k "$k" '[.[] | select(.key == $k and (.shared | not))] | if length == 1 then .[0].id else empty end')" ||
        die "reading Vercel environment variables failed; nothing written for $k"
      [ -n "$id" ] || die "$k: expected exactly one production-only entry; nothing written"
      say "setting $k (update, $type)"
      # A plain update keeps the entry's type; only --push sends type sensitive.
      doppler_vars </dev/null | jq -c --arg k "$k" --arg t "$type" --arg s "$state" \
        '{value: .[$k]} + (if $s == "push-sensitive" then {type: $t} else {} end)' |
        vercel_write PATCH "/v9/projects/$VERCEL_PROJECT_ID/env/$id?teamId=$VERCEL_TEAM_ID" || die "updating $k failed"
      ;;
  esac
done <<<"$todo"

after_plan="$(plan)" || exit 1
while read -r k state; do say "  $k: $state"; done <<<"$after_plan"
if grep -Eq ' (changed|new|missing-in-doppler)$' <<<"$after_plan"; then
  die "Vercel does not match Doppler after --apply; not redeploying"
fi
say "  production metadata hash: $(metadata_hash) (was $before)"

if [ "$redeploy" = no ]; then say "variables set; --no-redeploy, so they take effect on the next production deployment"; exit 0; fi
latest="$(vercel_api "/v6/deployments?projectId=$VERCEL_PROJECT_ID&teamId=$VERCEL_TEAM_ID&target=production&state=READY&limit=1" |
  jq -r '.deployments[0].uid // empty')"
[ -n "$latest" ] || die "variables match Doppler, but no production deployment to rebuild; deploy to apply them"
say "rebuilding production ($latest) so the new values take effect (NEXT_PUBLIC_* are build-time)"
vercel_cli redeploy "$latest" --target production --non-interactive >/dev/null
