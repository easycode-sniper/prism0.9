#!/usr/bin/env bash
#
# PostToolUse hook: after a git commit, merge or push, ask Claude to run
# the site-tester agent against the deployed site.
#
# Wired up in .claude/settings.json. It receives the hook payload as JSON
# on stdin and answers with `additionalContext`, which is injected back
# into the model's context — a hook is a shell command and cannot spawn a
# subagent itself, so this is how the two are connected.
#
# It is deliberately advisory. Blocking the turn on a deploy that takes
# two minutes to go live would stall every commit, and a commit is not
# the thing under test anyway — the deployment built FROM it is, which is
# why the agent checks the Vercel deployment state before testing.
#
# To silence it for one session: export PRISM_SKIP_SITE_TEST=1
# To turn it off for good: delete the PostToolUse block in settings.json.

set -uo pipefail

if [ "${PRISM_SKIP_SITE_TEST:-}" = "1" ]; then
  exit 0
fi

payload=$(cat)
cmd=$(printf '%s' "$payload" | jq -r '.tool_input.command // ""' 2>/dev/null) || exit 0

# `git commit`, `git merge`, `git push` — including inside a compound
# command such as `git add -A && git commit -m ...`. Anything that only
# reads (log, status, show, diff) must not trigger a deploy test.
if ! printf '%s' "$cmd" | grep -qE '(^|[;&|[:space:]])git[[:space:]]+([a-z-]+[[:space:]]+)*(commit|merge|push)([[:space:]]|$)'; then
  exit 0
fi

# A dry run changes nothing, so there is nothing new to test.
if printf '%s' "$cmd" | grep -qE '\-\-dry-run'; then
  exit 0
fi

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
sha=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

read -r -d '' context <<CONTEXT || true
Git history just changed on branch "${branch}" (HEAD is now ${sha}).

Per this project's setup, run the \`site-tester\` subagent now to check the
deployed site at https://prism0-9.vercel.app. Launch it with the Agent tool
(subagent_type: "site-tester") and pass it the commit ${sha}.

The agent waits for the Vercel deployment of that commit to reach READY
before testing — a commit that has not deployed yet is not a failure.

Two things to hold it to when it reports back:
  - Exit code 2 means it could NOT test. That is not a pass; relay the
    reason it gives.
  - Only "main" is deployed to production. On any other branch the agent
    is testing whatever main currently serves, which is the previous
    version — say so rather than attributing the result to ${sha}.

If the user has asked you not to run it, skip it and say you did.
CONTEXT

jq -n --arg ctx "$context" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}'
