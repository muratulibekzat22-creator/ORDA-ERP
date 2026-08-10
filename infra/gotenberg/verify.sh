#!/usr/bin/env sh
set -eu

: "${GOTENBERG_URL:?GOTENBERG_URL is required}"
: "${GOTENBERG_TOKEN:?GOTENBERG_TOKEN is required}"

case "$GOTENBERG_URL" in
  https://*) ;;
  *) echo "GOTENBERG_URL must use HTTPS" >&2; exit 1 ;;
esac

status_without_token="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$GOTENBERG_URL/health")"
status_wrong_token="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --header 'Authorization: Bearer invalid-token' "$GOTENBERG_URL/health")"
status_health="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --header "Authorization: Bearer $GOTENBERG_TOKEN" "$GOTENBERG_URL/health")"

case "$status_without_token" in 401|403) ;; *) echo "Unauthenticated health request was not rejected" >&2; exit 1 ;; esac
case "$status_wrong_token" in 401|403) ;; *) echo "Wrong bearer token was not rejected" >&2; exit 1 ;; esac
test "$status_health" = "200" || { echo "Authenticated health check failed" >&2; exit 1; }

if [ "$#" -eq 1 ]; then
  input="$1"
  test -f "$input" || { echo "DOCX input does not exist" >&2; exit 1; }
  output="$(mktemp)"
  trap 'rm -f "$output"' EXIT INT TERM
  curl --fail --silent --show-error \
    --header "Authorization: Bearer $GOTENBERG_TOKEN" \
    --form "files=@$input;type=application/vnd.openxmlformats-officedocument.wordprocessingml.document" \
    --output "$output" \
    "$GOTENBERG_URL/forms/libreoffice/convert"
  test "$(head -c 5 "$output")" = "%PDF-" || { echo "Converter returned a non-PDF response" >&2; exit 1; }
fi

echo "Private Gotenberg gateway checks passed."
