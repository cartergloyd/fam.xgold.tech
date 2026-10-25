# Profile name fields

Apply profile-name-fields.sql to the private fam database. It keeps display names,
profile IDs, PIN salts and Jellyfin links unchanged. Unknown surnames stay blank.

The family endpoint's publicUser serializer must also include:

    first_name: row.first_name || row.name.split(' ')[0],
    last_name: row.last_name || null,

Canonical endpoint source is maintained in the homelab dashboard deployment under
`deploy/family-directory/directus-extension-family-directory/index.js`.
The active extension is mounted at `public-apps/fam/extensions/` on the server.

The private users.csv now has First Name and Last Name columns; the import script
preserves these fields. Never commit this CSV, credentials, exports, or backups.
