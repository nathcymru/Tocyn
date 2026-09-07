-- Phase 1 core ownership migration. Unreleased; local rehearsal only until cutover approval.

PRAGMA defer_foreign_keys = on;

CREATE TABLE preserved_customer_auth_tokens AS SELECT * FROM customer_auth_tokens;

CREATE TABLE owned_users (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    email TEXT NOT NULL,
    full_name TEXT,
    password_hash TEXT,
    role TEXT NOT NULL,
    mfa_secret TEXT,
    mfa_enabled BOOLEAN DEFAULT FALSE,
    last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login_at DATETIME,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, email)
);

CREATE TABLE owned_groups (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, name)
);

CREATE TABLE owned_tickets (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    ticket_no INTEGER,
    subject TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    priority TEXT NOT NULL DEFAULT 'normal',
    customer_id TEXT,
    customer_email TEXT NOT NULL,
    assigned_to TEXT,
    group_id TEXT,
    source TEXT NOT NULL,
    source_email TEXT,
    custom_fields TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, customer_id) REFERENCES owned_users(tenant_id, id),
    FOREIGN KEY (tenant_id, assigned_to) REFERENCES owned_users(tenant_id, id),
    FOREIGN KEY (tenant_id, group_id) REFERENCES owned_groups(tenant_id, id)
);

CREATE TABLE owned_articles (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    ticket_id TEXT NOT NULL,
    sender_id TEXT,
    sender_type TEXT NOT NULL,
    body TEXT,
    body_r2_key TEXT,
    snippet TEXT,
    raw_email_id TEXT,
    qa_type TEXT,
    chunk_count INTEGER DEFAULT 0,
    is_internal BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, ticket_id) REFERENCES owned_tickets(tenant_id, id),
    FOREIGN KEY (tenant_id, sender_id) REFERENCES owned_users(tenant_id, id)
);

CREATE TABLE owned_attachments (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    article_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, article_id) REFERENCES owned_articles(tenant_id, id)
);

CREATE TABLE owned_user_groups (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    PRIMARY KEY (tenant_id, user_id, group_id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES owned_users(tenant_id, id),
    FOREIGN KEY (tenant_id, group_id) REFERENCES owned_groups(tenant_id, id)
);

CREATE TABLE owned_support_emails (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    email_address TEXT NOT NULL,
    normalized_email TEXT UNIQUE NOT NULL,
    name TEXT,
    is_default INTEGER DEFAULT 0,
    group_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id)
);

INSERT INTO owned_users (tenant_id, id, email, full_name, password_hash, role, mfa_secret, mfa_enabled, last_active_at, created_at, last_login_at) SELECT 'default-tenant', id, email, full_name, password_hash, role, mfa_secret, mfa_enabled, last_active_at, created_at, last_login_at FROM users;

INSERT INTO owned_groups (tenant_id, id, name, description, created_at) SELECT 'default-tenant', id, name, description, created_at FROM groups;

INSERT INTO owned_tickets (tenant_id, id, subject, status, priority, customer_id, customer_email, assigned_to, group_id, source, created_at, updated_at, ticket_no, custom_fields, source_email) SELECT 'default-tenant', id, subject, status, priority, customer_id, customer_email, assigned_to, group_id, source, created_at, updated_at, ticket_no, custom_fields, source_email FROM tickets;

INSERT INTO owned_articles (tenant_id, id, ticket_id, sender_id, sender_type, body, body_r2_key, snippet, raw_email_id, qa_type, is_internal, created_at) SELECT 'default-tenant', id, ticket_id, sender_id, sender_type, body, body_r2_key, snippet, raw_email_id, qa_type, is_internal, created_at FROM articles;

INSERT INTO owned_attachments (tenant_id, id, article_id, file_name, file_size, content_type, r2_key, created_at) SELECT 'default-tenant', id, article_id, file_name, file_size, content_type, r2_key, created_at FROM attachments;

INSERT INTO owned_user_groups (tenant_id, user_id, group_id) SELECT 'default-tenant', user_id, group_id FROM user_groups;

INSERT INTO owned_support_emails (tenant_id, id, email_address, name, group_id, is_default, created_at, updated_at, normalized_email) SELECT 'default-tenant', id, email_address, name, group_id, is_default, created_at, updated_at, lower(trim(email_address)) FROM support_emails;

DROP TABLE customer_auth_tokens;

DROP TABLE attachments;

DROP TABLE articles;

DROP TABLE tickets;

DROP TABLE user_groups;

DROP TABLE support_emails;

DROP TABLE users;

DROP TABLE groups;

ALTER TABLE owned_users RENAME TO users;

ALTER TABLE owned_groups RENAME TO groups;

ALTER TABLE owned_tickets RENAME TO tickets;

ALTER TABLE owned_articles RENAME TO articles;

ALTER TABLE owned_attachments RENAME TO attachments;

ALTER TABLE owned_user_groups RENAME TO user_groups;

ALTER TABLE owned_support_emails RENAME TO support_emails;

-- Preserve legacy challenge provenance until migration 0019 resolves it uniquely.

ALTER TABLE preserved_customer_auth_tokens RENAME TO customer_auth_tokens;

CREATE UNIQUE INDEX idx_users_login_email ON users(lower(trim(email)));

CREATE INDEX idx_tickets_tenant_customer_created ON tickets(tenant_id, customer_email, created_at DESC);

CREATE INDEX idx_articles_ticket ON articles(tenant_id, ticket_id, created_at);

CREATE INDEX idx_attachments_article ON attachments(tenant_id, article_id);
