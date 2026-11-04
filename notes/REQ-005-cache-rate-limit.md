# REQ-005: Cache và rate limiting (Redis, cache patterns, stampede, rate limit, distributed lock)

> Code liên quan: `apps/api/src/cache/*`, `apps/api/src/rate-limit/*`, `apps/api/src/redis/redis-lock.ts`, `apps/api/src/boards/boards.service.ts` (cache board detail), `apps/api/src/tasks/tasks.service.ts`, `apps/api/src/workspaces/members.service.ts` (invalidate), `apps/api/src/main.ts` (`trust proxy`), `apps/web/vite.config.ts` (`xfwd`)
> Roadmap: Phase 5 (Redis, Caching), Bảo mật (brute-force)

## Mục lục

1. [Redis là gì, vì sao nhanh](#1-redis-là-gì-vì-sao-nhanh)
2. [Các kiểu dữ liệu và use case](#2-các-kiểu-dữ-liệu-và-use-case)
3. [TTL, eviction, persistence, HA](#3-ttl-eviction-persistence-ha)
4. [Atomicity: pipeline, MULTI, Lua](#4-atomicity-pipeline-multi-lua)
5. [Cache patterns](#5-cache-patterns)
6. [Cache invalidation và nhất quán với DB](#6-cache-invalidation-và-nhất-quán-với-db)
7. [Stampede, penetration, avalanche](#7-stampede-penetration-avalanche)
8. [Distributed lock](#8-distributed-lock)
9. [Rate limiting](#9-rate-limiting)
10. [Client IP sau proxy](#10-client-ip-sau-proxy)
11. [Redis sập thì sao](#11-redis-sập-thì-sao)
12. [Luồng REQ-005 trong TaskFlow](#12-luồng-req-005-trong-taskflow)
13. [Câu hỏi phỏng vấn + đáp án mẫu](#13-câu-hỏi-phỏng-vấn--đáp-án-mẫu)
14. [Tự kiểm tra](#14-tự-kiểm-tra)

---

## 1. Redis là gì, vì sao nhanh

Redis là **in-memory data structure store**: key → value, value có thể là string, hash, list, set, sorted set, stream…

Vì sao nhanh (câu hỏi phỏng vấn kinh điển):

- **Dữ liệu trong RAM**: truy cập ~100 ns so với ~100 µs SSD.
- **Single-threaded command execution**: không cần lock giữa các lệnh, không context switch; **mỗi lệnh là atomic**.
- **I/O multiplexing** (`epoll`/`kqueue`): một thread phục vụ hàng chục nghìn connection, giống event loop của Node. Từ Redis 6 có I/O threads cho việc đọc/ghi socket, phần thực thi lệnh vẫn đơn luồng.
- Cấu trúc dữ liệu tối ưu (listpack, skiplist, intset) và protocol RESP đơn giản.

Hệ quả của single-thread: **một lệnh chậm chặn tất cả** (`KEYS *`, `SMEMBERS` trên set triệu phần tử, Lua script dài). Dùng `SCAN` thay `KEYS`, tránh "big key".

---

## 2. Các kiểu dữ liệu và use case

| Kiểu            | Lệnh tiêu biểu                        | Use case                                            | TaskFlow                                     |
| --------------- | ------------------------------------- | --------------------------------------------------- | -------------------------------------------- |
| **String**      | `GET/SET EX NX`, `INCR`               | Cache JSON, counter, lock                           | Cache board detail, lock, denylist (REQ-002) |
| **Hash**        | `HSET/HGETALL/HINCRBY`                | Object nhiều field, đếm theo field                  | Token bucket (`tokens`, `ts`)                |
| **List**        | `LPUSH/RPOP/BLPOP`                    | Queue đơn giản, recent items                        | (BullMQ dùng nội bộ, REQ-006)                |
| **Set**         | `SADD/SISMEMBER/SINTER`               | Tập không trùng, tag, online users                  |                                              |
| **Sorted Set**  | `ZADD/ZRANGEBYSCORE/ZREMRANGEBYSCORE` | Leaderboard, sliding window, delayed job            | Sliding window log cho auth                  |
| **Stream**      | `XADD/XREADGROUP`                     | Log append-only, consumer group                     |                                              |
| **Bitmap**      | `SETBIT/BITCOUNT`                     | Daily active users theo id                          |                                              |
| **HyperLogLog** | `PFADD/PFCOUNT`                       | Đếm phần tử phân biệt xấp xỉ (sai số ~0.81%, 12 KB) |                                              |
| **Pub/Sub**     | `PUBLISH/SUBSCRIBE`                   | Broadcast không lưu                                 | Socket.io adapter (REQ-008)                  |

**Đặt tên key**: `app:entity:id[:sub]`, ví dụ `tf:board:<boardId>`, `tf:rl:auth:<ip>`. Prefix chung giúp `SCAN MATCH`, tách môi trường và đặt quyền ACL.

---

## 3. TTL, eviction, persistence, HA

### 3.1 TTL và cách Redis xóa key hết hạn

- `SET k v EX 60` hoặc `EXPIRE k 60`. `TTL k` trả -1 (không hạn), -2 (không tồn tại).
- Xóa **lazy** (khi truy cập thấy hết hạn) + **active** (định kỳ lấy mẫu ngẫu nhiên key có TTL để xóa).

### 3.2 Eviction khi đầy `maxmemory`

| Policy                        | Hành vi                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| `noeviction`                  | Từ chối lệnh ghi (lỗi OOM). Mặc định. **Bắt buộc cho queue** (BullMQ, REQ-006): mất job là mất dữ liệu |
| `allkeys-lru` / `allkeys-lfu` | Xóa key ít dùng gần đây / ít dùng nhất. **Hợp cho cache thuần**                                        |
| `volatile-lru/lfu/ttl/random` | Chỉ xóa key có TTL                                                                                     |

TaskFlow dev dùng một Redis (`noeviction`) cho cả cache, rate limit và queue; mọi key cache đều có TTL. Production nên **tách Redis cache (allkeys-lru) và Redis queue (noeviction)**.

LRU của Redis là **xấp xỉ** (lấy mẫu `maxmemory-samples` key rồi xóa key cũ nhất trong mẫu), không duy trì linked list toàn cục.

### 3.3 Persistence

|                       | RDB (snapshot)                           | AOF (append-only file)                              |
| --------------------- | ---------------------------------------- | --------------------------------------------------- |
| Cách làm              | `fork()` rồi ghi toàn bộ dataset định kỳ | Ghi log mọi lệnh ghi, `fsync` mỗi giây (`everysec`) |
| Mất dữ liệu khi crash | Từ lần snapshot gần nhất (phút)          | ~1 giây                                             |
| File / restart        | Nhỏ, restart nhanh                       | Lớn hơn (có rewrite), replay chậm hơn               |

TaskFlow bật `--appendonly yes` (`docker-compose.yml`). Thực tế thường bật cả hai.

### 3.4 Replication, Sentinel, Cluster

- **Replication**: master → replica bất đồng bộ; replica phục vụ đọc. Failover có thể mất các ghi chưa kịp replicate.
- **Sentinel**: giám sát, tự promote replica khi master chết, client hỏi Sentinel để biết master mới.
- **Cluster**: chia 16384 **hash slot** cho nhiều master (sharding) + replica cho mỗi master. Lệnh nhiều key chỉ chạy khi các key cùng slot → dùng **hash tag** `{board:123}:a`, `{board:123}:b`.

---

## 4. Atomicity: pipeline, MULTI, Lua

|                                   | Giảm round-trip |                 Atomic                  | Đọc kết quả giữa chừng để quyết định  |
| --------------------------------- | :-------------: | :-------------------------------------: | :-----------------------------------: |
| **Pipeline**                      |       ✅        | ❌ (lệnh của client khác chen vào được) |                  ❌                   |
| **MULTI/EXEC**                    |       ✅        |         ✅ (chạy liền một khối)         | ❌ (chỉ có `WATCH` = optimistic lock) |
| **Lua script** (`EVAL`/`EVALSHA`) |       ✅        |                   ✅                    |                  ✅                   |

Rate limiter phải "đọc số lượng → quyết định → ghi" một cách nguyên tử, nên TaskFlow dùng **Lua** (`apps/api/src/rate-limit/rate-limit.scripts.ts`). ioredis `defineCommand` tự gửi `EVALSHA` và fallback `EVAL` khi script chưa được cache trên server.

> Lua chạy trên thread duy nhất của Redis: script phải ngắn.

---

## 5. Cache patterns

| Pattern                                   | Đọc                                      | Ghi                                        | Ưu                                                        | Nhược                                            |
| ----------------------------------------- | ---------------------------------------- | ------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------ |
| **Cache-aside** (lazy loading) — TaskFlow | App đọc cache; miss → đọc DB → ghi cache | App ghi DB rồi **xóa** cache               | Đơn giản, cache chỉ chứa thứ được đọc, cache sập vẫn chạy | Miss đầu tiên chậm; có cửa sổ stale              |
| **Read-through**                          | Thư viện/cache tự load từ DB khi miss    |                                            | Code app gọn                                              | Cần lớp cache hỗ trợ                             |
| **Write-through**                         |                                          | Ghi cache và DB **đồng bộ**                | Cache luôn mới                                            | Ghi chậm hơn; cache chứa cả dữ liệu không ai đọc |
| **Write-behind** (write-back)             |                                          | Ghi cache, DB được ghi **bất đồng bộ** sau | Ghi rất nhanh, gom batch                                  | Mất dữ liệu nếu cache chết trước khi flush       |
| **Refresh-ahead**                         | Làm mới trước khi hết hạn                |                                            | Không có miss cho key nóng                                | Tốn công làm mới key không ai đọc                |

### 5.1 Nên cache gì

- Đọc nhiều, ghi ít, tính toán/query tốn kém, chấp nhận stale ngắn.
- TaskFlow cache **board detail** (`GET /boards/:boardId`: 4 query + join assignee), được mở liên tục khi làm việc trên Kanban.
- **Không** cache: dữ liệu phân quyền dùng cho quyết định bảo mật (membership trong `WorkspaceAccessGuard` vẫn đọc DB), dữ liệu ghi liên tục, dữ liệu cá nhân hóa theo từng user (board detail giống nhau cho mọi member nên cache chung được).

### 5.2 Nhiều tầng cache

Browser (`Cache-Control`, TanStack Query) → CDN (asset tĩnh, REQ-009/010) → reverse proxy → **application cache (Redis)** → DB buffer cache (`shared_buffers`). Mỗi tầng có TTL và cách invalidate riêng.

---

## 6. Cache invalidation và nhất quán với DB

> "There are only two hard things in Computer Science: cache invalidation and naming things."

### 6.1 Update DB rồi xóa cache, hay xóa cache rồi update DB?

**Xóa cache trước, rồi update DB** (sai):

1. A xóa cache. 2. B đọc, miss, đọc DB (giá trị **cũ**), ghi cũ vào cache. 3. A update DB.
   → Cache chứa giá trị cũ **cho tới khi hết TTL**. Cửa sổ race rộng (bằng thời gian ghi DB).

**Update DB rồi xóa cache** (TaskFlow, khuyến nghị):

1. B đọc, miss, đọc DB (cũ). 2. A update DB. 3. A xóa cache. 4. B ghi cũ vào cache.
   → Vẫn có thể stale, nhưng đòi hỏi B đọc DB **trước** khi A ghi và ghi cache **sau** khi A xóa: một khe rất hẹp vì đọc thường nhanh hơn ghi.

Vì sao **xóa** chứ không **update** cache? Hai writer cập nhật cache theo thứ tự khác thứ tự commit DB sẽ để cache sai vĩnh viễn; xóa thì idempotent và lần đọc sau tự lấy giá trị mới.

### 6.2 Thu hẹp cửa sổ stale

- **TTL** là lưới an toàn cuối cùng: TaskFlow đặt 60 giây ± jitter, stale tệ nhất cũng tự hết.
- **Delayed double delete**: xóa, rồi xóa lần nữa sau vài trăm ms.
- **CDC** (Debezium đọc WAL) phát event invalidate: tách khỏi code app, không sót đường ghi nào.
- **Version trong key** (`board:123:v42`): ghi mới tăng version, key cũ tự chết theo TTL.

### 6.3 Ở đâu phải invalidate

Mọi đường ghi ảnh hưởng tới dữ liệu cache. Board detail chứa board, column, task và **tên assignee**, nên TaskFlow invalidate khi: đổi tên/xóa board, thêm/đổi tên/xóa column, tạo/sửa/move/xóa task, **xóa member** (task bị bỏ giao ở mọi board của workspace). Quên một đường là bug khó thấy: đây là lý do nhiều team dùng TTL ngắn hoặc CDC.

Invalidate chạy **sau khi transaction commit**; xóa bên trong transaction rồi transaction rollback thì vô hại, nhưng xóa trước commit thì reader khác có thể nạp lại dữ liệu cũ.

---

## 7. Stampede, penetration, avalanche

### 7.1 Cache stampede (thundering herd, dog-piling)

Một key **nóng** hết hạn → hàng nghìn request cùng miss → cùng query DB → DB quá tải.

Cách xử lý:

- **Mutex/lock khi rebuild** (TaskFlow): chỉ request lấy được lock (`SET lock NX PX`) mới đọc DB; các request khác chờ ngắn rồi đọc lại cache. Không lấy được cache sau thời gian chờ thì tự đọc DB (tránh treo).
- **Single-flight trong process**: gom các miss đồng thời của cùng một key trong một instance thành một Promise (TaskFlow cũng làm, rẻ hơn lock Redis).
- **Probabilistic early expiration** (XFetch): mỗi request có xác suất tự làm mới trước khi hết hạn, tăng dần khi gần TTL.
- **Stale-while-revalidate**: trả giá trị cũ, làm mới nền.

### 7.2 Cache penetration

Request liên tục cho key **không tồn tại** (id bịa) → luôn miss → luôn đánh DB. Thường do tấn công.

- **Cache null** (TaskFlow): lưu marker "không tồn tại" với TTL ngắn (10 giây).
- **Bloom filter**: tập xác suất "chắc chắn không có / có thể có", chặn id không tồn tại trước khi tới cache/DB.
- Validate input sớm (UUID sai định dạng bị chặn ở `ParseUUIDPipe`).

### 7.3 Cache avalanche

**Nhiều key hết hạn cùng lúc** (ví dụ cùng được nạp sau deploy với cùng TTL) hoặc Redis sập → DB nhận toàn bộ tải.

- **TTL jitter** (TaskFlow): TTL = 60s + random(0..15s).
- Warm-up dần, circuit breaker / rate limit trước DB, Redis HA.

---

## 8. Distributed lock

Khi nhiều instance cần đảm bảo "chỉ một bên làm việc X tại một thời điểm".

```
SET tf:lock:board:123 <token ngẫu nhiên> NX PX 3000     -- NX: chỉ set khi chưa có; PX: tự hết hạn
...làm việc...
EVAL "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end return 0"
```

- **TTL bắt buộc**: process giữ lock chết thì lock tự nhả, không deadlock.
- **Token ngẫu nhiên + compare-and-delete bằng Lua**: tránh nhả nhầm lock của người khác (A chạy quá TTL, lock hết hạn, B lấy lock, A xong việc gọi `DEL` sẽ xóa lock của B).
- Việc có thể chạy quá TTL → cần **gia hạn** (watchdog) hoặc chọn TTL dư.
- **Redlock** (lấy lock trên đa số N master độc lập) chống mất lock khi failover; bị Martin Kleppmann phê bình vì phụ thuộc giả định về thời gian (GC pause, clock drift). Khi lock bảo vệ **tính đúng đắn** (không chỉ hiệu năng), cần **fencing token**: số tăng dần đi kèm lock, storage từ chối ghi có token cũ.

TaskFlow dùng lock cho **stampede** (mục đích hiệu năng: lock hỏng chỉ làm vài request thừa đọc DB), nên một Redis + `SET NX PX` là đủ. Còn tính đúng đắn của dữ liệu thì đã do transaction/constraint của Postgres đảm bảo (REQ-004).

---

## 9. Rate limiting

### 9.1 Mục đích

Chống brute-force mật khẩu, credential stuffing, scraping, bảo vệ tài nguyên khỏi một client chiếm dụng, công bằng giữa các tenant, kiểm soát chi phí.

### 9.2 Thuật toán

| Thuật toán                             | Cách làm                                                            | Ưu                                     | Nhược                                                                    |
| -------------------------------------- | ------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| **Fixed window counter**               | `INCR rl:<key>:<phút hiện tại>` + `EXPIRE`                          | Rẻ nhất                                | **Burst ở biên**: 100 request lúc 0:59 + 100 lúc 1:00 = 200 trong 2 giây |
| **Sliding window log** (TaskFlow auth) | Sorted set lưu timestamp từng request; xóa phần cũ hơn cửa sổ, đếm  | **Chính xác**                          | Tốn bộ nhớ O(số request trong cửa sổ)                                    |
| **Sliding window counter**             | Ước lượng: `count_cur + count_prev × phần còn lại của cửa sổ trước` | Rẻ, khá chính xác                      | Xấp xỉ                                                                   |
| **Token bucket** (TaskFlow API)        | Bucket chứa tối đa C token, nạp r token/giây, mỗi request lấy 1     | Cho phép **burst** tới C, trung bình r | Hai tham số khó chọn hơn                                                 |
| **Leaky bucket**                       | Hàng đợi chảy ra với tốc độ cố định                                 | Làm **mượt** đầu ra                    | Request phải chờ / bị bỏ khi đầy                                         |

### 9.3 Chọn cho TaskFlow

- **Auth (`/auth/login`, `/auth/register`, `/auth/refresh`)**: sliding window log, **10 request / 60 giây / IP**. Chặt và chính xác vì đây là mục tiêu brute-force; lượng request thấp nên bộ nhớ không đáng kể.
- **API nghiệp vụ** (workspaces, members, boards, tasks): token bucket **capacity 60, refill 2 token/giây / user**. Kéo thả liên tục tạo burst ngắn, token bucket chấp nhận burst nhưng giới hạn trung bình.
- Key theo **user id** khi đã đăng nhập (công bằng giữa user sau cùng NAT), theo **IP** khi chưa đăng nhập.

### 9.4 Response

- **429 Too Many Requests** + `Retry-After: <giây>`.
- Header thông tin (theo draft IETF `RateLimit` header fields): `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`.
- Client nên tôn trọng `Retry-After` và retry với backoff.

### 9.5 Đặt rate limit ở đâu

| Tầng                        | Ví dụ                                  | Ghi chú                                        |
| --------------------------- | -------------------------------------- | ---------------------------------------------- |
| Edge / CDN / WAF            | Cloudflare, AWS WAF                    | Chặn DDoS volumetric trước khi vào hạ tầng     |
| API gateway / reverse proxy | Nginx `limit_req` (leaky bucket), Kong | Theo IP/route, không biết user                 |
| **Application** (TaskFlow)  | Guard + Redis                          | Biết user, tenant, route, có thể theo gói cước |

Ứng dụng chạy nhiều instance thì bộ đếm **phải ở chỗ dùng chung** (Redis); đếm trong memory từng instance sẽ cho phép N × limit.

---

## 10. Client IP sau proxy

Request đi qua nginx/Vite proxy thì `req.socket.remoteAddress` là IP của **proxy** → mọi user chung một bucket. Proxy gửi IP thật trong `X-Forwarded-For: client, proxy1, proxy2`.

- Express `app.set('trust proxy', ...)` quyết định có tin header này không. **Tin bừa** (`true`) thì client tự gửi `X-Forwarded-For: 1.2.3.4` để đổi IP mỗi request và lách rate limit.
- TaskFlow: `trust proxy = 'loopback, uniquelocal'`: chỉ tin header khi request tới từ localhost (Vite dev proxy) hoặc mạng private (nginx trong Docker network). Vite proxy bật `xfwd: true` để gửi header.

---

## 11. Redis sập thì sao

Thiết kế để Redis là **phụ thuộc mềm** ở chỗ có thể:

| Chức năng                       | Khi Redis lỗi                                                                                                 | Lý do                                                                                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cache board                     | **Bỏ qua cache**, đọc DB                                                                                      | Cache chỉ là tối ưu                                                                                                                                                                                                                                         |
| Rate limit                      | **Fail open** (cho qua, log warn)                                                                             | Không để Redis sập kéo theo cả API sập; đổi lại tạm mất bảo vệ brute-force                                                                                                                                                                                  |
| Denylist access token (REQ-002) | `AccessTokenService.verify` coi lỗi là token không hợp lệ → **mọi route cần đăng nhập trả 401** (fail closed) | Chọn an toàn thay vì khả dụng: token đã logout không được dùng lại. Hệ quả: với thiết kế hiện tại, Redis **vẫn là phụ thuộc cứng** của API đã đăng nhập. Muốn khả dụng hơn thì fail open ở denylist (rủi ro: token vừa logout còn dùng được tối đa 15 phút) |
| Queue (REQ-006)                 | Không enqueue được → API báo lỗi hoặc ghi outbox                                                              | Job là dữ liệu                                                                                                                                                                                                                                              |

Mỗi lệnh Redis của cache/rate limit đi với **timeout ngắn** (ioredis `commandTimeout`) để Redis treo không làm request treo theo. Đây là quyết định trade-off cần nói rõ khi phỏng vấn: fail open hay fail closed tùy chức năng bảo vệ cái gì.

---

## 12. Luồng REQ-005 trong TaskFlow

### 12.1 Đọc board detail

```
GET /workspaces/W/boards/B
 └─ BoardsService.detail → BoardCacheService.getOrLoad(W, B, loader)
      GET tf:board:B
        hit (JSON)             → kiểm tra workspaceId == W → trả
        hit ("null" marker)    → 404
        miss → single-flight trong process (Map<key, Promise>)
             → SET tf:lock:board:B <token> NX PX 3000
                 được lock  → loader() (4 query Postgres) → SET tf:board:B <json> EX 60+jitter → nhả lock
                 không được → chờ 50ms × tối đa 10 lần đọc lại cache → vẫn miss thì tự loader()
```

Key không chứa workspaceId, nên giá trị cache lưu kèm `workspaceId` và service so sánh: id board của workspace khác không bao giờ được trả nhầm (chống IDOR qua cache).

### 12.2 Invalidate

`BoardCacheService.invalidate(boardId)` / `invalidateWorkspace(workspaceId)` được gọi sau mọi ghi thành công trong `BoardsService`, `TasksService`, `MembersService.remove`.

### 12.3 Rate limit

```
@RateLimit('auth')  trên AuthController.register/login/refresh   → sliding window, theo IP
@RateLimit('api')   trên WorkspacesController, MembersController, BoardsController, TasksController
                    (guard ở cấp controller chạy sau JwtAuthGuard toàn cục → có req.user) → token bucket, theo user
```

Header trả về: `RateLimit-Limit`, `RateLimit-Remaining`, khi bị chặn thêm `Retry-After` và status 429.

### 12.4 Bản đồ file

| File                                                                      | Vai trò                                                                |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `apps/api/src/redis/redis-lock.ts`                                        | `acquireLock`/`releaseLock` (SET NX PX + Lua compare-and-delete)       |
| `apps/api/src/cache/board-cache.service.ts`                               | Cache-aside, single-flight, lock, null caching, TTL jitter, invalidate |
| `apps/api/src/rate-limit/rate-limit.scripts.ts`                           | Lua: sliding window log, token bucket                                  |
| `apps/api/src/rate-limit/rate-limit.service.ts`                           | Chạy script, fail open                                                 |
| `apps/api/src/rate-limit/rate-limit.guard.ts` + `rate-limit.decorator.ts` | Guard đọc policy từ metadata, set header, 429                          |
| `apps/api/src/rate-limit/rate-limit.policies.ts`                          | Định nghĩa policy `auth`, `api`                                        |

---

## 13. Câu hỏi phỏng vấn + đáp án mẫu

<details><summary><b>Q1. Vì sao Redis nhanh dù single-thread?</b></summary>

Dữ liệu nằm trong RAM, phần thực thi lệnh đơn luồng nên không tốn lock và context switch, I/O multiplexing bằng epoll cho phép một thread phục vụ rất nhiều connection, cấu trúc dữ liệu được tối ưu và protocol đơn giản. Bottleneck thường là network chứ không phải CPU. Mặt trái là một lệnh chậm như KEYS hay thao tác trên big key sẽ chặn mọi client, nên phải dùng SCAN và giữ Lua script ngắn.
</details>

<details><summary><b>Q2. Update DB rồi xóa cache, hay xóa cache rồi update DB? Tại sao?</b></summary>

Update DB rồi xóa cache. Xóa trước thì giữa lúc xóa và lúc ghi DB, một reader có thể miss, đọc giá trị cũ từ DB và nạp lại vào cache, cửa sổ race rộng bằng thời gian ghi. Update trước rồi xóa vẫn còn race nhưng hẹp hơn nhiều vì cần reader đọc DB trước lúc ghi và ghi cache sau lúc xóa. Em xóa chứ không update cache vì xóa idempotent, không bị lệch thứ tự giữa các writer. Kèm TTL làm lưới an toàn, và nếu cần chặt hơn thì delayed double delete hoặc CDC.
</details>

<details><summary><b>Q3. Một key hot hết hạn làm 10k request đổ vào DB, xử lý thế nào?</b></summary>

Đó là cache stampede. Em dùng lock khi rebuild: request đầu lấy SET NX PX, đọc DB và ghi cache; các request khác chờ ngắn rồi đọc lại cache, quá thời gian chờ thì tự đọc DB để không treo. Trong mỗi instance còn single-flight để các miss đồng thời chỉ tạo một lời gọi. Các cách khác: làm mới sớm theo xác suất (XFetch), stale-while-revalidate, hoặc key không bao giờ hết hạn mà được job nền làm mới.
</details>

<details><summary><b>Q4. Cache penetration và avalanche khác stampede thế nào?</b></summary>

Penetration là request cho key không tồn tại nên luôn miss và luôn chạm DB; xử lý bằng cache giá trị null với TTL ngắn, bloom filter, validate input. Avalanche là nhiều key hết hạn cùng lúc hoặc cả Redis sập; xử lý bằng TTL jitter, warm-up dần, HA cho Redis, rate limit hoặc circuit breaker trước DB. Stampede là một key nóng hết hạn.
</details>

<details><summary><b>Q5. Thiết kế rate limiter 100 request/phút/user.</b></summary>

Đặt ở tầng có thể nhận diện user (application hoặc gateway), lưu bộ đếm ở Redis để mọi instance dùng chung. Nếu cần chính xác thì sliding window log bằng sorted set: ZREMRANGEBYSCORE xóa timestamp cũ hơn 60 giây, ZCARD đếm, nhỏ hơn 100 thì ZADD, tất cả trong một Lua script để atomic, đặt PEXPIRE cho key. Nếu cần rẻ thì sliding window counter hoặc token bucket capacity 100, refill 100/60 token mỗi giây. Trả 429 kèm Retry-After và header RateLimit. Quyết định fail open hay fail closed khi Redis lỗi, và lấy IP đúng sau proxy nếu limit theo IP.
</details>

<details><summary><b>Q6. Fixed window có vấn đề gì?</b></summary>

Burst ở biên cửa sổ: client gửi đủ limit ở cuối cửa sổ trước và đủ limit ở đầu cửa sổ sau, thực tế gấp đôi limit trong một khoảng ngắn. Sliding window log hoặc sliding window counter khắc phục.
</details>

<details><summary><b>Q7. Implement distributed lock bằng Redis thế nào? Có vấn đề gì?</b></summary>

SET key token NX PX ttl, token ngẫu nhiên; nhả bằng Lua so sánh token rồi mới DEL để không nhả lock của người khác. TTL để process chết không giữ lock mãi. Vấn đề: việc chạy quá TTL thì hai bên cùng giữ lock, nên cần gia hạn; failover master có thể mất lock chưa replicate; Redlock giảm rủi ro nhưng vẫn dựa vào giả định thời gian. Khi lock bảo vệ tính đúng đắn thì cần fencing token để storage từ chối ghi cũ, hoặc dùng ràng buộc của DB. Em chỉ dùng Redis lock cho mục đích hiệu năng như chống stampede.
</details>

<details><summary><b>Q8. Redis sập thì hệ thống của bạn ra sao?</b></summary>

Tùy chức năng. Cache: bỏ qua và đọc DB, latency tăng nhưng vẫn đúng. Rate limit: fail open để Redis không thành single point of failure cho cả API, chấp nhận tạm mất bảo vệ. Denylist token: fail closed vì là chức năng bảo mật. Queue: không enqueue được thì báo lỗi hoặc ghi outbox trong DB để gửi lại sau. Lệnh Redis có timeout ngắn để không kéo request treo theo. Production dùng Sentinel hoặc Cluster để có failover.
</details>

<details><summary><b>Q9. RDB và AOF khác nhau thế nào?</b></summary>

RDB là snapshot định kỳ bằng fork, file nhỏ, restart nhanh nhưng mất dữ liệu từ lần snapshot gần nhất. AOF ghi log mọi lệnh ghi, fsync mỗi giây thì mất tối đa khoảng một giây, file lớn hơn và replay chậm hơn, có rewrite để nén. Thường bật cả hai; Redis thuần cache thì có thể tắt persistence.
</details>

<details><summary><b>Q10. Pipeline, MULTI và Lua khác nhau thế nào?</b></summary>

Pipeline chỉ gom nhiều lệnh vào một round-trip, không atomic. MULTI/EXEC chạy một khối lệnh liền nhau, atomic nhưng không đọc được kết quả giữa chừng để rẽ nhánh, chỉ có WATCH để optimistic lock. Lua script chạy atomic trên server và có logic điều kiện, phù hợp cho rate limiter và compare-and-delete khi nhả lock.
</details>

<details><summary><b>Q11. Rate limit theo IP sau load balancer gặp vấn đề gì?</b></summary>

Server thấy IP của proxy nên mọi người chung một bucket. Phải đọc X-Forwarded-For, nhưng chỉ tin header khi request đến từ proxy tin cậy, nếu không client tự giả header để đổi IP. Trong Express là cấu hình trust proxy theo danh sách mạng. Ngoài ra nhiều user sau cùng NAT chung IP, nên với user đã đăng nhập em limit theo user id.
</details>

---

## 14. Tự kiểm tra

- [ ] Giải thích vì sao Redis nhanh và hệ quả của single-thread
- [ ] Mỗi kiểu dữ liệu Redis một use case
- [ ] Các eviction policy; vì sao queue cần `noeviction`
- [ ] RDB và AOF; replication, Sentinel, Cluster, hash tag
- [ ] So sánh pipeline, MULTI, Lua
- [ ] 5 cache pattern và trade-off
- [ ] Vẽ race của "xóa cache trước" và "update DB trước"
- [ ] Stampede, penetration, avalanche và cách chống mỗi loại
- [ ] Lock bằng `SET NX PX` + Lua; fencing token; Redlock
- [ ] 5 thuật toán rate limit, burst ở biên
- [ ] Vì sao `trust proxy = true` nguy hiểm
- [ ] Fail open và fail closed: chọn theo chức năng

### 🛠 Bài tập thực hành

1. `docker compose exec redis redis-cli MONITOR`, mở một board hai lần: lần 1 thấy `SET tf:lock…`, `SET tf:board…`; lần 2 chỉ có `GET`. Sửa một task: thấy `DEL tf:board…`.
2. Gọi `POST /auth/login` 11 lần trong 1 phút (`for i in $(seq 11); do curl -i …; done`), xem `RateLimit-Remaining` giảm dần và lần 11 nhận 429 + `Retry-After`. Xem key bằng `ZRANGE tf:rl:auth:<ip> 0 -1 WITHSCORES`.
3. `docker compose stop redis`, gọi `POST /auth/login` với mật khẩu sai: vẫn nhận 401 chứ không phải 429/500 (rate limit fail open, có log warn). Gọi `GET /boards/:id` với access token hợp lệ: nhận **401** vì denylist fail closed. Thảo luận: nên giữ hay đổi sang fail open? Khởi động lại Redis.
4. Tạm bỏ lock trong `BoardCacheService`, bắn 200 request song song vào một board vừa invalidate (`xargs -P 50`), đếm số query board trong log Prisma; bật lock lại và so sánh.
5. Viết fixed window counter bằng `INCR` + `EXPIRE` trong redis-cli, chứng minh burst ở biên.
