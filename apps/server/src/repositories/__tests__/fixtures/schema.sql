CREATE TABLE users (
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

CREATE TABLE groups (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, name)
);

CREATE TABLE tickets (
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
    FOREIGN KEY (tenant_id, customer_id) REFERENCES users(tenant_id, id),
    FOREIGN KEY (tenant_id, assigned_to) REFERENCES users(tenant_id, id),
    FOREIGN KEY (tenant_id, group_id) REFERENCES groups(tenant_id, id)
);

CREATE TABLE articles (
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
    is_internal BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, ticket_id) REFERENCES tickets(tenant_id, id),
    FOREIGN KEY (tenant_id, sender_id) REFERENCES users(tenant_id, id)
);

CREATE INDEX idx_articles_ticket ON articles(tenant_id, ticket_id, created_at);

CREATE TABLE attachments (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    article_id TEXT NOT NULL,
    file_name TEXT NOT NULL,
    file_size INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    r2_key TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY (tenant_id, article_id) REFERENCES articles(tenant_id, id)
);

CREATE INDEX idx_attachments_article ON attachments(tenant_id, article_id);
