# Requirements Log

Every function, class and schema carries a JSDoc header:

```ts
/**
 * <What it does, in English>
 * @since REQ-xxx     the requirement that introduced it
 * @updated REQ-yyy   one line per later requirement that changed it
 */
```

| ID | Title | Roadmap phase | Status |
|---|---|---|---|
| REQ-001 | Project scaffold: monorepo, shared schemas, API health check, web shell, Docker infra | 3 | ✅ Done |
| REQ-002 | Auth: register, login, JWT access token + rotating refresh token (HttpOnly cookie), logout, current user | 2, 3, Security | ✅ Done |
| REQ-003 | Workspaces: create/rename/delete, members (add by email, change role, remove, leave), ownership transfer, RBAC permission guard + ABAC member rules | 3, 4 | ✅ Done |
| REQ-004 | Boards, columns, tasks: CRUD, drag-and-drop ordering (fractional index), offset + cursor pagination, task search (pg_trgm), optimistic locking, serializable moves with retry | 4 | ✅ Done |
| REQ-005 | Redis cache-aside for board detail (stampede lock, null caching, TTL jitter, invalidation), rate limiting (sliding window for auth, token bucket for API), distributed lock | 5 | ✅ Done |
| REQ-006 | Background jobs with BullMQ: workspace invitations by email (create, list, revoke, accept), deadline reminder cron, retries with backoff, idempotent jobs, separate worker entry, Mailpit for local SMTP | 5 | ✅ Done |
| REQ-007 | Web app: routing with protected routes, workspace and board pages, Kanban drag and drop with optimistic updates, task editor with conflict handling, debounced infinite task search, invitations UI and accept page, code splitting | 6 | ✅ Done |
