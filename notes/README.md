# 📚 Ghi chú lý thuyết theo REQ

Quy trình cho mỗi REQ:

1. **Học lý thuyết:** đọc file `notes/REQ-xxx-*.md` (giải thích, ví dụ, câu hỏi phỏng vấn kèm đáp án mẫu).
2. **Code:** làm REQ đó trong TaskFlow, áp dụng đúng phần lý thuyết vừa học.
3. **Ôn lại:** tự trả lời các câu hỏi ở cuối file _mà không nhìn đáp án_, rồi so sánh.

> Ghi chú viết bằng tiếng Việt, giữ nguyên thuật ngữ tiếng Anh, vì interviewer thường dùng thuật ngữ gốc.

## Bản đồ REQ ↔ kiến thức

Mỗi REQ phủ một phần của [ROADMAP.md](../ROADMAP.md). Hoàn thành hết 15 REQ là đã đi qua toàn bộ roadmap.

| REQ     | Tính năng TaskFlow                                | Lý thuyết học kèm                                                                                                 | Phase          | Ghi chú                                   |
| ------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------- |
| REQ-001 | Project scaffold (monorepo, health check, Docker) | JS core (event loop, closure, Promise), TypeScript, Node internals, NestJS & DI, ESM/CJS, Prisma, Docker          | 1, 3           | ✅ [REQ-001](REQ-001-scaffold.md)         |
| REQ-002 | Auth: register, login, JWT access + refresh token | HTTP, cookie, CORS, session và JWT, hashing, OAuth2, XSS/CSRF                                                     | 2, 3, Security | ✅ [REQ-002](REQ-002-auth.md)             |
| REQ-003 | Workspace, thành viên, phân quyền                 | RBAC/ABAC, Guard, thiết kế DB (chuẩn hóa, quan hệ), transaction                                                   | 3, 4           | ✅ [REQ-003](REQ-003-workspaces-rbac.md)  |
| REQ-004 | Board, task CRUD, kéo thả, phân trang, tìm kiếm   | REST design, index, EXPLAIN, offset và cursor pagination, isolation level, optimistic lock, N+1, full-text search | 4              | ✅ [REQ-004](REQ-004-boards-tasks.md)     |
| REQ-005 | Cache và rate limiting                            | Redis data types, cache patterns, stampede/penetration/avalanche, thuật toán rate limit, distributed lock         | 5              | ✅ [REQ-005](REQ-005-cache-rate-limit.md) |
| REQ-006 | Job nền: email mời, nhắc deadline                 | Queue, BullMQ, retry/backoff, idempotency, cron                                                                   | 5              | ✅ [REQ-006](REQ-006-background-jobs.md)  |
| REQ-007 | Frontend: luồng đăng nhập, Kanban UI              | React rendering, hooks, TanStack Query, optimistic update, state management, performance                          | 6              | ⬜                                        |
| REQ-008 | Thông báo realtime                                | WebSocket, SSE, long polling, socket.io + Redis adapter, scale stateful connection                                | 2, 5           | ⬜                                        |
| REQ-009 | Đính kèm file                                     | Multipart, S3 presigned URL, bảo mật upload, CDN                                                                  | 3, 9           | ⬜                                        |
| REQ-010 | Trang chia sẻ board công khai (Next.js)           | CSR/SSR/SSG/ISR, Server Components, hydration, SEO                                                                | 6              | ⬜                                        |
| REQ-011 | Refactor Clean Architecture + test                | SOLID, design patterns, layered/hexagonal, testing pyramid, mock                                                  | 7              | ⬜                                        |
| REQ-012 | Tách Notification microservice qua RabbitMQ       | Microservices, message broker, RabbitMQ và Kafka, Outbox, Saga, idempotent consumer, circuit breaker              | 8              | ⬜                                        |
| REQ-013 | Observability                                     | Logs/metrics/traces, OpenTelemetry, Prometheus/Grafana, Sentry, SLO                                               | 9              | ⬜                                        |
| REQ-014 | CI/CD, deploy, Kubernetes, tối ưu image           | GitHub Actions, blue-green/canary, K8s objects, probes, HPA, Nginx                                                | 9              | ⬜                                        |
| REQ-015 | Tài liệu thiết kế "TaskFlow cho 1 triệu user"     | System design: scaling, replication, sharding, CAP, consistent hashing                                            | 10             | ⬜                                        |

**Học riêng song song (không gắn REQ):** LeetCode mỗi ngày 1–2 bài (NeetCode 150), Git, Linux.
