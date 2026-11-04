# 🚀 Lộ trình Fullstack, mục tiêu Middle Developer

> **Thời lượng:** khoảng 16 tuần, 2–3 giờ/ngày
> **Stack:** TypeScript · React/Next.js · Node.js (Express/NestJS) · PostgreSQL · MongoDB · Redis · RabbitMQ/Kafka · Docker · Kubernetes · AWS
> **Nguyên tắc:** học lý thuyết song song với việc xây dự án **TaskFlow**. Interviewer cấp Middle không hỏi "X là gì" mà hỏi **"tại sao chọn X, trade-off là gì, scale thế nào, debug ra sao"**.

---

## 📌 Mục lục
0. [Dự án xuyên suốt: TaskFlow](#0-dự-án-xuyên-suốt-taskflow)
1. [JavaScript & TypeScript nâng cao](#giai-đoạn-1--javascript--typescript-nâng-cao-tuần-1-2)
2. [Networking, HTTP, Git, Linux](#giai-đoạn-2--networking-http-git-linux-tuần-2)
3. [Node.js Backend + Docker](#giai-đoạn-3--nodejs-backend--docker-tuần-3-5)
4. [Database](#giai-đoạn-4--database-tuần-6-7)
5. [Redis, Caching, Queue](#giai-đoạn-5--redis-caching-queue-tuần-8)
6. [React & Next.js](#giai-đoạn-6--react--nextjs-tuần-9-10)
7. [Clean Architecture, SOLID, Design Patterns, Testing](#giai-đoạn-7--clean-architecture-solid-design-patterns-testing-tuần-11)
8. [Microservices & Message Queue](#giai-đoạn-8--microservices--message-queue-tuần-12-13)
9. [DevOps: Nginx, CI/CD, Cloud, Kubernetes, Observability](#giai-đoạn-9--devops-nginx-cicd-cloud-kubernetes-observability-tuần-14)
10. [System Design, Thuật toán, Mock Interview](#giai-đoạn-10--system-design-thuật-toán-mock-interview-tuần-15-16)
11. [Bảo mật (học xuyên suốt)](#bảo-mật--học-xuyên-suốt)
12. [Câu hỏi hành vi, CV, mẹo phỏng vấn](#câu-hỏi-hành-vi-cv--mẹo)
13. [Tài liệu tham khảo](#tài-liệu-tham-khảo)

---

## 0. Dự án xuyên suốt: TaskFlow

App quản lý công việc nhóm (giống Trello/Jira thu nhỏ).

**Tính năng:** đăng ký/đăng nhập (JWT + refresh token, OAuth Google) · workspace & phân quyền (owner/admin/member) · board Kanban kéo thả · task, comment, đính kèm file (S3) · thông báo realtime · email nền · tìm kiếm · thống kê · audit log.

```
fullstack/
├── apps/
│   ├── web/                 # React + TS + Vite (hoặc Next.js)
│   ├── api/                 # NestJS/Express: core service (auth, workspace, task)
│   └── notification/        # Microservice: email + realtime (tách ở giai đoạn 8)
├── packages/
│   └── shared/              # types, zod schema dùng chung
├── infra/
│   ├── nginx/               # reverse proxy / API gateway
│   └── k8s/                 # manifest Kubernetes
├── docker-compose.yml       # postgres, redis, rabbitmq, services
└── .github/workflows/       # CI/CD
```

**Kiến trúc tiến hóa theo giai đoạn** (đây là câu chuyện để kể khi phỏng vấn):
1. Monolith đơn giản
2. Modular monolith + Clean Architecture
3. Tách Notification Service, giao tiếp qua RabbitMQ
4. Deploy bằng Docker/K8s, có monitoring

---

## Giai đoạn 1: JavaScript & TypeScript nâng cao (Tuần 1–2)

### JavaScript core
- [ ] Scope, hoisting, TDZ, closure, `this` (4 quy tắc binding), `call/apply/bind`
- [ ] Prototype, prototype chain, `class` thực chất là gì
- [ ] **Event loop:** call stack, microtask (Promise, `queueMicrotask`), macrotask (setTimeout, I/O); khác biệt giữa browser và Node
- [ ] Promise, async/await, `Promise.all/allSettled/race/any`, xử lý lỗi bất đồng bộ
- [ ] Giá trị và tham chiếu, shallow/deep copy, `structuredClone`
- [ ] `==` và `===`, type coercion, truthy/falsy
- [ ] Garbage collection, memory leak (closure, listener, timer, cache không giới hạn)
- [ ] ES Modules và CommonJS
- [ ] Generator, iterator, `Symbol`, `WeakMap/WeakSet`, `Proxy/Reflect`

### TypeScript
- [ ] Khi nào dùng `type`, khi nào dùng `interface`; union, intersection, literal type
- [ ] Generics + constraints (`<T extends ...>`)
- [ ] Utility types: `Partial`, `Required`, `Pick`, `Omit`, `Record`, `ReturnType`, `Parameters`, `Awaited`
- [ ] Narrowing, type guard, discriminated union, `satisfies`
- [ ] So sánh `unknown`, `any` và `never`; exhaustive check
- [ ] Conditional types, mapped types, `infer`, template literal types
- [ ] Decorator (cần cho NestJS), `tsconfig` (strict, paths, module resolution)

### ✅ Thực hành
- Tự viết bằng TS: `debounce`, `throttle`, `Promise.all`, `deepClone`, `EventEmitter`, `memoize`, `retry(fn, times)`, `curry`
- Viết type `DeepPartial<T>`, `DeepReadonly<T>`

### ❓ Câu hỏi phỏng vấn
- Dự đoán output của một đoạn code trộn `setTimeout`, `Promise`, `async/await`, `process.nextTick`
- Closure gây memory leak trong trường hợp nào?
- Discriminated union giúp gì cho việc xử lý state/response?
- Tại sao không nên dùng `any`? Khi nào `unknown` hợp lý?

---

## Giai đoạn 2: Networking, HTTP, Git, Linux (Tuần 2)

### Networking & HTTP
- [ ] **Chuyện gì xảy ra khi gõ URL vào trình duyệt** (DNS, TCP handshake, TLS, HTTP request, render)
- [ ] Mô hình OSI/TCP-IP (mức đủ dùng), so sánh TCP và UDP
- [ ] HTTPS/TLS handshake, certificate
- [ ] HTTP/1.1, HTTP/2 (multiplexing), HTTP/3 (QUIC)
- [ ] Method, status code, header quan trọng (`Cache-Control`, `ETag`, `Authorization`, `Content-Type`)
- [ ] Idempotent, safe method
- [ ] Cookie (`HttpOnly`, `Secure`, `SameSite`), CORS + preflight
- [ ] So sánh WebSocket, SSE, long polling
- [ ] Tổng quan REST, GraphQL, gRPC

### Git
- [ ] Merge và rebase, squash, cherry-pick, `reset` (soft/mixed/hard), `revert`, `stash`, `reflog`
- [ ] Giải quyết conflict
- [ ] Git flow, trunk-based development, Conventional Commits
- [ ] Quy trình làm Pull Request / code review

### Linux cơ bản
- [ ] Các lệnh: `ls, grep, find, tail -f, ps, top/htop, kill, chmod, chown, df, du, curl, netstat/ss, lsof`
- [ ] Process, signal (SIGTERM, SIGKILL), biến môi trường, SSH key
- [ ] Đọc log và debug trên server

### ❓ Câu hỏi phỏng vấn
- Giải thích chi tiết quá trình truy cập `https://google.com`
- CORS là gì? Tại sao Postman gọi được mà browser lại lỗi?
- Rebase có rủi ro gì khi làm việc nhóm?

---

## Giai đoạn 3: Node.js Backend + Docker (Tuần 3–5)

### Node.js internals
- [ ] Kiến trúc: V8 + libuv, thread pool, các phase của event loop (timers, poll, check...)
- [ ] `process.nextTick` và `setImmediate`
- [ ] Stream (readable, writable, transform, backpressure), Buffer
- [ ] So sánh `worker_threads`, `cluster`, `child_process`; xử lý tác vụ CPU-bound
- [ ] Phát hiện memory leak (heap snapshot, `--inspect`)
- [ ] Graceful shutdown (bắt SIGTERM, đóng kết nối DB/queue)
- [ ] Xử lý lỗi: `uncaughtException`, `unhandledRejection`

### Framework
- [ ] **Express:** middleware, router, error-handling middleware
- [ ] **NestJS:** module, controller, provider, **Dependency Injection**, guard, interceptor, pipe, exception filter, config module
- [ ] So sánh Express, NestJS và Fastify

### API design
- [ ] Chuẩn REST, versioning, pagination (offset và cursor), filter/sort
- [ ] Validation (**Zod** / class-validator), DTO
- [ ] Định dạng response và lỗi thống nhất
- [ ] Idempotency key (cho thanh toán, tạo đơn)
- [ ] Tài liệu API: Swagger/OpenAPI
- [ ] Upload file (multer, presigned URL lên S3)

### Authentication & Authorization
- [ ] So sánh session và JWT; cơ chế access token + refresh token (rotation, revoke)
- [ ] Lưu token ở đâu (cookie HttpOnly hay localStorage)
- [ ] Hash mật khẩu: bcrypt/argon2
- [ ] OAuth2 / OpenID Connect (đăng nhập Google)
- [ ] So sánh RBAC và ABAC

### Thư viện Node.js nên biết
| Mục đích | Thư viện |
|---|---|
| Validation | `zod`, `class-validator` |
| ORM / Query | `prisma`, `typeorm`, `drizzle`, `knex` |
| Auth | `jsonwebtoken`, `passport`, `bcrypt`/`argon2` |
| Logging | `pino`, `winston` |
| Queue | `bullmq` |
| Realtime | `socket.io`, `ws` |
| HTTP client | `axios`, `undici`/`fetch` |
| Message broker | `amqplib` (RabbitMQ), `kafkajs` |
| Security | `helmet`, `express-rate-limit`, `cors` |
| Upload | `multer`, `@aws-sdk/client-s3` |
| Test | `jest`/`vitest`, `supertest` |
| Date / util | `dayjs`, `lodash` |

### 🐳 Docker (từ đây trở đi dùng hằng ngày)
- [ ] Image, container, layer, volume, network, registry
- [ ] So sánh container và VM
- [ ] Dockerfile: **multi-stage build**, sắp thứ tự layer để tận dụng cache, `.dockerignore`, chạy bằng user không phải root, image nhỏ (alpine/distroless)
- [ ] `CMD` và `ENTRYPOINT`, `COPY` và `ADD`, `ARG` và `ENV`
- [ ] **docker-compose:** nhiều service, `depends_on` + healthcheck, volume cho DB, file `.env`
- [ ] Debug: `docker logs`, `docker exec`, `docker inspect`

### ✅ TaskFlow
- API auth (register/login/refresh/logout), CRUD workspace/board/task, phân quyền
- Swagger docs, logging bằng pino, xử lý lỗi tập trung, graceful shutdown
- Dockerfile multi-stage + docker-compose (api + postgres + redis)

### ❓ Câu hỏi phỏng vấn
- Node single-thread mà sao vẫn chịu tải cao? Khi nào Node **không** phù hợp?
- Nếu có tác vụ CPU nặng (resize ảnh, export PDF) thì xử lý thế nào?
- Refresh token bị đánh cắp thì làm sao? Logout khi dùng JWT thế nào?
- Middleware trong Express chạy theo thứ tự nào? Error middleware khác gì?
- DI trong NestJS hoạt động thế nào? Lợi ích là gì?
- Làm sao để image Docker nhỏ và build nhanh?

---

## Giai đoạn 4: Database (Tuần 6–7)

### SQL (PostgreSQL), trọng tâm
- [ ] JOIN các loại, GROUP BY/HAVING, subquery, CTE (`WITH`), **window function** (`ROW_NUMBER`, `RANK`, `LAG`)
- [ ] **Index:** B-tree, composite index (quy tắc leftmost prefix), covering index, partial index, GIN (full-text, JSONB)
- [ ] Khi nào index không có tác dụng (dùng hàm trên cột, `LIKE '%x'`, độ chọn lọc thấp)
- [ ] Đọc `EXPLAIN ANALYZE`, phân biệt seq scan, index scan, bitmap scan
- [ ] **Transaction, ACID**
- [ ] **Isolation level:** Read Uncommitted, Read Committed, Repeatable Read, Serializable; các hiện tượng dirty read, non-repeatable read, phantom read
- [ ] Locking: so sánh optimistic lock (version) và pessimistic lock (`SELECT ... FOR UPDATE`), deadlock
- [ ] MVCC trong Postgres (mức khái niệm)
- [ ] Chuẩn hóa 1NF–3NF và khi nào nên denormalize
- [ ] **N+1 query** và cách xử lý
- [ ] Connection pooling (pgBouncer, pool trong ORM)
- [ ] Migration, seed, khi nào dùng soft delete
- [ ] JSONB, full-text search

### Scale database
- [ ] Read replica, so sánh vertical scaling và horizontal scaling
- [ ] Partitioning, **sharding** (chọn shard key)
- [ ] **Định lý CAP**, PACELC

### NoSQL (MongoDB)
- [ ] Document model; khi nào embed, khi nào reference
- [ ] Index, aggregation pipeline
- [ ] So sánh SQL và NoSQL: tiêu chí lựa chọn

### ORM
- [ ] **Prisma** (schema, relation, transaction, raw query) hoặc TypeORM
- [ ] Hiểu ORM sinh ra SQL gì và tránh query kém

### ✅ TaskFlow
- Thiết kế ERD: users, workspaces, workspace_members, boards, columns, tasks, comments, attachments, activity_logs
- Thứ tự task trong cột khi kéo thả (fractional indexing)
- Query thống kê: số task theo trạng thái/người, top contributor (dùng window function)
- Đánh index và so sánh kết quả `EXPLAIN` trước/sau
- Phân trang bằng cursor cho activity log

### ❓ Câu hỏi phỏng vấn
- Hai người cùng sửa một task một lúc, xử lý thế nào? (optimistic lock)
- Hai request cùng trừ tồn kho thì sao? (transaction + `FOR UPDATE` / atomic update)
- Một query chậm thì debug thế nào?
- Composite index `(a, b)` có giúp query `WHERE b = ?` không?
- Tại sao offset pagination chậm khi dữ liệu lớn?
- Khi nào chọn MongoDB thay vì Postgres?

---

## Giai đoạn 5: Redis, Caching, Queue (Tuần 8)

### Redis
- [ ] Kiểu dữ liệu: String, Hash, List, Set, Sorted Set, Stream, Bitmap, HyperLogLog
- [ ] Vì sao Redis nhanh (in-memory, single-thread + I/O multiplexing)
- [ ] TTL, eviction policy (LRU, LFU)
- [ ] Persistence: so sánh RDB và AOF
- [ ] Replication, Sentinel, Cluster (mức khái niệm)
- [ ] Pipeline, transaction (`MULTI`), Lua script

### Caching
- [ ] Các pattern: **cache-aside**, write-through, write-behind
- [ ] **Cache invalidation**
- [ ] Các lỗi: **cache stampede** (thundering herd), **penetration**, **avalanche** và cách xử lý (lock, jitter TTL, bloom filter, cache null)
- [ ] Nhiều tầng cache: browser, CDN, Redis, DB
- [ ] Đảm bảo nhất quán giữa cache và DB

### Use case thực tế
- [ ] Rate limiting: fixed window, sliding window, token bucket
- [ ] Lưu session, blacklist token
- [ ] **Distributed lock** (`SET NX PX`, Redlock)
- [ ] Leaderboard (Sorted Set), đếm view, online user
- [ ] Pub/Sub, Socket.io Redis adapter (scale WebSocket)

### Job queue: BullMQ
- [ ] Job, worker, retry + backoff, delayed job, cron job, concurrency
- [ ] Dead letter / xử lý job thất bại

### ✅ TaskFlow
- Cache danh sách board/task (cache-aside + invalidate khi cập nhật)
- Rate limit cho login và API
- Blacklist access token khi logout
- BullMQ: gửi email mời vào workspace, nhắc deadline (cron)
- Scale socket.io bằng Redis adapter

### ❓ Câu hỏi phỏng vấn
- Update DB rồi xóa cache, hay xóa cache rồi update DB? Tại sao?
- Một key hot hết hạn làm 10k request đổ vào DB, xử lý thế nào?
- Thiết kế rate limiter 100 request/phút/user
- Redis sập thì hệ thống của bạn ra sao?

---

## Giai đoạn 6: React & Next.js (Tuần 9–10)

### React core
- [ ] Virtual DOM, reconciliation, vai trò của **`key`**
- [ ] Vòng đời render: render phase và commit phase; khi nào component re-render
- [ ] Hooks: `useState`, `useEffect` (dependency, cleanup, race condition), `useLayoutEffect`, `useRef`, `useMemo`, `useCallback`, `useReducer`, `useContext`
- [ ] **Custom hook**, quy tắc của hooks
- [ ] So sánh controlled và uncontrolled component
- [ ] React 18/19: concurrent rendering, `useTransition`, `useDeferredValue`, Suspense, automatic batching, `use`, Actions
- [ ] Error Boundary, Portal, `forwardRef`
- [ ] Tối ưu hiệu năng: `React.memo`, code splitting (`lazy`), virtualization (react-window), React DevTools Profiler

### Hệ sinh thái
- [ ] State: Context (và các hạn chế), **Zustand**, **Redux Toolkit**
- [ ] Server state: **TanStack Query** (cache, invalidate, optimistic update, infinite query)
- [ ] Form: React Hook Form + Zod
- [ ] React Router
- [ ] Styling: Tailwind CSS, CSS Modules
- [ ] Gọi API: axios interceptor tự refresh token

### Next.js
- [ ] So sánh CSR, SSR, SSG, ISR, khi nào dùng cái nào
- [ ] App Router, **Server Components và Client Components**, Server Actions
- [ ] Data fetching, caching, revalidate
- [ ] SEO, metadata, hydration (lỗi hydration mismatch)
- [ ] Middleware, route handler

### Frontend performance & chất lượng
- [ ] Core Web Vitals (LCP, INP, CLS)
- [ ] Lazy load ảnh, CDN, bundle analysis, tree shaking
- [ ] Accessibility (a11y) cơ bản
- [ ] Browser rendering: reflow, repaint; debounce input

### ✅ TaskFlow
- UI đăng nhập (tự refresh token), dashboard, board Kanban kéo thả (dnd-kit) có **optimistic update**
- Thông báo realtime (socket.io), infinite scroll cho activity log
- Upload file trực tiếp lên S3 bằng presigned URL
- Dark mode, responsive

### ❓ Câu hỏi phỏng vấn
- Tại sao không nên dùng index làm `key`?
- `useEffect` gọi API bị race condition khi đổi tham số liên tục, xử lý thế nào?
- `useMemo/useCallback` lúc nào **thừa**?
- Context gây re-render toàn cây thì làm sao?
- So sánh Server state và Client state; tại sao dùng TanStack Query?
- Server Component khác SSR thế nào?
- Một trang hiển thị 10.000 dòng bị lag, tối ưu thế nào?

---

## Giai đoạn 7: Clean Architecture, SOLID, Design Patterns, Testing (Tuần 11)

### Thiết kế
- [ ] **SOLID** (cho ví dụ thực tế từng nguyên tắc)
- [ ] DRY, KISS, YAGNI
- [ ] **Design patterns:** Singleton, Factory, Strategy, Observer, Adapter, Decorator, Repository, Dependency Injection, Middleware/Chain of Responsibility
- [ ] **Layered / Clean / Hexagonal Architecture**: controller, service/use-case, repository, domain
- [ ] DDD cơ bản: entity, value object, aggregate, bounded context (cần cho việc tách microservice)
- [ ] Modular monolith

### Testing
- [ ] Testing pyramid: unit, integration, E2E
- [ ] Unit test (Jest/Vitest), mock/stub/spy
- [ ] Integration test API (Supertest + DB thật qua Testcontainers/Docker)
- [ ] React Testing Library
- [ ] E2E: Playwright
- [ ] Code coverage, TDD (mức khái niệm)

### ✅ TaskFlow
- Refactor backend theo Clean Architecture, chia module rõ ràng (auth, workspace, task, notification)
- Coverage của service layer ≥ 70%, integration test cho các API chính, 1–2 luồng E2E

### ❓ Câu hỏi phỏng vấn
- Cho ví dụ vi phạm nguyên tắc Open/Closed và cách sửa
- Tại sao cần Repository pattern khi đã có ORM?
- Bạn mock gì và không mock gì khi viết test?

---

## Giai đoạn 8: Microservices & Message Queue (Tuần 12–13)

> ⚠️ Middle **phải** trả lời được câu *"khi nào KHÔNG nên dùng microservices"*.

### Khái niệm
- [ ] So sánh monolith, modular monolith và microservices: ưu nhược điểm
- [ ] Cách tách service: theo business capability / bounded context
- [ ] **Database per service**

### Giao tiếp giữa các service
- [ ] Đồng bộ: REST, **gRPC** (protobuf, so sánh với REST)
- [ ] Bất đồng bộ: event-driven, message queue
- [ ] **RabbitMQ:** exchange (direct, topic, fanout), queue, routing key, ack/nack, dead letter queue, prefetch
- [ ] **Kafka:** topic, partition, offset, consumer group, retention, đảm bảo thứ tự message
- [ ] So sánh RabbitMQ và Kafka, khi nào dùng cái nào
- [ ] Ngữ nghĩa delivery: at-most-once, at-least-once, exactly-once; **consumer idempotent**

### Dữ liệu phân tán
- [ ] Eventual consistency
- [ ] **Saga pattern** (choreography và orchestration), compensating transaction
- [ ] **Outbox pattern** (tránh lỗi dual-write)
- [ ] CQRS, Event Sourcing (mức khái niệm)

### Hạ tầng & khả năng chịu lỗi
- [ ] **API Gateway** (routing, auth, rate limit), BFF pattern
- [ ] Service discovery
- [ ] Retry + exponential backoff, timeout, **circuit breaker**, bulkhead, fallback
- [ ] Xác thực giữa các service (JWT propagation, mTLS)
- [ ] Distributed tracing (correlation ID / trace ID)

### ✅ TaskFlow
- Tách **Notification Service**: API bắn event `task.assigned`, `comment.created` qua RabbitMQ, service nhận event rồi gửi email + đẩy socket
- Áp dụng Outbox pattern ở API, consumer idempotent (lưu `eventId` đã xử lý)
- Dead letter queue cho message lỗi
- Nginx/API Gateway đứng trước các service
- Truyền correlation ID xuyên suốt các log

### ❓ Câu hỏi phỏng vấn
- Khi nào bạn **không** chọn microservices?
- Đặt hàng cần trừ kho, thanh toán, tạo vận đơn ở 3 service khác nhau; một bước lỗi thì sao? (Saga)
- Ghi DB xong rồi publish event thất bại thì sao? (Outbox)
- Message bị xử lý 2 lần thì sao? (idempotency)
- Kafka đảm bảo thứ tự message thế nào?
- Service B chậm làm service A treo theo, xử lý thế nào? (timeout, circuit breaker)
- Debug một request đi qua 5 service thế nào? (tracing)

---

## Giai đoạn 9: DevOps: Nginx, CI/CD, Cloud, Kubernetes, Observability (Tuần 14)

### Nginx
- [ ] Reverse proxy, load balancing (round robin, least_conn, ip_hash)
- [ ] Serve file tĩnh, gzip, cache header
- [ ] SSL/TLS (Let's Encrypt), proxy WebSocket

### CI/CD
- [ ] GitHub Actions: lint, type-check, test, build Docker image, push registry, deploy
- [ ] Quản lý secret, chiến lược theo môi trường (dev/staging/prod)
- [ ] Chiến lược deploy: rolling, **blue-green**, canary; rollback

### Cloud (AWS)
- [ ] EC2, S3 (+ presigned URL), RDS, ElastiCache, SQS/SNS, CloudFront (CDN), IAM, VPC (mức khái niệm)
- [ ] Lambda / serverless: khi nào dùng
- [ ] Biết các dịch vụ tương đương bên GCP/Azure

### Kubernetes (mức Middle: hiểu và đọc/viết được manifest cơ bản)
- [ ] Pod, ReplicaSet, Deployment, Service (ClusterIP/NodePort/LoadBalancer), Ingress
- [ ] ConfigMap, Secret, namespace
- [ ] Liveness/readiness probe, resource request/limit
- [ ] HPA (autoscaling), rolling update
- [ ] `kubectl` cơ bản; Helm (mức khái niệm)

### Observability
- [ ] **3 trụ cột:** Logs, Metrics, Traces
- [ ] Structured logging (JSON), tập trung log (ELK / Loki)
- [ ] Metrics: Prometheus + Grafana; RED/USE method
- [ ] Tracing: OpenTelemetry + Jaeger
- [ ] Alerting, SLI/SLO/SLA, health check endpoint
- [ ] Theo dõi lỗi: Sentry

### ✅ TaskFlow
- Pipeline CI: lint, test, build image, push GHCR
- Deploy lên VPS (docker compose + Nginx + SSL) **hoặc** K8s local (kind/minikube) với manifest đầy đủ
- Dashboard Grafana: request rate, latency, error rate
- Sentry cho cả frontend và backend

### ❓ Câu hỏi phỏng vấn
- Deploy thế nào để không có downtime?
- Readiness probe khác liveness probe thế nào?
- Production bị chậm lúc 2h sáng, bạn điều tra theo các bước nào?

---

## Giai đoạn 10: System Design, Thuật toán, Mock Interview (Tuần 15–16)

### System design (Middle chắc chắn có vòng này)
**Khung trả lời:** làm rõ yêu cầu (functional/non-functional) → ước lượng (QPS, storage) → API → data model → kiến trúc tổng thể → đào sâu chỗ nghẽn → trade-off.

- [ ] Load balancer, horizontal scaling, stateless service
- [ ] Caching nhiều tầng, CDN
- [ ] Database replication, sharding, chọn DB
- [ ] Message queue, async processing
- [ ] Rate limiting, consistent hashing
- [ ] So sánh strong consistency và eventual consistency

**Đề luyện:**
- [ ] URL shortener
- [ ] Rate limiter
- [ ] Chat app (1-1 và group, online status)
- [ ] Notification system
- [ ] News feed (fan-out on write và fan-out on read)
- [ ] Hệ thống đặt vé / flash sale (chống oversell)
- [ ] File upload/storage (giống Google Drive)
- [ ] **Thiết kế chính TaskFlow cho 1 triệu user**

### Thuật toán (LeetCode)
- [ ] Mỗi ngày 1–2 bài, tổng khoảng 80–120 bài Easy/Medium
- [ ] Chủ đề: array, string, hash map, two pointers, sliding window, stack/queue, binary search, linked list, tree (DFS/BFS), graph cơ bản, heap, dynamic programming cơ bản
- [ ] Danh sách gợi ý: **NeetCode 150** / Blind 75
- [ ] Luyện nói to cách suy nghĩ và phân tích độ phức tạp Big-O

### Mock interview
- [ ] Tự quay video khi trả lời các câu hỏi trong file này
- [ ] Phỏng vấn thử với bạn bè / Pramp / nhờ Claude đóng vai interviewer
- [ ] Live coding: viết API hoặc component trong 45 phút

---

## Bảo mật: học xuyên suốt

- [ ] **OWASP Top 10**
- [ ] XSS (stored, reflected, DOM) → escape, CSP
- [ ] CSRF → SameSite cookie, CSRF token
- [ ] SQL/NoSQL injection → parameterized query
- [ ] Broken access control / IDOR (sửa task của workspace khác bằng cách đổi ID)
- [ ] SSRF, path traversal
- [ ] Hash và mã hóa; HTTPS; quản lý secret (không commit `.env`)
- [ ] Rate limit, brute-force protection
- [ ] Bảo mật dependency (`npm audit`, Dependabot)
- [ ] Bảo mật file upload (kiểm tra loại file, kích thước, quét virus)

---

## Câu hỏi hành vi, CV & mẹo

### Câu hỏi hành vi (chuẩn bị theo mô hình **STAR**: Situation, Task, Action, Result)
- [ ] Dự án bạn tự hào nhất? Vai trò của bạn là gì?
- [ ] Bug khó nhất bạn từng xử lý?
- [ ] Một lần bất đồng với team/lead về kỹ thuật, bạn xử lý ra sao?
- [ ] Một lần mắc lỗi trên production?
- [ ] Bạn mentor junior / review code như thế nào?
- [ ] Làm sao ước lượng task? Khi bị trễ deadline thì làm gì?
- [ ] Vì sao nghỉ việc cũ / vì sao chọn công ty này?
- [ ] Mục tiêu trong 2–3 năm tới?

### CV cho vị trí Middle
- Mỗi dòng kinh nghiệm theo dạng **hành động + công nghệ + kết quả có số liệu** (ví dụ: *"Tối ưu query + thêm Redis cache, giảm p95 latency từ 800ms xuống 120ms"*)
- Đưa TaskFlow vào mục Projects: link GitHub + demo + sơ đồ kiến trúc
- Mọi thứ ghi trong CV phải trả lời được ít nhất 3 tầng câu hỏi "tại sao"

### Mẹo phỏng vấn
- Trả lời theo cấu trúc: **định nghĩa → ví dụ thực tế → trade-off**
- Không biết thì nói thật, rồi trình bày cách mình sẽ suy luận / tìm hiểu
- Luôn hỏi lại để làm rõ yêu cầu trước khi code hoặc thiết kế
- Chuẩn bị 2–3 câu hỏi ngược lại cho interviewer (về team, quy trình, tech stack)
- Mỗi tuần viết một ghi chú tóm tắt để ôn trước buổi phỏng vấn

---

## Tài liệu tham khảo

| Chủ đề | Tài liệu |
|---|---|
| JavaScript | javascript.info, *You Don't Know JS* |
| TypeScript | typescriptlang.org/docs, *Total TypeScript* (Matt Pocock), type-challenges |
| Node.js | nodejs.org/docs, *Node.js Design Patterns* |
| NestJS | docs.nestjs.com |
| React | react.dev, TkDodo's blog (React Query) |
| Next.js | nextjs.org/learn |
| PostgreSQL | use-the-index-luke.com, postgresqltutorial.com |
| Redis | redis.io/docs, Redis University |
| Docker / K8s | docs.docker.com, kubernetes.io/docs/tutorials |
| Microservices | microservices.io (Chris Richardson), *Building Microservices* (Sam Newman) |
| System design | *System Design Interview* (Alex Xu) tập 1 & 2, ByteByteGo, *Designing Data-Intensive Applications* |
| Thuật toán | neetcode.io, LeetCode |
| Security | OWASP Top 10, PortSwigger Web Security Academy |

---

## 📊 Theo dõi tiến độ

| Tuần | Giai đoạn | Trạng thái |
|---|---|---|
| 1–2 | JS/TS nâng cao + Networking/Git/Linux | ⬜ |
| 3–5 | Node.js + Docker | ⬜ |
| 6–7 | Database | ⬜ |
| 8 | Redis, Cache, Queue | ⬜ |
| 9–10 | React & Next.js | ⬜ |
| 11 | Clean Architecture, Testing | ⬜ |
| 12–13 | Microservices | ⬜ |
| 14 | DevOps, K8s, Observability | ⬜ |
| 15–16 | System Design, LeetCode, Mock | ⬜ |
| Xuyên suốt | Security, LeetCode hằng ngày | ⬜ |

> 💡 Đánh dấu `[x]` vào các checkbox khi hoàn thành. Commit file này lên GitHub để theo dõi tiến độ.
