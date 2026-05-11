#!/bin/sh
set -eu

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-skytime}"
POSTGRES_USER="${POSTGRES_USER:-skytime}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-skytime}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
RESTORE_FILE="${RESTORE_FILE:-}"
CONFIRM_RESTORE="${CONFIRM_RESTORE:-false}"

S3_ENDPOINT_URL="${S3_ENDPOINT_URL:-}"
S3_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}"

export PGPASSWORD="$POSTGRES_PASSWORD"
export AWS_EC2_METADATA_DISABLED="${AWS_EC2_METADATA_DISABLED:-true}"
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}"
export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"

if [ "$CONFIRM_RESTORE" != "true" ]; then
  echo "Set CONFIRM_RESTORE=true to restore over ${POSTGRES_DB}." >&2
  exit 1
fi

if [ -z "$RESTORE_FILE" ]; then
  echo "RESTORE_FILE must point to a local dump path or an s3:// URI." >&2
  exit 1
fi

restore_file="$RESTORE_FILE"

case "$RESTORE_FILE" in
  s3://*)
    mkdir -p /tmp/skytime-restore
    restore_file="/tmp/skytime-restore/$(basename "$RESTORE_FILE")"
    endpoint_args=""

    if [ "$S3_FORCE_PATH_STYLE" = "true" ]; then
      aws configure set default.s3.addressing_style path >/dev/null
    fi

    if [ -n "$S3_ENDPOINT_URL" ]; then
      endpoint_args="--endpoint-url ${S3_ENDPOINT_URL}"
    fi

    echo "Downloading ${RESTORE_FILE}..."
    # shellcheck disable=SC2086
    aws $endpoint_args s3 cp "$RESTORE_FILE" "$restore_file"
    ;;
  /*)
    ;;
  *)
    restore_file="${BACKUP_DIR%/}/${RESTORE_FILE}"
    ;;
esac

if [ ! -f "$restore_file" ]; then
  echo "Restore file does not exist: ${restore_file}" >&2
  exit 1
fi

echo "Waiting for Postgres at ${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}..."
until pg_isready \
  --host "$POSTGRES_HOST" \
  --port "$POSTGRES_PORT" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" >/dev/null 2>&1; do
  sleep 2
done

echo "Restoring ${restore_file} into ${POSTGRES_DB}..."
pg_restore \
  --host "$POSTGRES_HOST" \
  --port "$POSTGRES_PORT" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  "$restore_file"

echo "Restore complete."
