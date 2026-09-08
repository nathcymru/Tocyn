# Phase 1.4: External Ticket API & API Key Management

## Overview
This phase introduces a public REST API (`/api/v1/`) that allows third-party systems to interact with Luminatick. Access is controlled via API Keys, which can be managed by administrators in the dashboard.

## API Key Management
API Keys are used for machine-to-machine authentication.

### Key Format
`lt_<prefix>.<secret>`
- `lt_`: Constant prefix for Luminatick.
- `<prefix>`: A random 8-character string used to identify the key in the database without looking up the full secret.
- `<secret>`: A random 32-character secure string.

### Storage
- `prefix`: Stored in plain text for identification.
- `key_hash`: SHA-256 hash of the full API key (`lt_<prefix>.<secret>`).
- `name`: Friendly name for the key (e.g., "CRM Integration").
- `is_active`: Boolean to enable/disable the key.

### Security
- Keys are only shown once during creation.
- Revocation is immediate.
- Rate limiting is applied per API key.

## Public REST API (`/api/v1/`)
Base URL: `https://<your-worker-subdomain>.workers.dev/api/v1`

### Authentication
All requests must include the `X-API-Key` header.
```
X-API-Key: lt_abcd1234.somesupersecretstring
```

### Endpoints

#### 1. List Tickets
- **URL**: `GET /tickets`
- **Query Parameters**:
  - `page` (optional): Current page number (default: 1).
  - `filter_id` (optional): ID of the filter to apply for specific views.
  - `limit` (optional): Number of items per page (default: 50).
- **Response**: `200 OK` with paginated structure:
  ```json
  {
    "data": [
      {
        "id": "t-123",
        "subject": "System Alert: High CPU",
        "status": "open",
        "priority": "high",
        "created_at": "2024-05-24T12:00:00Z"
      }
    ],
    "meta": {
      "total": 150,
      "page": 1,
      "limit": 50,
      "total_pages": 3
    }
  }
  ```

#### 2. Create Ticket
- **URL**: `POST /tickets`
- **Rate Limit**: 10 requests per minute.
- **Behavior**: `customer_email` is declared requester contact data; it does not create or impersonate a customer account.
- **Body**:
  ```json
  {
    "subject": "System Alert: High CPU",
    "customer_email": "monitor@example.com",
    "body": "The CPU usage is above 90% for 5 minutes.",
    "priority": "high",
    "group": "DevOps"
  }
  ```
- **Response**: `201 Created` with ticket details.

#### 3. Get Ticket
- **URL**: `GET /tickets/:id`
- **Response**: `200 OK` with ticket and its articles.

#### 4. Add Article to Ticket
- **URL**: `POST /tickets/:id/articles`
- **Body**:
  ```json
  {
    "body": "Additional context about the issue...",
    "is_internal": false
  }
  ```
- **Response**: `201 Created`.

### Optional retry safety for mutations

`POST /tickets` and `POST /tickets/:id/articles` accept an optional,
`Idempotency-Key` header whose case-sensitive value matches `[A-Za-z0-9._~-]{1,128}`.
The same optional header applies to the customer portal ticket and message POST
routes. Missing keys preserve the existing unkeyed behaviour.

For a valid key, retries within 24 hours by the same authenticated tenant and
principal return the original immutable application response and status with
`Idempotency-Replayed: true`; the first keyed success returns the same response
with `Idempotency-Replayed: false`. A different effective mutation for the same
key returns `409` with `idempotency_conflict`. A deleted/redacted original
returns `410` with `idempotency_result_gone`; it is never recreated. Reply requests
first require the current target ticket to be accessible: missing or inaccessible
tickets return `404` before receipt lookup. A reply tombstone can return `410`
when the ticket remains authorized, for example after article/attachment deletion.

Every attempt still authenticates and authorizes normally. Current key
permissions, customer ownership, request limits, and origin policy apply before
cached response data is considered. Mutations require `application/json`, use a
64 KiB streamed request limit, and return controlled `400` malformed JSON/key,
`413` oversized body, `415` unsupported media type, or `503` when a committed
result cannot be resolved safely. Browser clients may send `Idempotency-Key` and
read `Idempotency-Replayed` through the configured exact-origin CORS policy;
API preflights also allow `X-API-Key`. Widget wildcard origins do not gain API-key
header permission.

The namespace includes tenant, current API-key/customer principal, operation and
hashed key. Effective input is normalized and versioned; omitted API create bodies
remain supported. The database clock fixes a 24-hour window without extending it
on replay. Successful mutations atomically commit their rows and a versioned raw
snapshot receipt (maximum 256 KiB); concurrent losing batches roll back. The v1
response renderer and canonical projector must retain compatible behavior for all
live v1 receipts; response changes require a new response version.

Portal reply commits its article, attachments and ticket timestamp together.
Existing R2 objects are checked only for new mutations; saved replies do not reread
R2. Saved portal creates do not consume Turnstile again. The winning portal reply
invokes one best-effort notification sequence after commit; the existing broadcast
service may try the transport up to three times. Broadcast failure does not change
the successful response, and a crash before broadcast can lose the event; a ticket
detail refresh recovers committed state.

New mutations remove at most 100 expired tenant receipts. Operators can purge a
bounded batch from an existing local fixture with
`node apps/server/scripts/purge-expired-mutation-receipts.mjs --local --persist-to PATH --tenant TENANT --limit 100`.
The path must already exist; this command does not create remote resources.
Dormant tenants have no hard physical-deletion SLA in this local beta; production
cleanup scheduling remains a separate release gate. Privacy deletion redacts saved
content into expiry-bounded key/fingerprint tombstones.

Reproduce the isolated local acceptance and its type checks with:

```sh
npm run typecheck:ticket-mutation-replay --workspace=apps/server
npm run test:ticket-mutation-replay --workspace=apps/server
```

These checks use local D1/R2/notification simulations and synthetic identities;
they do not authorize remote migration or production rollout.

Local acceptance on 9 September 2026 passed all 10 cases. Six concurrent API
creates produced one ticket, article and receipt; five concurrent attachment
replies produced one article, one attachment and one notification invocation.
The measured create snapshot was 1,001 bytes. Injected receipt, second-write and
attachment failures added zero D1 rows; attachment failure/recovery used two R2
validation reads without deleting the existing upload. The expiry race produced
one winner, and bounded cleanup removed 100 tenant A receipts and zero tenant B
receipts. A failing notification transport used three attempts; replay added none.
These are fixture measurements and regression evidence, not production capacity
or a physical-deletion SLA.

#### 5. Update/Close Ticket
- **URL**: `PATCH /tickets/:id`
- **Body**:
  ```json
  {
    "status": "closed",
    "priority": "normal",
    "custom_fields": {
      "environment": "production"
    }
  }
  ```
- **Behavior**: Safely handles partial updates to `custom_fields` by merging the provided JSON object with any existing custom field data.
- **Response**: `200 OK`.

#### 6. Public Configuration (Unauthenticated)
- **URL**: `GET /customer/config`
- **Authentication**: None required.
- **Behavior**: Returns non-sensitive platform configurations (e.g., `TICKET_PREFIX`) so public-facing apps like the Customer Portal can render correctly without API keys or user sessions.
- **Response**: `200 OK`
  ```json
  {
    "TICKET_PREFIX": "TKT-"
  }
  ```

## Internal Dashboard API Updates (`/api/`)

While Phase 1.4 focuses on the public `v1` API, the internal dashboard API has also been updated to support new features.

### 1. Filters Settings CRUD
- **URL**: `/api/settings/filters`
- **Authentication**: Requires Dashboard JWT and MFA verification.
- **Endpoints**:
  - `GET /api/settings/filters`: Retrieves all custom and default ticket filters.
  - `POST /api/settings/filters`: Creates a new custom filter. Requires `{ name, conditions, match_all }`. The `conditions` array uses a structured schema: `{ field, operator, value }` with operators like `equals`, `not_equals`, `contains`, and `in`.
  - `PATCH /api/settings/filters/:id`: Updates an existing custom filter. Default protected filters cannot be modified.
  - `DELETE /api/settings/filters/:id`: Deletes a custom filter. Default protected filters cannot be deleted.

### 2. Paginated Ticket List
- **URL**: `GET /api/tickets`
- **Updates**: Now accepts `page`, `limit`, and `filter_id` parameters to support the split-pane filters workspace. Returns the standard paginated response structure: `{ data: Ticket[], meta: { total, page, limit, total_pages } }`.

### 3. Authentication Updates
- **New Endpoint**: `POST /api/auth/mfa/disable`
  - **Authentication**: Requires Dashboard JWT and current MFA verification.
  - **Description**: Allows an authenticated user to safely disable Multi-Factor Authentication for their own account. This action sets `mfa_enabled` to `false` and removes the `mfa_secret` from the database.
- **User Payload Modification**: The User object returned by authentication endpoints (e.g., login, profile fetch) now explicitly includes the `mfa_enabled` boolean property. This allows the frontend to correctly reflect the user's current security posture on the Security Profile page.

## Widget API & AI Enhancements

While primarily functioning as an external ticket API, the `v1` namespace also serves the public-facing Web Widget. The Knowledge Base and AI Chat capabilities have been specifically optimized for Cloudflare's free tiers (Zero-Cost Free-Tier Optimized).

### 1. Multi-turn AI Chat
- **URL**: `POST /widget/chat`
- **Rate Limit**: 5 requests per minute per IP.
- **Description**: The endpoint has been upgraded to support multi-turn conversational memory. Instead of passing a single message, the client now passes an array of previous messages, enabling context-aware follow-up questions and multi-step troubleshooting. This memory is managed entirely on the client-side (widget), avoiding any D1 Write operations for storing chat history.
- **Body**:
  ```json
  {
    "messages": [
      { "role": "user", "content": "How do I reset my password?" },
      { "role": "assistant", "content": "You can reset it in the settings panel." },
      { "role": "user", "content": "Where is the settings panel?" }
    ],
    "category_id": "cat-123"
  }
  ```

### 2. Vectorize Metadata Filtering (Zero D1 Reads)
To prevent hallucinations and optimize costs, the `/widget/chat` endpoint leverages Cloudflare Vectorize's metadata filtering capability. 
- When `category_id` is passed in the request, the backend injects this as a metadata filter directly into the Vectorize similarity search. 
- **Cost Savings**: This filters the RAG results at the vector database level. The application does not need to fetch excess chunks from D1 and filter them in-memory, completely eliminating unnecessary D1 Read operations for scoping.

## Implementation Details

### Backend
- `ApiKeyService`: Logic for generating, hashing, and validating keys.
- `apiAuthMiddleware`: Authenticates requests based on the `X-API-Key` header.
- `v1Handlers`: REST handlers for the new endpoints.

### Frontend
- `ApiKeyManager`: Component in the Admin Dashboard to list, create, and revoke keys.
- Integration with `apiClient`.

## Database Schema (Existing)
```sql
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE,
    prefix TEXT NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used_at DATETIME
);
```

## Validation & Security Summaries

### Security Review Findings
A thorough security audit of the Phase 1.4 implementation was conducted, focusing on API Key management and the Public REST API.

1.  **API Key Security**:
    *   **Generation & Entropy**: Keys use a `lt_` prefix followed by a random 8-char prefix and a 32-char secret generated using `crypto.getRandomValues()`.
    *   **Hashing**: Full keys are hashed using `SHA-256` before storage, ensuring that even a database leak does not expose valid keys.
2.  **BOLA (Broken Object Level Authorization) Check**:
    *   As a single-tenant system, any valid API key is authorized for the organization's entire ticket pool. However, strict validation of the ticket ID format and existence is performed.
3.  **SQL Injection Check**:
    *   Dynamic SQL in the `PATCH /tickets/:id` handler is protected via strict column whitelisting (only `status` and `priority` are allowed) and parameter binding in D1.
4.  **Data Leakage Check**:
    *   `GET /tickets/:id` correctly filters out internal articles (`is_internal = 0`), preventing sensitive agent-only notes from being exposed via the public API.
5.  **Rate Limiting**:
    *   An in-memory rate limiter enforces `10 req/min` for ticket creation to prevent automated spamming.

### Automated Testing
Comprehensive testing was performed with **18 specific test cases** for Phase 1.4, achieving a **100% passing status**.

1.  **`ApiKeyService` (Unit Tests)**:
    *   Verified key generation format and component separation.
    *   Validated hashing and lookup logic.
    *   Ensured revocation correctly sets `is_active = 0`.
2.  **`v1` REST API (Integration Tests)**:
    *   **Authentication**: Confirmed `401 Unauthorized` for missing, malformed, or invalid keys.
    *   **Ticket Lifecycle**: Verified end-to-end flow: `POST /tickets` -> `GET /tickets/:id` -> `POST /articles` -> `PATCH /tickets/:id`.
    *   **Rate Limiting**: Verified `429 Too Many Requests` status code when exceeding limits.
    *   **Data Isolation**: Verified that internal articles are NOT returned in the GET response.
    *   **Validation**: Verified `400 Bad Request` for missing or invalid schema fields.
3.  **Dashboard API (Integration Tests)**:
    *   Verified that only authenticated and MFA-verified agents can create or revoke API keys.
