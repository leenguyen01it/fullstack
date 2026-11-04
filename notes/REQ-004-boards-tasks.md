# REQ-004: Board, task, kéo thả, phân trang, tìm kiếm (REST, index, EXPLAIN, isolation, locking)

> Code liên quan: `apps/api/src/boards/*`, `apps/api/src/tasks/*`, `apps/api/src/prisma/prisma.service.ts` (`serializable`), `apps/api/prisma/schema.prisma` (`Board`, `BoardColumn`, `Task`), migration `*_boards_tasks`, `packages/shared/src/fractional-index.ts`, `packages/shared/src/index.ts`
> Roadmap: Phase 4 (Database), Phase 3 (API design)

## Mục lục

1. [Thiết kế REST API](#1-thiết-kế-rest-api)
2. [Mô hình dữ liệu board/column/task](#2-mô-hình-dữ-liệu-boardcolumntask)
3. [Thứ tự khi kéo thả: fractional indexing](#3-thứ-tự-khi-kéo-thả-fractional-indexing)
4. [Index trong PostgreSQL](#4-index-trong-postgresql)
5. [Đọc EXPLAIN ANALYZE](#5-đọc-explain-analyze)
6. [Phân trang: offset và cursor](#6-phân-trang-offset-và-cursor)
7. [Transaction isolation level và MVCC](#7-transaction-isolation-level-và-mvcc)
8. [Locking: optimistic, pessimistic, atomic update](#8-locking-optimistic-pessimistic-atomic-update)
9. [N+1 query](#9-n1-query)
10. [Tìm kiếm: LIKE, pg_trgm, full-text search, search engine](#10-tìm-kiếm-like-pg_trgm-full-text-search-search-engine)
11. [Luồng REQ-004 trong TaskFlow](#11-luồng-req-004-trong-taskflow)
12. [Câu hỏi phỏng vấn + đáp án mẫu](#12-câu-hỏi-phỏng-vấn--đáp-án-mẫu)
13. [Tự kiểm tra](#13-tự-kiểm-tra)

---

## 1. Thiết kế REST API

### 1.1 Nguyên tắc đặt URL

- **Danh từ số nhiều** cho collection, id cho phần tử: `/boards`, `/boards/:boardId`. Động từ nằm ở **HTTP method**, không ở URL (`POST /boards`, không phải `/createBoard`).
- **Lồng resource theo quan hệ sở hữu**, nhưng không quá 2–3 cấp. TaskFlow: `/workspaces/:workspaceId/boards/:boardId/columns/:columnId`. Riêng task dùng `/workspaces/:workspaceId/tasks/:taskId` chứ không lồng dưới board/column, vì task **đổi column** khi kéo thả: URL không nên đổi khi resource di chuyển.
- Giữ `:workspaceId` trong path vì nó là **tenant**: `WorkspaceAccessGuard` (REQ-003) kiểm tra membership một lần cho mọi route.
- **Action không phải CRUD**: mô hình hóa thành sub-resource dạng động từ, ví dụ `POST /tasks/:taskId/move`. Thực dụng hơn là ép vào `PATCH` với ngữ nghĩa phức tạp.

### 1.2 Method, safe, idempotent

| Method | Ngữ nghĩa                 | Safe |    Idempotent     | TaskFlow               |
| ------ | ------------------------- | :--: | :---------------: | ---------------------- |
| GET    | Đọc                       |  ✅  |        ✅         | list, detail, search   |
| POST   | Tạo / action              |      |        ❌         | tạo board/task, `move` |
| PUT    | Thay **toàn bộ** resource |      |        ✅         | (không dùng)           |
| PATCH  | Sửa **một phần**          |      | ❌ (về lý thuyết) | đổi tên, sửa task      |
| DELETE | Xóa                       |      |        ✅         | xóa board/column/task  |

- **Idempotent**: gọi N lần cho kết quả trên server như gọi 1 lần. Quan trọng khi client/proxy **retry** do timeout. `DELETE` lần 2 trả 404 nhưng trạng thái server không đổi, vẫn là idempotent.
- `POST /tasks` gọi 2 lần tạo 2 task. Chống trùng bằng **Idempotency-Key** header (server lưu key → response trong vài giờ), học ở REQ-005/006.
- `PATCH` với optimistic lock (`version`) trở thành an toàn để retry: lần 2 nhận 409 thay vì ghi đè.

### 1.3 Status code dùng trong REQ-004

`200` đọc/sửa · `201` tạo · `204` xóa · `400` input sai (Zod, cursor hỏng, assignee không phải member) · `403` thiếu quyền · `404` không thấy **trong workspace này** · `409` xung đột (sửa trên version cũ, xóa column còn task, move hết lượt retry).

### 1.4 Response cho list

- Không trả mảng trần cho endpoint có phân trang: trả object `{ items, total, page, pageSize }` hoặc `{ items, nextCursor }` để thêm metadata mà không phá client.
- Filter/sort/paging đi qua **query string**: `GET /tasks?q=login&assigneeId=...&limit=20&cursor=...`. Validate query bằng Zod như body.

---

## 2. Mô hình dữ liệu board/column/task

```
workspaces 1──N boards 1──N board_columns 1──N tasks N──1 users (assignee, creator)
     └───────────────────────────────────────────N tasks.workspace_id
```

| Bảng            | Cột chính                                                                                             | Ràng buộc / index                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `boards`        | id, workspace_id, name, created_at                                                                    | `INDEX (workspace_id, created_at, id)` cho list có phân trang                                                                       |
| `board_columns` | id, board_id, name, position                                                                          | `UNIQUE (board_id, position)`                                                                                                       |
| `tasks`         | id, workspace_id, column_id, title, description, position, version, assignee_id, creator_id, due_date | `UNIQUE (column_id, position)`, `INDEX (workspace_id, created_at DESC, id DESC)`, `INDEX (assignee_id)`, `GIN (title gin_trgm_ops)` |

### 2.1 Vì sao `tasks.workspace_id` (denormalize có chủ đích)

`workspace_id` suy ra được qua `column → board → workspace`, nên lưu thêm là **vi phạm 3NF**. Lý do vẫn lưu:

- **Tenant key trên mọi bảng** (REQ-003, multi-tenancy): mọi query task đều có `WHERE workspace_id = ?` mà không cần join 2 bảng; chặn IDOR đơn giản: `findFirst({ where: { id, workspaceId } })`.
- Cho phép index `(workspace_id, created_at, id)` phục vụ search + cursor pagination trong một workspace.

Cái giá: phải giữ nhất quán. TaskFlow đảm bảo bằng luật **task chỉ di chuyển giữa các column của cùng board**, nên `workspace_id` của task không bao giờ đổi sau khi tạo.

### 2.2 `ON DELETE`: CASCADE, RESTRICT và NO ACTION

- `board_columns.board_id`: `CASCADE` (xóa board thì xóa column).
- `tasks.column_id`: **`NO ACTION`**: không cho xóa column còn task. API trả 409 "Column still has tasks". Đây là ràng buộc ở DB nên đúng cả khi có người thêm task đúng lúc đang xóa column.
- `tasks.workspace_id`: `CASCADE`. `tasks.assignee_id`, `creator_id`: `SET NULL`.

**RESTRICT khác NO ACTION**: RESTRICT kiểm tra **ngay** khi dòng cha bị xóa; NO ACTION kiểm tra **cuối câu lệnh** (và có thể `DEFERRABLE` tới cuối transaction). Khi xóa workspace, Postgres cascade cùng lúc sang `board_columns` và `tasks`; với NO ACTION, đến cuối câu lệnh task đã bị xóa nên không còn vi phạm. Với RESTRICT, thứ tự cascade có thể làm câu lệnh fail.

Xóa board: cascade xóa column, nhưng task chỉ trỏ tới column (không trỏ board) nên NO ACTION sẽ chặn. Vì vậy service xóa task của board trước rồi xóa board, **trong một transaction**.

---

## 3. Thứ tự khi kéo thả: fractional indexing

Bài toán: lưu thứ tự task trong column sao cho **kéo một task chỉ ghi đúng một dòng**.

| Cách                                       | Kéo thả ghi bao nhiêu dòng                 | Vấn đề                                                                             |
| ------------------------------------------ | ------------------------------------------ | ---------------------------------------------------------------------------------- |
| `position INT` 0,1,2,…                     | O(n): phải tăng position mọi task phía sau | Nhiều lock, nhiều conflict khi nhiều người kéo                                     |
| `position INT` cách nhau 1000              | 1, đến khi hết khe                         | Phải **rebalance** (đánh số lại) định kỳ                                           |
| `position FLOAT`, lấy trung bình           | 1                                          | Sau ~50 lần chèn vào cùng một khe thì hết độ chính xác double, cũng phải rebalance |
| Linked list (`prev_id`)                    | 2–3                                        | Đọc theo thứ tự phải đi tuần tự / recursive CTE, khó `ORDER BY`                    |
| **Fractional index dạng chuỗi** (TaskFlow) | **1**                                      | Key dài dần nếu chèn liên tục vào cùng một khe (thường vài ký tự)                  |

### 3.1 Ý tưởng

Position là chuỗi so sánh theo **thứ tự từ điển** (giống số thập phân không có phần nguyên: `0.5` nằm giữa `0.4` và `0.6`, giữa `0.4` và `0.41` có `0.405`…). Luôn tìm được chuỗi nằm giữa hai chuỗi bất kỳ, không bao giờ "hết chỗ".

`generateKeyBetween(a, b)` trong `packages/shared/src/fractional-index.ts` (port thuật toán của David Greenspan, dùng bởi Figma/Rocicorp):

- `generateKeyBetween(null, null)` → `"a0"` (task đầu tiên)
- `generateKeyBetween("a0", null)` → `"a1"` (thêm cuối: tăng **phần nguyên**, key không dài ra)
- `generateKeyBetween("a0", "a1")` → `"a0V"` (chèn giữa: thêm **phần thập phân**)
- `generateKeyBetween(null, "a0")` → `"Zz"` (thêm đầu)

Key gồm **phần nguyên** (ký tự đầu cho biết độ dài: `a` = 1 chữ số, `b` = 2, …; `Z`, `Y`… cho số âm) và **phần thập phân** base-62 (`0-9A-Za-z`), không có số 0 ở cuối.

### 3.2 Collation: bẫy rất dễ dính

Thuật toán giả định so sánh **theo byte** (`'Z' < 'a'` vì mã ASCII 90 < 97). Nhưng DB TaskFlow có collation `en_US.utf8`, sắp xếp theo ngôn ngữ (gần như không phân biệt hoa thường), khi đó `"Zz"` có thể đứng **sau** `"a0"` → thứ tự sai.

Sửa: khai báo cột `position TEXT COLLATE "C"` (so sánh byte) trong migration. Prisma schema không mô tả được collation nên phải sửa tay file SQL; Prisma không so sánh collation khi diff nên không bị coi là drift.

> Bài học chung: `ORDER BY` trên `TEXT` phụ thuộc collation; index B-tree cũng được build theo collation của cột. Đừng để logic sắp xếp ở app và ở DB khác nhau.

### 3.3 Concurrency khi kéo thả

Hai người cùng thả task vào **cùng một khe** (sau task X): cả hai đọc cùng hàng xóm → cùng tính ra một key. TaskFlow phòng thủ 2 lớp:

1. `UNIQUE (column_id, position)`: DB không cho hai task trùng key.
2. Transaction **SERIALIZABLE** + **retry** tối đa 5 lần, có **backoff ngẫu nhiên** (jitter) giữa các lần: lần thử sau đọc lại hàng xóm (đã thấy task kia) và tính key mới.

Kết quả đo trong TaskFlow: 10 request move song song vào cùng một khe, retry 3 lần liền nhau không chờ → 4/10 nhận 409 (các bên retry cùng lúc nên lại va nhau). Thêm jitter `random × 20ms × 2^attempt` và 5 lần → 10/10 thành công, 10 position khác nhau. Đây là lý do mọi retry policy (HTTP client, queue, transaction) đều nên có **exponential backoff + jitter**.

---

## 4. Index trong PostgreSQL

### 4.1 Các loại index

| Loại                           | Dùng cho                                                                     | TaskFlow                                         |
| ------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------ |
| **B-tree** (mặc định)          | `=`, `<`, `>`, `BETWEEN`, `ORDER BY`, prefix `LIKE 'abc%'` (với collation C) | Mọi PK, unique, `(workspace_id, created_at, id)` |
| **Hash**                       | Chỉ `=`                                                                      | Hiếm khi cần                                     |
| **GIN** (Generalized Inverted) | Phần tử bên trong giá trị: mảng, JSONB, `tsvector`, trigram                  | `title gin_trgm_ops`                             |
| **GiST**                       | Hình học, range, nearest-neighbor, cũng làm được trigram                     |                                                  |
| **BRIN**                       | Bảng rất lớn, dữ liệu tương quan với thứ tự vật lý (log theo thời gian)      |                                                  |

### 4.2 Composite index và leftmost prefix

Index `(workspace_id, created_at DESC, id DESC)` được sắp theo `workspace_id` trước, trong cùng workspace theo `created_at` giảm dần, rồi `id`.

- `WHERE workspace_id = ? ORDER BY created_at DESC, id DESC LIMIT 21`: ✅ đi thẳng tới đoạn của workspace, đọc 21 entry đầu, **không cần sort**.
- `WHERE workspace_id = ? AND (created_at, id) < (?, ?)`: ✅ (cursor pagination).
- `WHERE created_at > ?` không có `workspace_id`: ❌ không dùng hiệu quả (thiếu cột trái nhất).

**Thứ tự cột**: cột so sánh bằng (`=`) đặt trước, cột range/sort đặt sau.

### 4.3 Covering index, partial index, expression index

- **Covering** (`INCLUDE (title)`): index chứa đủ cột cần đọc → **Index Only Scan**, không phải đọc heap (cần visibility map đã được VACUUM).
- **Partial** (`WHERE deleted_at IS NULL`): index nhỏ, chỉ chứa dòng hay query.
- **Expression** (`ON lower(email)`): khi query dùng hàm trên cột.

### 4.4 Khi nào index **không** được dùng

- Bọc cột trong hàm: `WHERE lower(title) = 'x'` không dùng index trên `title` (cần expression index).
- `LIKE '%abc'` / `'%abc%'` với B-tree: không có prefix cố định để nhảy tới → cần **trigram** (mục 10).
- Ép kiểu ngầm, so sánh khác kiểu.
- **Độ chọn lọc thấp**: điều kiện khớp 30% bảng thì seq scan rẻ hơn (đọc tuần tự nhanh hơn random I/O).
- Bảng quá nhỏ: planner chọn seq scan, **đúng**. Đừng kết luận "index vô dụng" khi test với 10 dòng.
- Thống kê cũ: chạy `ANALYZE` (autovacuum thường lo).

### 4.5 Cái giá của index

Mỗi `INSERT/UPDATE/DELETE` phải cập nhật mọi index liên quan; tốn dung lượng; GIN ghi đặc biệt chậm (dùng `fastupdate` pending list). Chỉ tạo index cho query **có thật**, kiểm chứng bằng `EXPLAIN`.

---

## 5. Đọc EXPLAIN ANALYZE

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, title FROM tasks
WHERE workspace_id = '...' ORDER BY created_at DESC, id DESC LIMIT 21;
```

```
Limit  (cost=0.42..3.10 rows=21 width=...) (actual time=0.031..0.060 rows=21 loops=1)
  ->  Index Scan using tasks_workspace_id_created_at_id_idx on tasks  (cost=... rows=5000 ...) (actual ... rows=21 loops=1)
        Index Cond: (workspace_id = '...'::uuid)
        Buffers: shared hit=24
Planning Time: 0.2 ms
Execution Time: 0.09 ms
```

- `EXPLAIN` chỉ là **kế hoạch ước lượng**; `ANALYZE` **chạy thật** (cẩn thận với `UPDATE/DELETE`: bọc trong `BEGIN … ROLLBACK`).
- `cost=startup..total`: đơn vị tương đối của planner, không phải ms.
- `rows` ước lượng và `actual rows`: lệch lớn → thống kê sai → kế hoạch dở.
- `loops`: node chạy bao nhiêu lần (nested loop); thời gian thực = actual time × loops.
- `Buffers: shared hit` (từ cache) và `read` (từ đĩa).

| Node                                     | Nghĩa                                                                                                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Seq Scan**                             | Đọc toàn bảng                                                                                                                                               |
| **Index Scan**                           | Duyệt index rồi đọc heap từng dòng theo thứ tự index                                                                                                        |
| **Index Only Scan**                      | Chỉ đọc index (covering)                                                                                                                                    |
| **Bitmap Index Scan + Bitmap Heap Scan** | Gom vị trí từ index thành bitmap rồi đọc heap theo thứ tự vật lý; dùng khi khớp nhiều dòng hoặc kết hợp nhiều index (`BitmapAnd/Or`); GIN luôn đi đường này |
| **Sort**                                 | Có sort → index không phục vụ được `ORDER BY`                                                                                                               |
| Nested Loop / Hash Join / Merge Join     | 3 chiến lược join                                                                                                                                           |

**Quy trình debug query chậm**: tìm query (log `log_min_duration_statement`, `pg_stat_statements`) → `EXPLAIN ANALYZE` → tìm node tốn nhất, ước lượng lệch, Seq Scan trên bảng lớn, Sort trên nhiều dòng → thêm/sửa index hoặc viết lại query → đo lại.

---

## 6. Phân trang: offset và cursor

### 6.1 Offset (`LIMIT 20 OFFSET 40`)

TaskFlow dùng cho **danh sách board** (`?page=3&pageSize=20`, trả `total`).

- ✅ Nhảy tới trang bất kỳ, hiện "Trang 3/10".
- ❌ **Chậm khi offset lớn**: DB vẫn phải đọc và bỏ qua 40.000 dòng để trả trang 2001.
- ❌ **Lệch dữ liệu**: có dòng mới chèn lên đầu khi đang xem trang 1 → trang 2 lặp lại một dòng; có dòng bị xóa → bỏ sót.
- ❌ `COUNT(*)` trên bảng lớn tốn kém (Postgres không lưu sẵn số dòng vì MVCC).
- Thứ tự phải **xác định** (deterministic): `ORDER BY created_at DESC, id DESC`. Chỉ `created_at` thì các dòng trùng thời gian có thể đổi chỗ giữa các trang.

Đếm và lấy trang chạy bằng `prisma.$transaction([count, findMany])`. Lưu ý: ở Read Committed, **mỗi câu lệnh có snapshot riêng**, nên `total` và `items` vẫn có thể lệch nhau nếu có ghi xen giữa. Chấp nhận được cho UI.

### 6.2 Cursor / keyset (`WHERE (created_at, id) < (?, ?)`)

TaskFlow dùng cho **search task** (`?cursor=...&limit=20`, trả `nextCursor`).

- ✅ Hiệu năng ổn định ở mọi độ sâu: index nhảy thẳng tới vị trí cursor.
- ✅ Không lặp/sót khi có dòng mới chèn.
- ❌ Không nhảy tới trang N; chỉ "tải thêm" (infinite scroll, REQ-007).
- Cursor = giá trị các cột sort của **dòng cuối trang**, cộng `id` để phá hòa. Mã hóa **opaque** (base64url của JSON) để client không phụ thuộc cấu trúc và server đổi được cách sort.
- Lấy `limit + 1` dòng: có dòng thừa nghĩa là còn trang sau, không cần `COUNT`.
- Prisma không có so sánh row-value `(a, b) < (x, y)`, nên viết dạng tương đương: `created_at < x OR (created_at = x AND id < y)`.

> Prisma có option `cursor` + `skip: 1` dựa trên một field unique. TaskFlow tự viết keyset để thấy rõ cơ chế và để cursor không phụ thuộc dòng đó còn tồn tại.

### 6.3 Đo thực tế trên TaskFlow (50.000 task trong một workspace)

```
-- keyset: WHERE workspace_id = ? AND created_at < ? ORDER BY created_at DESC, id DESC LIMIT 21
Index Only Scan using tasks_workspace_id_created_at_id_idx  (actual rows=21)      Execution Time: 0.055 ms

-- offset: ... ORDER BY created_at DESC, id DESC LIMIT 21 OFFSET 40000
Index Only Scan using tasks_workspace_id_created_at_id_idx  (actual rows=40021)   Execution Time: 4.182 ms

-- search: WHERE workspace_id = ? AND title ILIKE '%abc12%'
Bitmap Index Scan on tasks_title_idx (actual rows=3) → Bitmap Heap Scan, Recheck Cond  Execution Time: 1.060 ms
```

- Cả hai cách phân trang đều dùng cùng index, nhưng offset phải **đọc 40.021 entry rồi bỏ 40.000**; keyset chỉ đọc 21. Chênh lệch tăng tuyến tính theo độ sâu trang.
- Search `%…%` đi qua **GIN trigram** dù wildcard ở đầu, sau đó `Recheck Cond` kiểm tra lại điều kiện thật; `workspace_id` là `Filter` sau đó và có `Sort` vì kết quả ít.

---

## 7. Transaction isolation level và MVCC

### 7.1 Các hiện tượng (anomaly)

| Hiện tượng              | Mô tả                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dirty read**          | Đọc dữ liệu transaction khác **chưa commit**                                                                                                                                           |
| **Non-repeatable read** | Đọc cùng một dòng 2 lần trong một transaction, lần 2 khác vì có người commit sửa                                                                                                       |
| **Phantom read**        | Chạy cùng một `WHERE` 2 lần, lần 2 có thêm/bớt dòng                                                                                                                                    |
| **Lost update**         | Hai transaction đọc–sửa–ghi cùng một dòng, cái ghi sau đè mất cái trước                                                                                                                |
| **Write skew**          | Hai transaction đọc cùng tập dữ liệu, mỗi bên ghi vào **dòng khác nhau** dựa trên điều đã đọc, kết quả chung vi phạm ràng buộc (ví dụ: 2 bác sĩ cùng xin nghỉ vì "vẫn còn người trực") |

### 7.2 Bốn mức theo chuẩn SQL và thực tế Postgres

| Level                            | Dirty  | Non-repeatable |         Phantom          | Postgres thực tế                                                                                         |
| -------------------------------- | :----: | :------------: | :----------------------: | -------------------------------------------------------------------------------------------------------- |
| Read Uncommitted                 | có thể |     có thể     |          có thể          | Postgres xử lý **như Read Committed**                                                                    |
| **Read Committed** (mặc định PG) |   ❌   |     có thể     |          có thể          | Mỗi **câu lệnh** một snapshot mới                                                                        |
| **Repeatable Read**              |   ❌   |       ❌       | có thể (chuẩn) / ❌ (PG) | **Snapshot Isolation**: cả transaction dùng một snapshot. Ghi đè dòng đã bị người khác sửa → lỗi `40001` |
| **Serializable**                 |   ❌   |       ❌       |            ❌            | **SSI**: theo dõi phụ thuộc đọc–ghi, phát hiện cả write skew → lỗi `40001`                               |

MySQL InnoDB mặc định là **Repeatable Read** (dùng gap lock để chặn phantom), khác Postgres.

### 7.3 MVCC (Multi-Version Concurrency Control)

- `UPDATE` không ghi đè tại chỗ mà tạo **phiên bản mới** của dòng; mỗi phiên bản có `xmin`/`xmax` (transaction tạo/xóa).
- Mỗi transaction đọc theo **snapshot**: chỉ thấy phiên bản đã commit trước snapshot.
- Hệ quả: **reader không chặn writer, writer không chặn reader**. Hai writer trên **cùng một dòng** thì vẫn chặn nhau (row lock).
- Phiên bản cũ thành "dead tuple", được **VACUUM** dọn. Transaction mở quá lâu làm VACUUM không dọn được → bảng phình (bloat).

### 7.4 Serializable trong TaskFlow

`PrismaService.serializable(fn)` chạy `fn` trong `$transaction(fn, { isolationLevel: Serializable })` và **retry** khi gặp:

- `P2034`: Prisma báo serialization failure / deadlock (Postgres `40001`, `40P01`).
- `P2002`: unique violation trên `(column_id, position)` (hai bên tính ra cùng một key).

Dùng cho **move task** và **tạo task** (đều đọc vị trí hàng xóm rồi ghi). Nguyên tắc khi dùng Serializable:

- **Phải có retry**: lỗi serialization là chuyện bình thường, không phải bug.
- Transaction **ngắn**, không gọi I/O ngoài, vì có thể chạy lại nhiều lần.
- Tỷ lệ abort tăng khi contention cao → giới hạn số lần retry rồi trả 409.

---

## 8. Locking: optimistic, pessimistic, atomic update

### 8.1 Lost update khi hai người sửa một task

A và B cùng mở form task (title "Login"). A đổi thành "Login page", B sửa description rồi lưu form có title cũ "Login" → thay đổi của A mất.

### 8.2 Optimistic locking (TaskFlow)

Cột `version INT`. Client gửi `version` đã đọc kèm request sửa:

```sql
UPDATE tasks SET title = ?, version = version + 1
WHERE id = ? AND workspace_id = ? AND version = ?;   -- 0 dòng → 409 Conflict
```

- Không giữ lock trong lúc user đang gõ (có thể vài phút).
- Hợp khi xung đột **hiếm** (task app). Client nhận 409 thì tải lại, cho user merge.
- Chuẩn HTTP tương đương: `ETag` + `If-Match` header, server trả **412 Precondition Failed**. TaskFlow đặt `version` trong body cho đơn giản.
- Move **không** tăng `version`: vị trí và nội dung là hai mối quan tâm độc lập, kéo thả không nên làm form sửa nội dung của người khác bị 409.

### 8.3 Pessimistic locking

```sql
BEGIN;
SELECT * FROM inventory WHERE id = 1 FOR UPDATE;  -- khóa dòng, người khác phải chờ
UPDATE inventory SET stock = stock - 1 WHERE id = 1;
COMMIT;
```

- Hợp khi xung đột **thường xuyên** và đoạn giữ lock ngắn (trừ tồn kho, số dư).
- `FOR UPDATE NOWAIT` (fail ngay), `SKIP LOCKED` (bỏ qua dòng đang bị khóa, dùng làm job queue trên Postgres).
- Prisma không có API `FOR UPDATE`, phải dùng `$queryRaw` trong interactive transaction.

### 8.4 Atomic update: thường là đáp án tốt nhất

```sql
UPDATE inventory SET stock = stock - 1 WHERE id = 1 AND stock > 0;  -- 0 dòng → hết hàng
```

Không đọc–rồi–ghi ở app, nên không có khe race. Prisma: `update({ data: { stock: { decrement: 1 } } })` + điều kiện.

### 8.5 Deadlock

T1 khóa dòng A rồi chờ B; T2 khóa B rồi chờ A. Postgres phát hiện sau `deadlock_timeout` (1s) và abort một bên (`40P01`). Phòng tránh: **luôn khóa theo cùng một thứ tự** (ví dụ theo id tăng dần), giữ transaction ngắn, retry.

---

## 9. N+1 query

```ts
const boards = await prisma.board.findMany(); // 1 query
for (const b of boards) {
  b.columns = await prisma.boardColumn.findMany({ where: { boardId: b.id } }); // N query
}
```

100 board → 101 round-trip. Dấu hiệu: log SQL lặp cùng một câu với id khác nhau; latency tăng tuyến tính theo số phần tử.

Cách sửa:

- **Eager loading** (`include`/`select` lồng nhau). Prisma mặc định chạy **một query cho mỗi cấp quan hệ** với `WHERE board_id IN (...)`: board detail của TaskFlow (board → columns → tasks → assignee) là ~4 query **bất kể** có bao nhiêu column/task.
- **JOIN** (Prisma `relationLoadStrategy: 'join'` dùng `LATERAL` + JSON, một query duy nhất).
- **DataLoader** (GraphQL): gom các lời gọi `load(id)` trong một tick thành một `WHERE id IN (...)`.
- Aggregation tại DB (`_count`, `GROUP BY`) thay vì đếm trong vòng lặp.

Đánh đổi: JOIN một-nhiều nhiều cấp làm **nhân bản dữ liệu** dòng cha (cartesian), nên nhiều ORM chọn "query theo cấp" như Prisma.

---

## 10. Tìm kiếm: LIKE, pg_trgm, full-text search, search engine

| Cách                                         | Tìm được                                                                         | Index                                        | Hạn chế                                                                                                |
| -------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ILIKE 'abc%'`                               | Prefix                                                                           | B-tree (collation C hoặc `text_pattern_ops`) | Chỉ prefix                                                                                             |
| `ILIKE '%abc%'` + **pg_trgm** (TaskFlow)     | Chuỗi con bất kỳ, gõ sai nhẹ (`similarity`)                                      | **GIN `gin_trgm_ops`**                       | Query < 3 ký tự kém hiệu quả; không hiểu ngữ nghĩa                                                     |
| **Full-text** (`tsvector`, `tsquery`)        | Theo **từ**, có stemming ("running" khớp "run"), ranking (`ts_rank`), stop words | GIN trên `tsvector`                          | Không tìm chuỗi con giữa từ; tiếng Việt không có dictionary stemming sẵn (dùng config `simple`)        |
| **Elasticsearch / OpenSearch / Meilisearch** | Fuzzy, typo tolerance, facet, ranking phức tạp, scale riêng                      | Inverted index phân tán                      | Thêm hệ thống phải vận hành, dữ liệu **eventual consistency** với DB (đồng bộ qua CDC/outbox, REQ-012) |

### 10.1 Trigram hoạt động thế nào

`pg_trgm` cắt chuỗi thành các bộ 3 ký tự: `"login"` → `"  l", " lo", "log", "ogi", "gin", "in "`. GIN index map mỗi trigram → danh sách dòng. Query `%ogi%` lấy các dòng chứa trigram `"ogi"` rồi **recheck** điều kiện thật (Bitmap Heap Scan + Recheck Cond).

### 10.2 Vì sao TaskFlow chọn trigram

Tiêu đề task ngắn, người dùng gõ một phần từ ("auth" tìm "OAuth callback"), cần tìm chuỗi con và không phân biệt hoa thường. Full-text theo từ không làm được chuỗi con giữa từ. Khi cần tìm trong description dài và ranking theo độ liên quan thì thêm `tsvector`, khi lên hàng triệu task và cần typo tolerance thì tách ra search engine.

### 10.3 Escape wildcard

Prisma `contains: q` sinh `ILIKE '%' || q || '%'` nhưng **không escape** `%` và `_` trong `q`. User gõ `%` sẽ khớp mọi thứ. TaskFlow escape `\`, `%`, `_` trước khi truyền vào.

---

## 11. Luồng REQ-004 trong TaskFlow

### 11.1 Permission mới (RBAC + ABAC)

| Permission                                                               | OWNER | ADMIN |                   MEMBER                   |
| ------------------------------------------------------------------------ | :---: | :---: | :----------------------------------------: |
| `board:read`                                                             |  ✅   |  ✅   |                     ✅                     |
| `board:create`, `board:update` (đổi tên, quản lý column), `board:delete` |  ✅   |  ✅   |                                            |
| `task:read`, `task:create`, `task:update` (sửa, kéo thả)                 |  ✅   |  ✅   |                     ✅                     |
| `task:delete`                                                            |  ✅   |  ✅   | ✅ chỉ task **mình tạo** (`canDeleteTask`) |

Member bị xóa khỏi workspace thì các task giao cho họ được **bỏ giao** trong cùng transaction với việc xóa membership (`MembersService.remove`).

### 11.2 Endpoint (prefix `/workspaces/:workspaceId`)

| Method               | Path                                            | Ghi chú                                               |
| -------------------- | ----------------------------------------------- | ----------------------------------------------------- |
| GET                  | `/boards?page=&pageSize=`                       | Offset pagination, `{ items, total, page, pageSize }` |
| POST                 | `/boards`                                       | Tạo board kèm 3 column mặc định (nested write)        |
| GET                  | `/boards/:boardId`                              | Board + columns + tasks theo `position`               |
| PATCH / DELETE       | `/boards/:boardId`                              | Xóa: transaction xóa task rồi board                   |
| POST                 | `/boards/:boardId/columns`                      | Thêm column vào cuối                                  |
| PATCH / DELETE       | `/boards/:boardId/columns/:columnId`            | Xóa column còn task → 409                             |
| GET                  | `/tasks?q=&boardId=&assigneeId=&cursor=&limit=` | Search + cursor pagination                            |
| POST                 | `/tasks`                                        | Thêm vào cuối column (serializable + retry)           |
| GET / PATCH / DELETE | `/tasks/:taskId`                                | PATCH cần `version` (optimistic lock)                 |
| POST                 | `/tasks/:taskId/move`                           | `{ columnId, afterTaskId }` (serializable + retry)    |

### 11.3 Sơ đồ move

```
POST /workspaces/W/tasks/T/move { columnId: C2, afterTaskId: X }
 ├─ JwtAuthGuard → WorkspaceAccessGuard('task:update')
 └─ TasksService.move → prisma.serializable(tx => …)   (tối đa 5 lần, backoff + jitter)
      task T trong workspace W?                         không → 404
      C2 thuộc cùng board với T?                        không → 400
      X nằm trong C2?                                   không → 400
      next = task đầu tiên trong C2 có position > X.position (trừ T)
      position = generateKeyBetween(X.position, next?.position)
      UPDATE tasks SET column_id = C2, position = … WHERE id = T
   lỗi 40001 / unique (C2, position) → chạy lại; hết lượt → 409
```

### 11.4 Bản đồ file

| File                                                      | Vai trò                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `packages/shared/src/fractional-index.ts`                 | `generateKeyBetween`                                                            |
| `packages/shared/src/index.ts`                            | Schema board/column/task, query schema phân trang, permission + `canDeleteTask` |
| `apps/api/prisma/migrations/*_boards_tasks/migration.sql` | `COLLATE "C"`, `CREATE EXTENSION pg_trgm`, GIN index                            |
| `apps/api/src/prisma/prisma.service.ts`                   | `serializable()` với retry                                                      |
| `apps/api/src/boards/*`                                   | Board + column: offset pagination, nested write, xóa có transaction             |
| `apps/api/src/tasks/tasks.service.ts`                     | Tạo, sửa (optimistic lock), move, search (keyset + trigram)                     |
| `apps/api/src/tasks/task-cursor.ts`                       | Encode/decode cursor opaque                                                     |

---

## 12. Câu hỏi phỏng vấn + đáp án mẫu

<details><summary><b>Q1. Hai người cùng sửa một task một lúc, xử lý thế nào?</b></summary>

Em dùng optimistic locking: task có cột version, client gửi version đã đọc, server UPDATE ... WHERE id = ? AND version = ? và tăng version. Nếu 0 dòng bị ảnh hưởng thì trả 409, client tải lại bản mới cho user quyết định. Không giữ lock trong lúc user đang gõ, hợp với trường hợp xung đột hiếm. Chuẩn HTTP tương đương là ETag + If-Match và 412. Nếu xung đột thường xuyên và thao tác ngắn thì dùng pessimistic lock SELECT FOR UPDATE.
</details>

<details><summary><b>Q2. Hai request cùng trừ tồn kho thì sao?</b></summary>

Đọc stock ở app rồi ghi lại là lost update. Cách tốt nhất là atomic update: UPDATE ... SET stock = stock - 1 WHERE id = ? AND stock > 0, kiểm tra số dòng bị ảnh hưởng. Nếu logic phức tạp hơn thì trong transaction SELECT ... FOR UPDATE để khóa dòng, hoặc dùng Serializable kèm retry. Ở mức hệ thống phân tán có thể dùng distributed lock hoặc queue tuần tự hóa theo sản phẩm.
</details>

<details><summary><b>Q3. Kể các isolation level và hiện tượng mỗi level chặn. Postgres khác chuẩn chỗ nào?</b></summary>

Read Uncommitted cho dirty read, Read Committed chặn dirty read, Repeatable Read chặn thêm non-repeatable read, Serializable chặn cả phantom và mọi anomaly. Postgres không có dirty read nên Read Uncommitted chạy như Read Committed; Repeatable Read là snapshot isolation nên cũng không có phantom nhưng vẫn có write skew; Serializable dùng SSI phát hiện xung đột và abort với lỗi 40001, app phải retry. Mặc định Postgres là Read Committed, MySQL InnoDB là Repeatable Read.
</details>

<details><summary><b>Q4. MVCC là gì? Ảnh hưởng gì tới vận hành?</b></summary>

Mỗi UPDATE tạo phiên bản mới của dòng, transaction đọc theo snapshot nên reader và writer không chặn nhau. Phiên bản cũ thành dead tuple, VACUUM dọn. Transaction mở quá lâu giữ snapshot cũ làm VACUUM không dọn được, bảng và index phình to, query chậm dần. Vì vậy phải tránh transaction dài và theo dõi idle in transaction.
</details>

<details><summary><b>Q5. Tại sao offset pagination chậm khi dữ liệu lớn? Cursor pagination hoạt động thế nào?</b></summary>

OFFSET 100000 bắt DB đọc rồi bỏ đi 100000 dòng, chi phí tăng tuyến tính theo độ sâu, và dữ liệu chèn/xóa giữa các lần gọi làm lặp hoặc sót dòng. Keyset pagination nhớ giá trị sort của dòng cuối, trang sau WHERE (created_at, id) < (x, y) ORDER BY created_at DESC, id DESC LIMIT n; với index phù hợp DB nhảy thẳng tới vị trí đó nên mọi trang nhanh như nhau. Đổi lại không nhảy tới trang N được. Phải có cột phá hòa như id để thứ tự xác định, cursor nên opaque, lấy n+1 dòng để biết còn trang sau.
</details>

<details><summary><b>Q6. Composite index (a, b) có giúp query WHERE b = ? không? Thứ tự cột chọn thế nào?</b></summary>

Không hiệu quả vì index sắp theo a trước, b chỉ có thứ tự trong cùng một giá trị a. Đặt cột lọc bằng trước, cột range hoặc ORDER BY sau. Ví dụ (workspace_id, created_at, id) phục vụ được WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 20 mà không cần sort.
</details>

<details><summary><b>Q7. Một query chậm thì debug thế nào?</b></summary>

Xác định query qua slow query log hoặc pg_stat_statements, chạy EXPLAIN (ANALYZE, BUFFERS), tìm node tốn thời gian nhất, so ước lượng rows với actual rows, để ý Seq Scan trên bảng lớn, Sort lớn, Nested Loop với loops lớn. Sau đó thêm index đúng cột và đúng thứ tự, viết lại query (bỏ hàm trên cột, tránh OFFSET lớn, tránh N+1), cập nhật thống kê bằng ANALYZE, rồi đo lại. Ở tầng app kiểm tra connection pool và số query mỗi request.
</details>

<details><summary><b>Q8. Khi nào index không được dùng?</b></summary>

Khi bọc cột trong hàm hoặc ép kiểu, LIKE bắt đầu bằng wildcard với B-tree, điều kiện có độ chọn lọc thấp khiến seq scan rẻ hơn, bảng nhỏ, không có cột trái nhất của composite index, thống kê cũ. Planner chọn seq scan không phải lúc nào cũng sai.
</details>

<details><summary><b>Q9. Lưu thứ tự task khi kéo thả thế nào?</b></summary>

Lưu position INT liên tiếp thì mỗi lần kéo phải đánh số lại cả cột, nhiều lock và conflict. Em dùng fractional indexing: position là chuỗi so sánh theo từ điển, chèn giữa hai task thì sinh chuỗi nằm giữa hai key, nên mỗi lần kéo chỉ ghi một dòng và không bao giờ cạn khe như float. Cột phải dùng COLLATE "C" để DB so sánh theo byte giống thuật toán. Hai người thả vào cùng chỗ có thể sinh trùng key, nên có UNIQUE (column_id, position) và transaction Serializable có retry.
</details>

<details><summary><b>Q10. N+1 là gì, phát hiện và sửa thế nào?</b></summary>

Lấy N bản ghi bằng 1 query rồi mỗi bản ghi lại query quan hệ của nó, tổng N+1 round-trip. Phát hiện qua log SQL lặp hoặc APM thấy số query mỗi request lớn. Sửa bằng eager loading (Prisma include chạy một query mỗi cấp quan hệ với WHERE IN), JOIN, DataLoader trong GraphQL, hoặc tính aggregate tại DB.
</details>

<details><summary><b>Q11. Tìm kiếm theo tiêu đề: LIKE, full-text hay Elasticsearch?</b></summary>

LIKE '%x%' không dùng được B-tree. Em dùng pg_trgm với GIN index để ILIKE chuỗi con vẫn dùng index, hợp với tiêu đề ngắn. Full-text tsvector hợp tìm theo từ, có stemming và ranking cho văn bản dài. Elasticsearch khi cần typo tolerance, facet, ranking phức tạp và scale riêng, nhưng thêm chi phí vận hành và phải đồng bộ dữ liệu, chấp nhận eventual consistency.
</details>

<details><summary><b>Q12. Write skew là gì? Isolation level nào chặn được?</b></summary>

Hai transaction cùng đọc một tập dữ liệu, mỗi bên ghi vào dòng khác nhau dựa trên kết quả đọc, nên không đụng row lock của nhau, nhưng kết quả chung vi phạm ràng buộc, ví dụ hai bác sĩ cùng xin nghỉ vì thấy còn người trực. Repeatable Read (snapshot isolation) không chặn được; Serializable chặn được, hoặc khóa tường minh bằng SELECT FOR UPDATE trên các dòng làm điều kiện, hoặc biến ràng buộc thành constraint của DB.
</details>

<details><summary><b>Q13. PUT và PATCH khác gì? Method nào idempotent?</b></summary>

PUT thay toàn bộ resource bằng representation gửi lên, gọi lại nhiều lần cùng kết quả nên idempotent. PATCH sửa một phần, không bắt buộc idempotent (ví dụ PATCH tăng counter). GET, PUT, DELETE idempotent; POST không. Idempotent quan trọng vì client và proxy có thể retry khi timeout; với POST cần Idempotency-Key.
</details>

---

## 13. Tự kiểm tra

- [ ] Thiết kế URL cho board/column/task và giải thích vì sao task không lồng dưới column
- [ ] Phân biệt safe và idempotent, cho ví dụ mỗi method
- [ ] Giải thích vì sao lưu `workspace_id` trên `tasks` dù vi phạm 3NF
- [ ] Phân biệt CASCADE, RESTRICT, NO ACTION, SET NULL
- [ ] So sánh 5 cách lưu thứ tự kéo thả; giải thích bẫy collation
- [ ] Kể 5 loại index và khi nào dùng; leftmost prefix
- [ ] Đọc được một output EXPLAIN ANALYZE: cost, rows, loops, các loại scan
- [ ] So sánh offset và cursor pagination, viết được điều kiện keyset
- [ ] Bảng isolation level × anomaly, khác biệt của Postgres
- [ ] Giải thích MVCC và tác hại của transaction dài
- [ ] Lost update, write skew; optimistic, pessimistic, atomic update
- [ ] Nhận diện và sửa N+1
- [ ] So sánh trigram, full-text, search engine

### 🛠 Bài tập thực hành

1. Tạo board, thêm 3 task, gọi `move` để đưa task cuối lên đầu. Mở `npm run db:studio` xem cột `position` thay đổi thế nào.
2. Trong psql: `SELECT p FROM (VALUES ('Zz'), ('a0'), ('a0V')) t(p) ORDER BY p;` rồi `ORDER BY p COLLATE "C"`. So sánh kết quả.
3. Seed ~50.000 task vào một workspace (`INSERT ... SELECT generate_series`), chạy `EXPLAIN ANALYZE` cho query search `title ILIKE '%abc%'` có và không có GIN index (`DROP INDEX` tạm trên DB dev).
4. Gọi `GET /boards?page=…` với page rất lớn và so với cursor của `/tasks` trên dữ liệu seed (đo bằng `curl -w '%{time_total}'`).
5. Mở 2 tab psql: tab 1 `BEGIN ISOLATION LEVEL REPEATABLE READ; SELECT title FROM tasks WHERE id = …;`, tab 2 sửa title và commit, tab 1 select lại (vẫn thấy cũ), rồi tab 1 `UPDATE` dòng đó → quan sát lỗi `could not serialize access`.
6. Sửa task với `version` cũ: quan sát 409. Bắn 10 request `move` song song vào cùng một khe, xác nhận tất cả thành công với position khác nhau (thử đặt `attempts = 3` và bỏ `sleep` trong `PrismaService.serializable` để thấy 409 xuất hiện).
