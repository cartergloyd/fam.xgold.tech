#!/bin/sh
# Set a family member's streaming role (standard, trusted or admin) straight in the database. Usage: setrole.sh Carter trusted
set -e
case "$2" in standard|trusted|admin) ;; *) echo "role must be standard, trusted or admin"; exit 1;; esac
echo "update family_users set streaming_role = '$2' where name = '$1' returning name, streaming_role" | docker exec -i gold-platform-postgres sh -c 'psql -U "$POSTGRES_USER" -d fam -At'
