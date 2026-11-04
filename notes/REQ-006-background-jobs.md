# REQ-006: Job nền (queue, BullMQ, retry/backoff, idempotency, cron, email)

> Code liên quan: `apps/api/src/jobs/*`, `apps/api/src/mail/*`, `apps/api/src/invitations/*`, `apps/api/src/worker.ts`, `apps/api/prisma/schema.prisma` (`Invitation`, `Task.reminderSentFor`), `docker-compose.yml` (Mailpit, service `worker`)
> Roadmap: Phase 5 (Job queue: BullMQ), chuẩn bị cho Phase 8 (message broker, outbox)

## Mục lục

1. [Vì sao cần job nền](#1-vì-sao-cần-job-nền)
2. [Job queue và message broker](#2-job-queue-và-message-broker)
3. [BullMQ hoạt động thế nào](#3-bullmq-hoạt-động-thế-nào)
4. [Retry, backoff, jitter, dead letter](#4-retry-backoff-jitter-dead-letter)
5. [Delivery semantics và idempotency](#5-delivery-semantics-và-idempotency)
6. [Dual write: enqueue sau khi commit](#6-dual-write-enqueue-sau-khi-commit)
7. [Cron và scheduled job trong hệ phân tán](#7-cron-và-scheduled-job-trong-hệ-phân-tán)
8. [Concurrency, rate limit của worker, tách worker process](#8-concurrency-rate-limit-của-worker-tách-worker-process)
9. [Graceful shutdown](#9-graceful-shutdown)
10. [Email và invitation token](#10-email-và-invitation-token)
11. [Luồng REQ-006 trong TaskFlow](#11-luồng-req-006-trong-taskflow)
12. [Câu hỏi phỏng vấn + đáp án mẫu](#12-câu-hỏi-phỏng-vấn--đáp-án-mẫu)
13. [Tự kiểm tra](#13-tự-kiểm-tra)

---

## 1. Vì sao cần job nền

Những việc **không nên** làm trong request HTTP:

- **Chậm** hoặc **phụ thuộc bên ngoài**: gửi email qua SMTP (100 ms tới vài giây, có thể timeout), gọi webhook, xử lý ảnh, export PDF.
- **Có thể thất bại tạm thời** và cần retry: provider email 503, rate limit của bên thứ ba.
- **Theo lịch**: nhắc deadline, dọn dữ liệu hết hạn, báo cáo hằng ngày.
- **CPU-bound**: chặn event loop của Node (phase 3), nên đẩy sang worker process khác.

Lợi ích: response nhanh (trả 201 ngay sau khi lưu DB), **tách lỗi** (SMTP chết không làm API chết), **retry tự động**, **làm phẳng tải** (burst 10k email được xử lý dần với tốc độ cố định), scale worker độc lập với API.

Cái giá: **eventual consistency** (email đến sau vài giây), thêm thành phần phải giám sát, phải nghĩ về trùng lặp và thứ tự.

---

## 2. Job queue và message broker

|                  | Job/task queue (BullMQ, Sidekiq, Celery)                    | Message broker (RabbitMQ, Kafka)                        |
| ---------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| Đơn vị           | **Job**: "hãy làm việc X với dữ liệu Y"                     | **Message/event**: "điều X đã xảy ra"                   |
| Người nhận       | Thường một loại worker của chính ứng dụng                   | Nhiều consumer/service khác nhau (pub/sub, routing)     |
| Tính năng sẵn có | Retry, backoff, delay, cron, priority, progress, rate limit | Routing (exchange), consumer group, replay (Kafka), ack |
| Lưu trữ          | Redis (BullMQ)                                              | Broker riêng, log bền (Kafka)                           |
| Dùng khi         | Việc nền **trong một service**                              | Giao tiếp **giữa các service** (REQ-012)                |

TaskFlow dùng BullMQ cho REQ-006 vì đã có Redis và việc nền nằm gọn trong API. REQ-012 sẽ tách notification service và dùng RabbitMQ.

---

## 3. BullMQ hoạt động thế nào

### 3.1 Thành phần

- **Queue**: phía producer, `queue.add(name, data, opts)` ghi job vào Redis.
- **Worker**: phía consumer, lấy job, chạy hàm processor, báo completed/failed.
- **QueueEvents**: lắng nghe sự kiện (completed, failed, progress) qua Redis Streams.
- **Job scheduler**: tạo job lặp theo cron/interval.

### 3.2 Trạng thái job và cấu trúc Redis

```
add ──▶ wait (list) ──▶ active (list) ──▶ completed (zset)
  │                        │
  └─ delay ─▶ delayed (zset, score = thời điểm chạy)
                           └─ lỗi ─▶ retry? ─ có ─▶ delayed (backoff)
                                           └ không ─▶ failed (zset)
```

- Mỗi job là một **hash** `bull:<queue>:<id>` chứa data, opts, số lần thử, stacktrace.
- Chuyển trạng thái bằng **Lua script** nên nguyên tử: hai worker không thể cùng lấy một job.
- Worker giữ **lock** trên job đang chạy và gia hạn định kỳ. Worker chết (crash, OOM) thì lock hết hạn → job bị coi là **stalled** và được đưa lại `wait` → chạy lại. Đây là lý do job phải **idempotent** (mục 5).
- Vì dữ liệu queue nằm trong Redis: cần `maxmemory-policy noeviction` (REQ-005) và persistence AOF, nếu không Redis tự xóa key là **mất job**.

### 3.3 Kết nối

Worker dùng lệnh blocking (`BZPOPMIN`) nên cần **connection riêng** và `maxRetriesPerRequest: null` (ioredis không được bỏ cuộc giữa lúc chờ). TaskFlow tạo connection riêng cho queue/worker, không dùng chung với `RedisService` (vốn có `commandTimeout` 1 giây cho cache).

---

## 4. Retry, backoff, jitter, dead letter

### 4.1 Lỗi tạm thời và lỗi vĩnh viễn

| Loại          | Ví dụ                                                     | Xử lý                                                                                                   |
| ------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| **Transient** | SMTP timeout, 503, mất mạng, deadlock                     | Retry                                                                                                   |
| **Permanent** | Email không hợp lệ, invitation đã bị thu hồi, dữ liệu sai | **Không** retry: kết thúc job (TaskFlow: processor `return` sớm, ghi log) hoặc ném `UnrecoverableError` |

### 4.2 Backoff

- **Fixed**: chờ cố định giữa các lần.
- **Exponential**: `delay = base × 2^(attempt-1)`: 2s, 4s, 8s, 16s. Cho hệ thống phía sau thời gian phục hồi.
- **Jitter**: thêm ngẫu nhiên để các job thất bại cùng lúc không retry cùng lúc (thundering herd). REQ-004 đã đo: thiếu jitter thì 4/10 transaction thất bại.
- TaskFlow: `attempts: 5`, `backoff: { type: 'exponential', delay: 2000, jitter: 0.5 }`. Tổng thời gian chờ tối đa ~30 giây.

### 4.3 Dead letter

Job hết lượt thử vào tập **failed** (`removeOnFail` giữ 7 ngày). Đây là "dead letter queue" của BullMQ: dùng để điều tra, retry thủ công (`job.retry()`), cảnh báo khi số failed tăng. RabbitMQ có **DLX** (dead letter exchange) tương đương.

### 4.4 Dọn dẹp

`removeOnComplete: { age: 3600, count: 1000 }`: không để Redis phình vì job đã xong. Job data có thể chứa **dữ liệu nhạy cảm** (TaskFlow: invitation token) nên càng không nên giữ lâu.

---

## 5. Delivery semantics và idempotency

| Semantics         | Ý nghĩa                         | Cách đạt                                                                                  |
| ----------------- | ------------------------------- | ----------------------------------------------------------------------------------------- |
| **At-most-once**  | Không bao giờ trùng, có thể mất | Đánh dấu "đã xử lý" **trước** khi làm, không retry                                        |
| **At-least-once** | Không mất, có thể trùng         | Ack/đánh dấu **sau** khi làm, có retry. **BullMQ mặc định** (stalled job chạy lại)        |
| **Exactly-once**  | Không mất, không trùng          | Trong hệ phân tán thực tế là **at-least-once + idempotent consumer** ("effectively once") |

### 5.1 Idempotent consumer

Chạy một job 2 lần cho kết quả như chạy 1 lần. Kỹ thuật:

1. **Dedupe ở producer**: `jobId` xác định (deterministic). BullMQ bỏ qua `add` khi đã có job cùng id. TaskFlow: `invitation-<invitationId>`, `reminder-<taskId>-<dueDate ms>` (BullMQ không cho `:` trong custom id).
2. **Kiểm tra trạng thái trước khi làm**: worker invitation bỏ qua invitation đã accept/revoke/hết hạn; worker reminder bỏ qua nếu `reminderSentFor = dueDate` hoặc due date đã đổi.
3. **Ghi đánh dấu có điều kiện sau khi làm**: `UPDATE tasks SET reminder_sent_for = $due WHERE id = $id AND due_date = $due` (conditional write như REQ-003/004).
4. **Idempotency key ở bên thứ ba**: nhiều provider (Stripe, một số email API) nhận `Idempotency-Key` header để tự loại trùng.

### 5.2 Khe hở còn lại

Gửi email xong nhưng crash **trước** khi ghi `reminderSentFor` → job chạy lại → email gửi **2 lần**. Với email nhắc việc, trùng hiếm hoi chấp nhận được hơn là mất (chọn at-least-once). Với thanh toán thì phải có idempotency key phía provider.

---

## 6. Dual write: enqueue sau khi commit

Tạo invitation cần 2 việc: **ghi DB** và **enqueue job**. Hai hệ thống khác nhau, không có transaction chung:

- Enqueue **trong** transaction rồi transaction rollback → worker gửi email cho invitation không tồn tại.
- Commit DB rồi enqueue lỗi (Redis tạm sập) → invitation tồn tại nhưng **không bao giờ gửi email**.

TaskFlow: **commit trước, enqueue sau**; worker kiểm tra invitation tồn tại và còn hiệu lực. Nếu enqueue lỗi, API trả lỗi 503 nhưng invitation đã có, admin có thể tạo lại (tạo mới sẽ thu hồi cái cũ).

Giải pháp đầy đủ là **Transactional Outbox** (REQ-012): ghi event vào bảng `outbox` **cùng transaction** với dữ liệu; một relay đọc outbox và publish lên queue/broker, đánh dấu đã gửi. Đảm bảo at-least-once mà không cần distributed transaction (2PC).

---

## 7. Cron và scheduled job trong hệ phân tán

### 7.1 Vấn đề

`setInterval` hoặc `node-cron` trong API: chạy **3 instance** thì job chạy **3 lần**. Instance restart thì mất lịch.

### 7.2 Cách giải

| Cách                                           | Ý tưởng                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Scheduler tập trung trong queue** (TaskFlow) | `queue.upsertJobScheduler(id, { pattern })`: BullMQ lưu lịch trong Redis, chỉ tạo **một** job mỗi kỳ dù bao nhiêu instance gọi upsert |
| Leader election / distributed lock             | Chỉ instance giữ lock mới chạy cron (REQ-005 lock)                                                                                    |
| Cron ngoài hệ thống                            | Kubernetes `CronJob`, EventBridge Scheduler gọi endpoint/command                                                                      |
| DB-based                                       | `SELECT … FOR UPDATE SKIP LOCKED` trên bảng job (pg-boss, Graphile Worker)                                                            |

### 7.3 Thiết kế job nhắc deadline (scan + fan-out)

1. Job `scan-due-tasks` chạy theo cron (mặc định mỗi 5 phút): một query SQL tìm task có `due_date` trong 24 giờ tới, có assignee, và `reminder_sent_for IS DISTINCT FROM due_date`.
2. Với mỗi task, enqueue job `deadline-reminder` với `jobId` xác định → scan chạy lại nhiều lần cũng không nhân bản job.
3. Worker gửi email, rồi đánh dấu `reminder_sent_for = due_date`.

Đổi due date → `reminder_sent_for` khác `due_date` → sẽ được nhắc lại cho hạn mới. Lưu **timestamp UTC** (`timestamptz`/`TIMESTAMP(3)` UTC trong Prisma), chỉ đổi múi giờ khi hiển thị.

`IS DISTINCT FROM` khác `<>` ở chỗ xử lý NULL: `NULL <> x` là NULL (không đúng), `NULL IS DISTINCT FROM x` là true. Query viết bằng `prisma.$queryRaw` (tagged template, tham số được bind, **không** nối chuỗi nên không bị SQL injection).

---

## 8. Concurrency, rate limit của worker, tách worker process

- `concurrency: 5`: một worker xử lý tối đa 5 job song song (I/O-bound như email thì tăng được; CPU-bound thì dùng sandboxed processor hoặc nhiều process).
- `limiter: { max: 10, duration: 1000 }`: tối đa 10 job/giây **trên toàn queue** (mọi worker), để không vượt rate limit của SMTP provider.
- **Tách worker process** (TaskFlow: `apps/api/src/worker.ts`, `npm run start:worker`, service `worker` trong docker-compose):
  - API và worker scale độc lập (nhiều email → thêm worker, nhiều request → thêm API).
  - Job nặng không làm chậm request HTTP; deploy/restart worker không ảnh hưởng API.
  - Cùng codebase (Nest application context không mở HTTP). Biến `RUN_WORKERS` quyết định process nào chạy worker; dev để `true` để chỉ cần một lệnh.

---

## 9. Graceful shutdown

Khi nhận `SIGTERM` (deploy, scale down), worker phải:

1. **Ngừng lấy job mới**.
2. **Chờ job đang chạy xong** (hoặc tới timeout).
3. Đóng connection Redis, DB.

`worker.close()` của BullMQ làm bước 1–2. TaskFlow gọi trong `onModuleDestroy` (Nest `enableShutdownHooks`). Nếu bị `SIGKILL` giữa chừng, job thành **stalled** và được chạy lại: lại là lý do phải idempotent. Kubernetes cho `terminationGracePeriodSeconds` (mặc định 30s) trước khi `SIGKILL`.

---

## 10. Email và invitation token

### 10.1 Email

- Dev: **Mailpit** (SMTP giả ở cổng 1025, giao diện xem thư http://localhost:8025). Không bao giờ gửi email thật khi dev.
- Production: SES, SendGrid, Postmark… Deliverability cần **SPF** (IP nào được gửi cho domain), **DKIM** (chữ ký), **DMARC** (chính sách khi fail), và xử lý bounce/complaint.
- Escape dữ liệu người dùng trong HTML email (tên workspace có thể chứa `<script>`), giống XSS (REQ-002).

### 10.2 Invitation token

Cùng cách làm với refresh token (REQ-002):

- Token **ngẫu nhiên 32 byte** (`randomBytes`), chỉ gửi trong email; DB lưu **SHA-256 hash**.
- Có hạn (7 ngày), dùng **một lần** (`acceptedAt`), thu hồi được (`revokedAt`). Accept bằng **conditional update** `WHERE accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()` để hai lần bấm đồng thời không tạo hai membership.
- Chỉ user đăng nhập bằng **đúng email được mời** mới accept được: link lộ ra ngoài cũng vô dụng với người khác.
- Token đi trong **body POST** (`/invitations/accept`), không nằm trong URL của API, để không lọt vào access log; trang web `/invitations/:token` thì phải có token trên URL (link từ email) nên đặt `Referrer-Policy: no-referrer` (helmet mặc định).

---

## 11. Luồng REQ-006 trong TaskFlow

### 11.1 Endpoint

| Method | Path                                                 | Permission                     | Ghi chú                                                                     |
| ------ | ---------------------------------------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| POST   | `/workspaces/:workspaceId/invitations`               | `member:add` + `canAssignRole` | Tạo, thu hồi lời mời cũ cùng email, enqueue email. Email đã là member → 409 |
| GET    | `/workspaces/:workspaceId/invitations`               | `member:add`                   | Lời mời còn hiệu lực                                                        |
| DELETE | `/workspaces/:workspaceId/invitations/:invitationId` | `member:add`                   | Thu hồi                                                                     |
| POST   | `/invitations/lookup` `{ token }`                    | đăng nhập                      | Xem trước: tên workspace, role, người mời                                   |
| POST   | `/invitations/accept` `{ token }`                    | đăng nhập, đúng email          | Tạo membership trong transaction                                            |

### 11.2 Sơ đồ

```
POST /workspaces/W/invitations {email, role}
  ├─ transaction: revoke lời mời cũ cùng email; insert invitations(token_hash, expires_at)
  └─ sau commit: emailQueue.add('invitation', {invitationId, token}, {jobId: 'invitation-<id>'})
                     │
Worker (email queue, concurrency 5, limiter 10/s, attempts 5, exponential backoff + jitter)
  ├─ invitation còn hiệu lực? không → bỏ qua (permanent)
  └─ MailService.send → SMTP (Mailpit) ── lỗi → retry 2s, 4s, 8s, 16s → failed (dead letter)

Job scheduler 'scan-due-tasks' (cron REMINDER_CRON)
  └─ $queryRaw: due trong 24h, có assignee, reminder_sent_for IS DISTINCT FROM due_date
       └─ với mỗi task: emailQueue.add('deadline-reminder', {taskId, dueDate}, {jobId: 'reminder-<id>-<ms>'})
            └─ Worker: còn đúng due date và chưa gửi? → gửi → UPDATE … SET reminder_sent_for = due_date WHERE due_date = $due
```

### 11.3 Bản đồ file

| File                                        | Vai trò                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apps/api/src/jobs/queue.constants.ts`      | Tên queue, tên job, kiểu dữ liệu job                                                 |
| `apps/api/src/jobs/queues.service.ts`       | Tạo Queue, connection riêng, default job options, scheduler cron, enqueue có `jobId` |
| `apps/api/src/jobs/email.worker.ts`         | Worker queue email: invitation, deadline reminder                                    |
| `apps/api/src/jobs/reminder-scan.worker.ts` | Worker quét task sắp tới hạn                                                         |
| `apps/api/src/mail/mail.service.ts`         | Nodemailer SMTP + escape HTML                                                        |
| `apps/api/src/invitations/*`                | Endpoint và nghiệp vụ lời mời                                                        |
| `apps/api/src/worker.ts`                    | Entry point chỉ chạy worker                                                          |

---

## 12. Câu hỏi phỏng vấn + đáp án mẫu

<details><summary><b>Q1. Khi nào nên đưa việc vào job nền?</b></summary>

Khi việc đó chậm, phụ thuộc hệ thống ngoài, có thể lỗi tạm thời cần retry, chạy theo lịch, hoặc nặng CPU. Ví dụ gửi email: request chỉ lưu DB và enqueue rồi trả về ngay, worker gửi email và tự retry nếu SMTP lỗi. Đổi lại phải chấp nhận eventual consistency và xử lý trùng lặp.
</details>

<details><summary><b>Q2. Retry thế nào cho đúng?</b></summary>

Chỉ retry lỗi tạm thời, lỗi vĩnh viễn như dữ liệu sai thì dừng ngay. Dùng exponential backoff để hệ thống phía sau có thời gian phục hồi và thêm jitter để các job lỗi cùng lúc không retry cùng lúc. Giới hạn số lần, hết lượt thì đưa vào dead letter để điều tra và cảnh báo. Và processor phải idempotent vì retry nghĩa là có thể chạy lại phần đã làm.
</details>

<details><summary><b>Q3. At-least-once, at-most-once, exactly-once khác nhau thế nào? Làm sao "exactly-once"?</b></summary>

At-most-once đánh dấu trước khi làm nên có thể mất, at-least-once đánh dấu sau khi làm và retry nên có thể trùng. Exactly-once thực tế đạt bằng at-least-once cộng idempotent consumer: dedupe bằng job id xác định, kiểm tra trạng thái trước khi làm, ghi kết quả có điều kiện, hoặc idempotency key ở bên thứ ba. Vẫn còn khe nhỏ giữa side effect bên ngoài và lúc ghi đánh dấu, nên chọn hướng nào tùy việc mất hay trùng tệ hơn.
</details>

<details><summary><b>Q4. Ghi DB rồi publish message, nếu publish lỗi thì sao?</b></summary>

Đó là dual write. Commit rồi publish lỗi thì mất message; publish trong transaction rồi rollback thì message trỏ tới dữ liệu không tồn tại. Giải pháp chuẩn là transactional outbox: ghi event vào bảng outbox cùng transaction với dữ liệu, một relay đọc outbox và publish, đánh dấu đã gửi, consumer idempotent vì relay có thể gửi trùng. Hiện tại em commit trước rồi enqueue, worker kiểm tra dữ liệu còn hợp lệ, và chấp nhận trường hợp hiếm phải tạo lại lời mời.
</details>

<details><summary><b>Q5. Chạy cron trong app có 3 instance thì sao?</b></summary>

Job chạy 3 lần. Cần một nơi điều phối: job scheduler của BullMQ lưu lịch trong Redis và chỉ sinh một job mỗi kỳ, hoặc leader election bằng distributed lock, hoặc đưa cron ra ngoài như Kubernetes CronJob. Dù vậy job vẫn nên idempotent vì có thể bị chạy lại.
</details>

<details><summary><b>Q6. Worker đang xử lý job thì bị kill, chuyện gì xảy ra?</b></summary>

Worker giữ lock trên job và gia hạn định kỳ. Bị kill thì lock hết hạn, BullMQ phát hiện job stalled và đưa về hàng đợi để worker khác chạy lại. Vì vậy job phải idempotent. Khi deploy thì graceful shutdown: bắt SIGTERM, worker.close() ngừng nhận job mới và chờ job đang chạy xong trong grace period.
</details>

<details><summary><b>Q7. Vì sao BullMQ cần Redis noeviction và connection riêng?</b></summary>

Job là dữ liệu, nếu Redis eviction xóa key thì mất job. Worker dùng lệnh blocking để chờ job nên chiếm connection, và cần maxRetriesPerRequest null để ioredis không hủy lệnh đang chờ. Production nên tách Redis cho queue khỏi Redis cache.
</details>

<details><summary><b>Q8. Thiết kế tính năng nhắc deadline.</b></summary>

Lưu due date UTC. Một scheduled job định kỳ quét các task có due date trong cửa sổ sắp tới, có assignee và chưa nhắc cho đúng due date này (cột reminder_sent_for IS DISTINCT FROM due_date). Mỗi task được enqueue một job với id xác định theo task và due date để quét nhiều lần không nhân bản. Worker kiểm tra lại, gửi email, rồi ghi reminder_sent_for có điều kiện. Đổi due date thì tự động được nhắc lại. Quét theo batch có LIMIT và index trên due_date khi dữ liệu lớn.
</details>

<details><summary><b>Q9. Job queue khác message broker thế nào? Khi nào dùng Kafka?</b></summary>

Job queue mô hình hóa việc cần làm, có sẵn retry, delay, cron, thường trong một service. Message broker mô hình hóa sự kiện cho nhiều consumer, có routing và consumer group. Kafka là log bền, giữ message lâu, consumer tự quản offset nên replay được, throughput rất cao, giữ thứ tự trong partition; hợp event streaming, analytics, event sourcing. RabbitMQ hợp routing phức tạp và work queue với ack từng message.
</details>

<details><summary><b>Q10. Làm sao giới hạn tốc độ gửi email theo giới hạn của provider?</b></summary>

Dùng rate limiter của queue (BullMQ limiter max/duration áp dụng cho toàn queue, mọi worker), kết hợp concurrency cho từng worker. Gặp 429 từ provider thì coi là lỗi tạm thời và retry với backoff, hoặc dùng rate limit động theo header Retry-After.
</details>

---

## 13. Tự kiểm tra

- [ ] Kể 4 loại việc nên đưa vào job nền
- [ ] So sánh job queue và message broker
- [ ] Vẽ vòng đời job trong BullMQ, giải thích stalled job
- [ ] Phân biệt lỗi transient và permanent; exponential backoff + jitter
- [ ] 3 delivery semantics; 4 kỹ thuật idempotent consumer
- [ ] Giải thích dual write và transactional outbox
- [ ] Vì sao cron trong app nhiều instance bị chạy trùng, 4 cách giải
- [ ] `IS DISTINCT FROM` khác `<>` thế nào
- [ ] Graceful shutdown của worker
- [ ] Vì sao lưu hash của invitation token, vì sao token đi trong body

### 🛠 Bài tập thực hành

1. Mời một email, mở http://localhost:8025 xem thư; bấm link, đăng ký đúng email đó, accept. Thử accept bằng tài khoản email khác: 403.
2. `docker compose stop mailpit`, tạo lời mời, xem log worker retry với khoảng cách tăng dần; `docker compose start mailpit` trước lượt thử thứ 5 và thấy thư tới.
3. Đặt `REMINDER_CRON='*/10 * * * * *'`, tạo task due sau 2 giờ có assignee, chờ thư nhắc. Chờ thêm vài chu kỳ: không có thư thứ 2. Đổi due date: có thư mới.
4. Trong `redis-cli`: `KEYS bull:email:*`, `ZRANGE bull:email:completed 0 -1`, `HGETALL bull:email:<id>` để thấy job lưu thế nào.
5. Chạy hai process `npm run start:worker`, xác nhận job scheduler vẫn chỉ sinh một job scan mỗi kỳ.
