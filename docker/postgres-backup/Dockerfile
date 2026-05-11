FROM postgres:18-alpine

RUN apk add --no-cache aws-cli ca-certificates tzdata

COPY backup.sh restore.sh /usr/local/bin/

RUN chmod +x /usr/local/bin/backup.sh /usr/local/bin/restore.sh

