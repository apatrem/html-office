#!/usr/bin/env bash
# Installs Playwright's browsers and their Ubuntu packages on a hosted runner without hanging on
# an apt or DNS outage (11 November 2026: every package took 20 s to fail resolving three mirrors,
# so jobs sat in `playwright install --with-deps` until their timeout).
#
#   install.sh chromium firefox webkit
#
# Browsers come from ~/.cache/ms-playwright (restored by the action) or Playwright's CDN. Packages
# come, in order, from the image itself, from the .deb files a previous run on the same runner image
# kept in $PLAYWRIGHT_APT_DIR (no network needed), or from the Ubuntu mirrors, retried a bounded
# number of times once their names resolve (for up to $PLAYWRIGHT_DNS_WAIT seconds). Everything
# stops within $PLAYWRIGHT_INSTALL_BUDGET seconds with an error that says what failed.
set -uo pipefail

browsers=("$@")
debs=${PLAYWRIGHT_APT_DIR:-$HOME/.cache/playwright-apt}
deadline=$((SECONDS + ${PLAYWRIGHT_INSTALL_BUDGET:-720}))

# Playwright's CLI, run by path so that root can run it too (PLAYWRIGHT_CLI: tests/playwright-install.test.mjs).
node=$(command -v node)
cli=${PLAYWRIGHT_CLI:-$("$node" -p 'require("path").join(require("path").dirname(require.resolve("playwright/package.json")), "cli.js")')}

fail() {
  echo "::error title=Playwright install::$1"
  exit 1
}
# Seconds left, capped: every command below is bounded by the overall deadline.
left() {
  local rest=$((deadline - SECONDS))
  ((rest > $1)) && rest=$1
  echo $((rest > 0 ? rest : 0))
}
# Runs a command for at most min(cap, seconds left), then TERM and 15 s later KILL. It does not
# start with under 10 s left (`timeout 0` would mean no limit). With --root, `timeout` itself runs
# under sudo, so that its KILL reaches apt and dpkg.
bounded() {
  local as= t
  [[ $1 == --root ]] && as=sudo && shift
  t=$(left "$1")
  shift
  ((t >= 10)) || { echo "::warning::No time left for: $*"; return 124; }
  $as timeout --kill-after=15 "$t" "$@"
}
# Retried with growing pauses while time is left.
attempt() {
  local cap=$1 wait=15 n
  shift
  for n in 1 2 3; do
    bounded "$cap" "$@" && return 0
    echo "::warning::Attempt $n of '$*' failed (exit $?)"
    sleep "$(left $wait)"
    wait=$((wait * 2))
  done
  return 1
}
# Playwright's own check: `apt-get install -s` of its package list, offline; exits 1 if any is missing.
missing() {
  ! bounded 120 "$node" "$cli" install-deps --dry-run "${browsers[@]}" >/dev/null 2>&1
}
# The Ubuntu mirrors apt fetches from (the runner's mirror list, else the Ubuntu hosts in the
# sources), resolved before apt is asked to use them.
hosts_of() { grep -ohE 'https?://[^/[:space:]]+' "$@" 2>/dev/null | sed -E 's#https?://##' | sort -u; }
mirrors_resolve() {
  local hosts host
  hosts=$(hosts_of /etc/apt/apt-mirrors.txt)
  [[ -n $hosts ]] || hosts=$(hosts_of /etc/apt/sources.list /etc/apt/sources.list.d/* | grep ubuntu)
  [[ -n $hosts ]] || hosts=archive.ubuntu.com
  for host in $hosts; do
    if timeout 10 getent ahosts "$host" >/dev/null; then
      echo "Package mirror $host resolves"
      return 0
    fi
  done
  echo "No package mirror resolves: $(echo $hosts)"
  return 1
}
# A DNS blip of a few minutes is waited out; a longer outage fails the job instead of hanging it.
wait_for_mirrors() {
  local wait=10 stop=$((SECONDS + ${PLAYWRIGHT_DNS_WAIT:-300}))
  until mirrors_resolve; do
    ((SECONDS >= stop || $(left 60) < 30)) && return 1
    sleep "$(left $wait)"
    wait=$((wait < 30 ? wait * 2 : 60))
  done
  return 0
}

echo "::group::Browsers: ${browsers[*]}"
attempt 300 "$node" "$cli" install "${browsers[@]}" ||
  fail "Could not download the Playwright browsers (${browsers[*]}) from Playwright's CDN; re-run the job later."
echo "::endgroup::"

if ! missing; then
  echo "All system packages for ${browsers[*]} are already installed."
  exit 0
fi

shopt -s nullglob
cached=("$debs"/*.deb)
if ((${#cached[@]})); then
  echo "::group::Installing ${#cached[@]} cached packages without network"
  if bounded --root 300 apt-get install -y --no-download --no-install-recommends "${cached[@]}" && ! missing; then
    echo "::endgroup::"
    exit 0
  fi
  echo "::endgroup::"
  echo "::warning::The cached packages did not install; trying the Ubuntu mirrors."
fi

echo "::group::Installing system packages from the Ubuntu mirrors"
# Fail a fetch in seconds rather than minutes, and keep every downloaded .deb for the next run on
# this image (and only those: packages restored for another image are dropped).
sudo rm -rf "$debs"
mkdir -p "$debs/partial"
sudo tee /etc/apt/apt.conf.d/90-playwright-ci >/dev/null <<EOF
Acquire::Retries "2";
Acquire::http::Timeout "20";
Acquire::https::Timeout "20";
APT::Keep-Downloaded-Packages "true";
APT::Sandbox::User "root";
Dir::Cache::Archives "$debs/";
EOF
installed=0
for n in 1 2 3; do
  wait_for_mirrors || break
  if bounded --root 480 "$node" "$cli" install-deps "${browsers[@]}" && ! missing; then
    installed=1
    break
  fi
  echo "::warning::Attempt $n to install the system packages failed"
  (($(left 60) < 30)) && break
done
sudo rm -f /etc/apt/apt.conf.d/90-playwright-ci
sudo rm -rf "$debs/partial" "$debs/lock"
sudo chown -R "$(id -u):$(id -g)" "$debs"
echo "::endgroup::"
((installed)) ||
  fail "Could not install the system packages for ${browsers[*]}: the Ubuntu package mirrors did not resolve or answer within the time allowed (apt or DNS outage). Re-run the job once they are reachable."
# Tells the action to save the downloaded packages for runs on the same runner image.
kept=("$debs"/*.deb)
((${#kept[@]})) && [[ -n ${GITHUB_OUTPUT:-} ]] && echo "apt-cache=$debs" >>"$GITHUB_OUTPUT"
exit 0
