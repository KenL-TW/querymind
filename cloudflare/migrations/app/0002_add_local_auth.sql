-- Password material is salted and PBKDF2-derived in the Worker. Never store plaintext passwords.
ALTER TABLE users ADD COLUMN password_salt TEXT;
ALTER TABLE users ADD COLUMN password_hash TEXT;
ALTER TABLE users ADD COLUMN password_updated_at TEXT;
