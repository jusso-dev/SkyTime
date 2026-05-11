#!/bin/sh
set -eu

POSTGRES_HOST="${POSTGRES_HOST:-postgres}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
POSTGRES_DB="${POSTGRES_DB:-skytime}"
POSTGRES_USER="${POSTGRES_USER:-skytime}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-skytime}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_PREFIX="${BACKUP_PREFIX:-skytime}"
LOCAL_RETENTION_DAYS="${LOCAL_RETENTION_DAYS:-}"
REQUIRE_S3="${REQUIRE_S3:-false}"

S3_BUCKET="${S3_BUCKET:-}"
S3_PREFIX="${S3_PREFIX:-skytime/postgres}"
S3_ENDPOINT_URL="${S3_ENDPOINT_URL:-}"
S3_FORCE_PATH_STYLE="${S3_FORCE_PATH_STYLE:-true}"

export PGPASSWORD="$POSTGRES_PASSWORD"
export AWS_EC2_METADATA_DISABLED="${AWS_EC2_METADATA_DISABLED:-true}"
export AWS_REQUEST_CHECKSUM_CALCULATION="${AWS_REQUEST_CHECKSUM_CALCULATION:-when_required}"
export AWS_RESPONSE_CHECKSUM_VALIDATION="${AWS_RESPONSE_CHECKSUM_VALIDATION:-when_required}"

if [ "$REQUIRE_S3" = "true" ] && [ -z "$S3_BUCKET" ]; then
  echo "S3_BUCKET is required when REQUIRE_S3=true." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +"%Y%m%dT%H%M%SZ")"
backup_name="${BACKUP_PREFIX}-${POSTGRES_DB}-${timestamp}.dump"
backup_file="${BACKUP_DIR}/${backup_name}"
checksum_file="${backup_file}.sha256"

echo "Waiting for Postgres at ${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}..."
until pg_isready \
  --host "$POSTGRES_HOST" \
  --port "$POSTGRES_PORT" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" >/dev/null 2>&1; do
  sleep 2
done

echo "Creating backup ${backup_file}..."
pg_dump \
  --host "$POSTGRES_HOST" \
  --port "$POSTGRES_PORT" \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format custom \
  --compress=9 \
  --no-owner \
  --no-acl \
  --file "$backup_file"

(cd "$BACKUP_DIR" && sha256sum "$backup_name" > "${backup_name}.sha256")
echo "Wrote checksum ${checksum_file}."

if [ -n "$LOCAL_RETENTION_DAYS" ]; then
  echo "Removing local backups older than ${LOCAL_RETENTION_DAYS} days..."
  find "$BACKUP_DIR" -type f \
    \( -name "${BACKUP_PREFIX}-*.dump" -o -name "${BACKUP_PREFIX}-*.dump.sha256" \) \
    -mtime +"$LOCAL_RETENTION_DAYS" \
    -delete
fi

if [ -n "$S3_BUCKET" ]; then
  s3_uri="s3://${S3_BUCKET}/${S3_PREFIX%/}/${backup_name}"
  endpoint_args=""

  if [ "$S3_FORCE_PATH_STYLE" = "true" ]; then
    aws configure set default.s3.addressing_style path >/dev/null
  fi

  if [ -n "$S3_ENDPOINT_URL" ]; then
    endpoint_args="--endpoint-url ${S3_ENDPOINT_URL}"
  fi

  echo "Uploading backup to ${s3_uri}..."
  # shellcheck disable=SC2086
  aws $endpoint_args s3 cp "$backup_file" "$s3_uri"
  # shellcheck disable=SC2086
  aws $endpoint_args s3 cp "$checksum_file" "${s3_uri}.sha256"
fi

echo "Backup complete: ${backup_file}"
