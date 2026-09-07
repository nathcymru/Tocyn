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

CREATE TABLE IF NOT EXISTS tenant_config (
    tenant_id TEXT NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, key)
);

CREATE TABLE IF NOT EXISTS support_emails (
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


CREATE TABLE IF NOT EXISTS knowledge_categories (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    parent_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY(tenant_id, parent_id) REFERENCES knowledge_categories(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS knowledge_docs (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    title TEXT NOT NULL,
    file_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    category_id TEXT,
    chunk_count INTEGER DEFAULT 0,
    tier TEXT CHECK(tier IN ('answer', 'sop')) DEFAULT 'answer',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    FOREIGN KEY(tenant_id, category_id) REFERENCES knowledge_categories(tenant_id, id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS api_keys (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    permissions TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME,
    PRIMARY KEY (tenant_id, id)
);

CREATE INDEX idx_api_keys_hash ON api_keys(key_hash);

CREATE TABLE IF NOT EXISTS automation_rules (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    event_type TEXT NOT NULL,
    conditions TEXT,
    action_type TEXT NOT NULL,
    action_config TEXT,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, name)
);

CREATE INDEX idx_automation_rules_tenant_event ON automation_rules(tenant_id, event_type, is_active);

CREATE TABLE IF NOT EXISTS ticket_fields (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    label TEXT NOT NULL,
    field_type TEXT NOT NULL,
    options TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS user_groups (
    tenant_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    PRIMARY KEY (tenant_id, user_id, group_id),
    FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id),
    FOREIGN KEY (tenant_id, group_id) REFERENCES groups(tenant_id, id)
);

CREATE TABLE IF NOT EXISTS ticket_filters (
    tenant_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    conditions TEXT,
    is_system BOOLEAN NOT NULL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (tenant_id, id),
    UNIQUE (tenant_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_login_email ON users(lower(trim(email)));
CREATE UNIQUE INDEX IF NOT EXISTS idx_widget_public_key ON tenant_config(value) WHERE key = 'widget.public_key';

CREATE TABLE IF NOT EXISTS ticket_sequence (
    id INTEGER PRIMARY KEY AUTOINCREMENT
);

CREATE TABLE IF NOT EXISTS customer_auth_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('magic_link', 'otp')),
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_customer_auth_tokens_user_id ON customer_auth_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_customer_auth_tokens_token_hash ON customer_auth_tokens(token_hash);
