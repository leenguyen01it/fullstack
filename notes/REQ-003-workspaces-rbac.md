# REQ-003: Workspace, thành viên, phân quyền (RBAC/ABAC, Guard, thiết kế DB, transaction)

> Code liên quan: `apps/api/src/workspaces/*`, `apps/api/prisma/schema.prisma` (model `Workspace`, `WorkspaceMember`, enum `WorkspaceRole`), `packages/shared/src/index.ts` (schema + rule phân quyền dùng chung), `apps/web/src/api/workspaces.ts`, `apps/web/src/workspaces/*`
> Roadmap: Phase 3 (Authorization, NestJS guard), Phase 4 (thiết kế DB, chuẩn hóa, transaction)

## Mục lục

1. [Authentication xong rồi, giờ là Authorization](#1-authentication-xong-rồi-giờ-là-authorization)
2. [Các mô hình phân quyền: ACL, RBAC, ABAC, ReBAC](#2-các-mô-hình-phân-quyền-acl-rbac-abac-rebac)
3. [Mô hình quyền của TaskFlow](#3-mô-hình-quyền-của-taskflow)
4. [NestJS request pipeline và Guard](#4-nestjs-request-pipeline-và-guard)
5. [403 hay 404?](#5-403-hay-404)
6. [Thiết kế DB: quan hệ và bảng trung gian](#6-thiết-kế-db-quan-hệ-và-bảng-trung-gian)
7. [Chuẩn hóa 1NF–3NF và khi nào denormalize](#7-chuẩn-hóa-1nf3nf-và-khi-nào-denormalize)
8. [Transaction và ACID](#8-transaction-và-acid)
9. [Race condition trong phân quyền: TOCTOU](#9-race-condition-trong-phân-quyền-toctou)
10. [Bất biến "mỗi workspace đúng một owner"](#10-bất-biến-mỗi-workspace-đúng-một-owner)
11. [Multi-tenancy](#11-multi-tenancy)
12. [Luồng REQ-003 trong TaskFlow](#12-luồng-req-003-trong-taskflow)
13. [Câu hỏi phỏng vấn + đáp án mẫu](#13-câu-hỏi-phỏng-vấn--đáp-án-mẫu)
14. [Tự kiểm tra](#14-tự-kiểm-tra)

---

## 1. Authentication xong rồi, giờ là Authorization

REQ-002 trả lời câu hỏi **"bạn là ai?"** (`JwtAuthGuard` gắn `request.user`). REQ-003 trả lời **"bạn được làm gì, trên tài nguyên nào?"**.

Một quyết định phân quyền luôn có 3 thành phần:

- **Subject**: ai đang làm (user `sub` trong JWT).
- **Action**: làm gì (`member:add`, `workspace:delete`).
- **Resource**: trên cái gì (workspace `:workspaceId`, member `:userId`).

Lỗi phân quyền phổ biến nhất trong thực tế là **IDOR / Broken Object Level Authorization** (OWASP API Top 1): API chỉ kiểm tra "đã đăng nhập chưa" mà quên kiểm tra "user này có thuộc workspace đó không", nên đổi id trên URL là đọc được dữ liệu người khác. Mọi route có `:workspaceId` trong TaskFlow phải đi qua `WorkspaceAccessGuard`.

---

## 2. Các mô hình phân quyền: ACL, RBAC, ABAC, ReBAC

| Mô hình                        | Ý tưởng                                                                     | Ưu                                       | Nhược                                          | Ví dụ                                                                                                      |
| ------------------------------ | --------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **ACL** (Access Control List)  | Mỗi resource giữ danh sách (user, quyền)                                    | Đơn giản, chi tiết tới từng object       | Khó quản lý khi nhiều user/resource            | File permission Linux, S3 ACL                                                                              |
| **RBAC** (Role-Based)          | User → Role → Permission                                                    | Dễ hiểu, dễ audit ("admin làm được gì?") | **Role explosion** khi rule phụ thuộc ngữ cảnh | Owner/Admin/Member                                                                                         |
| **ABAC** (Attribute-Based)     | Rule là biểu thức trên thuộc tính của subject, resource, action, môi trường | Rất linh hoạt                            | Khó audit, khó trả lời "ai có quyền X"         | "Admin chỉ quản lý được người có role thấp hơn", "chỉ sửa task của chính mình", "chỉ trong giờ hành chính" |
| **ReBAC** (Relationship-Based) | Quyền suy ra từ quan hệ trong graph                                         | Hợp với chia sẻ lồng nhau                | Cần hạ tầng riêng                              | Google Zanzibar, OpenFGA, SpiceDB: "viewer của folder thì là viewer của file trong folder"                 |

### 2.1 RBAC chi tiết

- **Flat RBAC**: user có role, role có danh sách permission.
- **Hierarchical RBAC**: role cao kế thừa quyền role thấp (Owner ⊇ Admin ⊇ Member). TaskFlow dùng **rank** (`OWNER=3, ADMIN=2, MEMBER=1`) để so sánh.
- **Global role và scoped role**: `user.role = ADMIN` (toàn hệ thống) khác với "ADMIN **của workspace X**". TaskFlow dùng **scoped role**: role nằm trên bảng `workspace_members`, cùng một user có thể là Owner ở workspace A và Member ở workspace B.
- **Kiểm tra theo permission, không theo role**: code viết `hasWorkspacePermission(role, 'member:add')` thay vì `if (role === 'ADMIN' || role === 'OWNER')`. Thêm role mới chỉ cần sửa bảng map, không phải sửa mọi if.

### 2.2 Vì sao RBAC thuần chưa đủ

Rule "Admin được đổi role thành viên" nghe như RBAC, nhưng thực tế cần thêm điều kiện:

- Admin **không** được hạ quyền Owner hay Admin khác.
- Admin **không** được tự phong người khác lên Admin (nếu không, 1 admin có thể tạo vô hạn admin).
- Member được **tự rời** workspace nhưng không được xóa người khác.

Đây là điều kiện trên **thuộc tính** (role của actor so với role của target, actor có phải chính target không), tức là ABAC. Thực tế hầu hết hệ thống là **RBAC + vài rule ABAC**, đúng như TaskFlow.

### 2.3 Policy nằm ở đâu

- **Trong code** (TaskFlow): bảng map + hàm thuần trong `packages/shared`. Đơn giản, type-safe, test được, frontend dùng chung để ẩn nút.
- **Policy engine ngoài**: OPA (Rego), Casbin, Cedar (AWS), OpenFGA. Dùng khi nhiều service cần cùng một bộ rule hoặc rule do người vận hành sửa không cần deploy.
- **Trong DB**: Postgres Row Level Security (mục 11).

> ⚠️ Frontend ẩn nút chỉ là **UX**, không phải bảo mật. Server luôn phải kiểm tra lại, vì ai cũng gọi được API bằng `curl`.

---

## 3. Mô hình quyền của TaskFlow

### 3.1 RBAC: permission map (`packages/shared/src/index.ts`, `WORKSPACE_PERMISSIONS`)

| Permission                          | OWNER | ADMIN |            MEMBER             |
| ----------------------------------- | :---: | :---: | :---------------------------: |
| `workspace:read`                    |  ✅   |  ✅   |              ✅               |
| `workspace:update` (đổi tên)        |  ✅   |  ✅   |                               |
| `workspace:delete`                  |  ✅   |       |                               |
| `workspace:transfer` (chuyển owner) |  ✅   |       |                               |
| `member:read`                       |  ✅   |  ✅   |              ✅               |
| `member:add`                        |  ✅   |  ✅   |                               |
| `member:update` (đổi role)          |  ✅   |  ✅   |                               |
| `member:remove`                     |  ✅   |  ✅   | ✅ (chỉ tự rời, do rule ABAC) |

### 3.2 ABAC: rule trên thuộc tính (`canAssignRole`, `canManageMember`, `canRemoveMember`)

1. **Gán role**: chỉ gán được role **thấp hơn** role của mình, và không bao giờ gán `OWNER` qua đường này. Owner gán được Admin/Member; Admin chỉ gán được Member.
2. **Quản lý người khác**: chỉ tác động lên người có role **thấp hơn** mình. Admin không đụng được Admin khác hay Owner.
3. **Tự rời**: ai cũng tự rời được, trừ Owner (phải chuyển quyền trước, nếu không workspace mồ côi).
4. **Chuyển owner**: chỉ Owner, chuyển cho một thành viên hiện có; Owner cũ thành Admin. Làm trong **một transaction**.

### 3.3 Hai lớp kiểm tra

```
Request ──▶ JwtAuthGuard (global)       : có đăng nhập không?               → 401
        ──▶ WorkspaceAccessGuard (route): có là member không? role có permission không? → 404 / 403
        ──▶ Service (ABAC)              : được tác động lên target cụ thể này không?   → 403
```

Guard xử lý phần **chung** cho mọi route (membership + RBAC). Service xử lý phần **phụ thuộc dữ liệu của request** (role của target, role mới) vì guard không nên đi load target.

---

## 4. NestJS request pipeline và Guard

### 4.1 Thứ tự thực thi

```
Middleware → Guards → Interceptors (before) → Pipes → Handler → Interceptors (after) → Exception filters
```

- **Middleware**: chạy trước khi Nest biết route nào xử lý (không có `ExecutionContext`). Dùng cho việc chung: `helmet`, `cookie-parser`, logging.
- **Guard**: trả về `true/false` (hoặc throw), **biết handler và class** sẽ chạy nên đọc được metadata của decorator. Đây là chỗ đúng cho authN/authZ.
- **Interceptor**: bọc quanh handler (RxJS), dùng cho transform response, cache, timing.
- **Pipe**: validate/transform tham số (`ZodValidationPipe`, `ParseUUIDPipe`).
- **Exception filter**: chuyển exception thành response (`AllExceptionsFilter`).

Thứ tự giữa các guard: **global** (`APP_GUARD`) → **controller** (`@UseGuards` trên class) → **route** (`@UseGuards` trên method). Vì vậy khi `WorkspaceAccessGuard` chạy, `JwtAuthGuard` đã gắn `request.user`.

> Guard chạy **trước** pipe, nên guard đọc `req.params.workspaceId` ở dạng chuỗi thô, chưa qua validate. `WorkspaceAccessGuard` tự kiểm tra UUID; nếu không, Prisma sẽ ném lỗi khi query cột `@db.Uuid` với chuỗi rác và trả 500.

### 4.2 Metadata, `Reflector`, decorator composition

```ts
// apps/api/src/workspaces/workspace-permission.decorator.ts
export const WorkspacePermission = (permission: WorkspacePermissionName) =>
  applyDecorators(
    SetMetadata(WORKSPACE_PERMISSION_KEY, permission),
    UseGuards(WorkspaceAccessGuard),
    ApiForbiddenResponse(...), ApiNotFoundResponse(...),
  );
```

- `SetMetadata` gắn dữ liệu lên handler; guard đọc lại bằng `reflector.get(KEY, context.getHandler())`.
- `applyDecorators` gom nhiều decorator thành một: route chỉ cần `@WorkspacePermission('member:add')`, không thể quên gắn guard.
- Guard **fail closed**: route dùng guard mà không khai báo permission thì bị từ chối.

### 4.3 Truyền kết quả guard xuống handler

Guard đã load membership rồi, không nên để service load lại. Guard gắn vào `request.membership`, handler lấy bằng custom param decorator `@CurrentMembership()` (giống `@CurrentUser()` của REQ-002).

---

## 5. 403 hay 404?

| Tình huống                                         | TaskFlow trả | Lý do                                                                                                                      |
| -------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Workspace không tồn tại                            | 404          |                                                                                                                            |
| Workspace tồn tại nhưng mình **không phải member** | **404**      | Không tiết lộ sự tồn tại của tài nguyên người khác (giống GitHub với private repo). Attacker không dò được id nào là thật. |
| Là member nhưng role không đủ quyền                | **403**      | User đã biết workspace tồn tại, trả 403 giúp UI hiện thông báo đúng.                                                       |
| `:workspaceId` không phải UUID                     | 404          | Như không tồn tại.                                                                                                         |
| `:userId` (member) không phải UUID                 | 400          | `ParseUUIDPipe`, lỗi input rõ ràng.                                                                                        |

Trade-off: 404 cho non-member làm debug khó hơn một chút, nhưng chống **enumeration**.

---

## 6. Thiết kế DB: quan hệ và bảng trung gian

### 6.1 Các loại quan hệ

| Quan hệ | Cách lưu                                    | Ví dụ TaskFlow                               |
| ------- | ------------------------------------------- | -------------------------------------------- |
| 1–1     | FK + `UNIQUE` ở một bên                     | (chưa có) user ↔ user_settings               |
| 1–N     | FK ở bên "nhiều"                            | user 1–N refresh_tokens                      |
| N–N     | **Bảng trung gian** (junction / join table) | users N–N workspaces qua `workspace_members` |

### 6.2 `workspace_members` là junction table **có thuộc tính**

```prisma
model WorkspaceMember {
  workspaceId String        @db.Uuid
  userId      String        @db.Uuid
  role        WorkspaceRole @default(MEMBER)
  joinedAt    DateTime      @default(now())
  @@id([workspaceId, userId])
  @@index([userId])
}
```

- **Composite primary key** `(workspace_id, user_id)`: vừa là định danh, vừa đảm bảo một user không thể là member hai lần (thêm trùng → Postgres báo unique violation → Prisma `P2002` → API trả 409). Ràng buộc nằm ở DB nên đúng cả khi hai request chạy song song.
- `role` là thuộc tính **của quan hệ**, không phải của user hay workspace. Đây là lý do không dùng implicit many-to-many của Prisma (`User[]` ↔ `Workspace[]`), vì kiểu đó không có cột thêm.
- **Surrogate key hay natural key?** Có thể thêm cột `id UUID` riêng + `UNIQUE(workspace_id, user_id)`. Composite PK gọn hơn, không có cột thừa; surrogate key tiện khi bảng khác cần FK tới membership hoặc khi ORM/REST thích một id đơn.

### 6.3 Index cho junction table (quy tắc leftmost prefix)

PK `(workspace_id, user_id)` tự tạo B-tree index trên **đúng thứ tự** đó:

- `WHERE workspace_id = ?` (liệt kê member của workspace): ✅ dùng được PK index (cột trái nhất).
- `WHERE workspace_id = ? AND user_id = ?` (guard kiểm tra membership): ✅ index lookup chính xác.
- `WHERE user_id = ?` (liệt kê workspace của tôi): ❌ không dùng được PK index vì `user_id` không phải cột trái nhất → cần thêm `@@index([userId])`.

Postgres **không tự tạo index cho FK** (MySQL InnoDB thì có). Thiếu index ở FK làm query join chậm và làm `DELETE` bên cha phải seq scan bảng con để cascade.

### 6.4 Referential actions (`ON DELETE`)

| Action                   | Ý nghĩa                       | TaskFlow                                                                          |
| ------------------------ | ----------------------------- | --------------------------------------------------------------------------------- |
| `CASCADE`                | Xóa cha thì xóa luôn con      | Xóa workspace → xóa members (sau này cả boards, tasks). Xóa user → xóa membership |
| `RESTRICT` / `NO ACTION` | Không cho xóa cha khi còn con | Hợp cho dữ liệu tài chính                                                         |
| `SET NULL`               | Con giữ lại, FK thành NULL    | Task giữ lại khi assignee bị xóa (REQ-004)                                        |

Cascade tiện nhưng nguy hiểm khi cây lớn (một `DELETE` xóa hàng triệu dòng, lock lâu). Hệ thống lớn thường dùng **soft delete** (`deleted_at`) rồi dọn bằng job nền (REQ-006).

### 6.5 Enum hay lookup table cho role?

|                                  | Postgres `ENUM` (TaskFlow)                 | Lookup table `roles(id, name)` |
| -------------------------------- | ------------------------------------------ | ------------------------------ |
| Type-safe trong Prisma/TS        | ✅                                         | ❌ (string/FK)                 |
| Thêm giá trị                     | Cần migration (`ALTER TYPE ... ADD VALUE`) | Insert một dòng                |
| Xóa/đổi tên giá trị              | Khó                                        | Dễ                             |
| Role do khách hàng tự định nghĩa | ❌                                         | ✅                             |

Role cố định, ít thay đổi → enum. Nếu sau này cho phép "custom role" thì chuyển sang bảng `roles` + `role_permissions`.

---

## 7. Chuẩn hóa 1NF–3NF và khi nào denormalize

- **1NF**: mỗi ô một giá trị nguyên tử, không có nhóm lặp. ❌ `workspaces.member_ids = '1,2,3'` hay `member1, member2, member3`. Vi phạm này khiến không join, không index, không ràng buộc FK được.
- **2NF**: đạt 1NF và mọi cột không-khóa phụ thuộc **toàn bộ** khóa chính (chỉ liên quan khi khóa là composite). ❌ Nếu `workspace_members` có cột `workspace_name`: nó chỉ phụ thuộc `workspace_id`, một phần của khóa `(workspace_id, user_id)`.
- **3NF**: đạt 2NF và không có **phụ thuộc bắc cầu** (cột không-khóa phụ thuộc cột không-khóa khác). ❌ `workspace_members(…, role, role_can_delete)`: `role_can_delete` phụ thuộc `role` chứ không phải khóa. TaskFlow để map permission trong code, đúng tinh thần 3NF.
- **BCNF**: mọi determinant đều là candidate key (mức "biết tên" là đủ cho Middle).

**Mục tiêu của chuẩn hóa**: tránh **update anomaly** (sửa một chỗ quên chỗ khác), **insert anomaly**, **delete anomaly**.

**Khi nào denormalize**: khi đo được query đọc là bottleneck. Ví dụ `workspaces.member_count` để khỏi `COUNT(*)` mỗi lần liệt kê. Cái giá: phải giữ đồng bộ (trong cùng transaction, trigger, hoặc chấp nhận eventual consistency). TaskFlow hiện tính `memberCount` bằng Prisma `_count` (một subquery `COUNT` gộp trong cùng câu SQL, không phải N+1) vì số member nhỏ; denormalize để dành khi có số liệu chứng minh cần.

---

## 8. Transaction và ACID

|                 | Ý nghĩa                                                           | Ví dụ TaskFlow                                                                 |
| --------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| **Atomicity**   | Tất cả hoặc không gì cả                                           | Chuyển owner: hạ owner cũ + nâng owner mới; lỗi giữa chừng thì rollback cả hai |
| **Consistency** | Sau transaction, mọi ràng buộc vẫn đúng                           | PK, FK, "mỗi workspace một owner"                                              |
| **Isolation**   | Transaction chạy song song không thấy trạng thái dở dang của nhau | Mức mặc định của Postgres: Read Committed (học sâu ở REQ-004)                  |
| **Durability**  | Commit rồi thì không mất dù crash                                 | WAL của Postgres                                                               |

### 8.1 Ba cách làm transaction trong Prisma

1. **Nested write**: một lệnh `create` lồng `members: { create: {...} }`. Prisma tự bọc trong transaction. TaskFlow dùng khi **tạo workspace + owner membership**: không bao giờ có workspace không owner.
2. **Batch** `prisma.$transaction([q1, q2])`: các query độc lập, không phụ thuộc kết quả của nhau.
3. **Interactive** `prisma.$transaction(async (tx) => { ... })`: có logic giữa các bước (đọc kết quả, quyết định, throw để rollback). TaskFlow dùng cho **chuyển owner**.

```ts
// apps/api/src/workspaces/members.service.ts (rút gọn)
await this.prisma.$transaction(async (tx) => {
  const demoted = await tx.workspaceMember.updateMany({
    where: { workspaceId, userId: actorId, role: 'OWNER' }, data: { role: 'ADMIN' },
  });
  if (demoted.count !== 1) throw new ConflictException(...);   // rollback
  const promoted = await tx.workspaceMember.updateMany({
    where: { workspaceId, userId: targetId, role: { not: 'OWNER' } }, data: { role: 'OWNER' },
  });
  if (promoted.count !== 1) throw new NotFoundException(...);  // rollback cả bước hạ quyền
});
```

**Lưu ý với interactive transaction**:

- Giữ ngắn: transaction giữ connection từ pool và giữ lock; **không** gọi HTTP/gửi email bên trong.
- Mọi query bên trong phải dùng `tx`, không dùng `this.prisma` (sẽ chạy ngoài transaction trên connection khác).
- Prisma có `timeout` mặc định 5 giây cho interactive transaction.

---

## 9. Race condition trong phân quyền: TOCTOU

**TOCTOU** (Time Of Check To Time Of Use): kiểm tra điều kiện ở thời điểm T1, hành động ở T2, nhưng dữ liệu đã đổi giữa T1 và T2.

Ví dụ: Owner và một Admin cùng thao tác trên member B (đang là MEMBER).

1. Admin đọc B: role = MEMBER → rule "admin quản lý được member" cho phép xóa.
2. Owner nâng B lên ADMIN.
3. Admin xóa B → một Admin vừa xóa một Admin khác, vi phạm rule.

**Cách sửa trong TaskFlow: conditional write** (giống `rotatedAt: null` ở REQ-002). Ghi kèm điều kiện là chính giá trị đã kiểm tra:

```ts
const result = await this.prisma.workspaceMember.deleteMany({
  where: { workspaceId, userId: targetId, role: target.role }, // role phải còn như lúc kiểm tra
});
if (result.count === 0) throw new ConflictException('Member changed, please retry');
```

Postgres thực hiện `DELETE ... WHERE` một cách nguyên tử trên từng dòng: nếu role đã đổi thì `count = 0`, API trả 409. Đây thực chất là **optimistic concurrency control** dùng chính cột `role` làm "version".

Các cách khác: `SELECT ... FOR UPDATE` (pessimistic lock, khóa dòng tới hết transaction), hoặc isolation `SERIALIZABLE` (Postgres tự phát hiện xung đột, transaction thua phải retry). Học sâu ở REQ-004.

Còn một TOCTOU nhỏ hơn: role của **actor** do guard đọc, có thể bị hạ ngay sau đó. TaskFlow chấp nhận khoảng hở vài mili giây này (giống access token còn sống 15 phút sau khi đổi quyền). Hệ thống cần chặt hơn thì đưa cả điều kiện role của actor vào transaction.

---

## 10. Bất biến "mỗi workspace đúng một owner"

Các cách bảo vệ một **invariant**:

| Cách                                                                                                   | Mạnh                                            | Yếu                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Kiểm tra ở app** (TaskFlow)                                                                          | Dễ hiểu, báo lỗi đẹp                            | Mọi đường ghi phải nhớ tuân theo; script SQL tay có thể phá                                                                                               |
| **Partial unique index** `CREATE UNIQUE INDEX ON workspace_members(workspace_id) WHERE role = 'OWNER'` | DB đảm bảo **tối đa** một owner, kể cả khi race | Prisma schema không mô tả được partial index nên phải viết tay trong migration và dễ bị `migrate dev` coi là drift. Không đảm bảo **tối thiểu** một owner |
| **Cột `owner_id` trên `workspaces`**                                                                   | Đúng một owner theo cấu trúc (NOT NULL + FK)    | Thông tin role bị chia hai nơi (owner_id và bảng members), phải đồng bộ                                                                                   |
| **Trigger / CHECK constraint**                                                                         | Mạnh nhất                                       | Logic ẩn trong DB, khó test và khó đọc                                                                                                                    |

TaskFlow giữ invariant ở app bằng các luật:

- Tạo workspace: nested write tạo luôn owner (không bao giờ 0 owner).
- Không endpoint nào gán `OWNER` trừ chuyển quyền (schema Zod chỉ chấp nhận `ADMIN | MEMBER`).
- Owner không bị xóa/hạ quyền, không tự rời được.
- Chuyển quyền trong một transaction, hai `updateMany` có điều kiện.

---

## 11. Multi-tenancy

Workspace chính là **tenant**: dữ liệu của workspace A tuyệt đối không được lộ sang B.

| Mô hình                                     | Mô tả                                             | Khi nào                                          |
| ------------------------------------------- | ------------------------------------------------- | ------------------------------------------------ |
| **Shared schema, cột tenant_id** (TaskFlow) | Mọi bảng có `workspace_id`, mọi query lọc theo nó | SaaS phổ biến nhất, rẻ, dễ scale                 |
| Schema-per-tenant                           | Mỗi tenant một Postgres schema                    | Tenant cần tùy biến, số tenant vừa phải          |
| Database-per-tenant                         | Mỗi tenant một DB                                 | Khách hàng enterprise, yêu cầu cô lập/compliance |

Rủi ro lớn nhất của shared schema là **quên `WHERE workspace_id = ?`**. Các lớp phòng thủ:

1. Guard bắt buộc cho mọi route có `:workspaceId` (TaskFlow).
2. Service luôn nhận `workspaceId` từ membership đã kiểm tra, không từ body.
3. **Postgres Row Level Security** (RLS): `CREATE POLICY ... USING (workspace_id = current_setting('app.workspace_id')::uuid)`. DB tự lọc kể cả khi code quên. Đổi lại phải set biến session cho mỗi transaction, phức tạp hơn với connection pool.

---

## 12. Luồng REQ-003 trong TaskFlow

### 12.1 Endpoint

| Method | Path                                          | Permission             | Kết quả                                                 |
| ------ | --------------------------------------------- | ---------------------- | ------------------------------------------------------- |
| POST   | `/workspaces`                                 | đăng nhập              | 201 `Workspace`, người tạo là OWNER                     |
| GET    | `/workspaces`                                 | đăng nhập              | 200 `Workspace[]` của tôi (kèm `myRole`, `memberCount`) |
| GET    | `/workspaces/:workspaceId`                    | `workspace:read`       | 200 `Workspace`                                         |
| PATCH  | `/workspaces/:workspaceId`                    | `workspace:update`     | 200 `Workspace`                                         |
| DELETE | `/workspaces/:workspaceId`                    | `workspace:delete`     | 204, cascade members                                    |
| GET    | `/workspaces/:workspaceId/members`            | `member:read`          | 200 `WorkspaceMember[]`                                 |
| POST   | `/workspaces/:workspaceId/members`            | `member:add` + ABAC    | 201; email chưa đăng ký → 404; đã là member → 409       |
| PATCH  | `/workspaces/:workspaceId/members/:userId`    | `member:update` + ABAC | 200 `WorkspaceMember`; role đã đổi giữa chừng → 409     |
| DELETE | `/workspaces/:workspaceId/members/:userId`    | `member:remove` + ABAC | 204 (xóa người khác hoặc tự rời)                        |
| POST   | `/workspaces/:workspaceId/transfer-ownership` | `workspace:transfer`   | 200 `WorkspaceMember[]`                                 |

### 12.2 Sơ đồ một request

```
PATCH /workspaces/W/members/U  {role: "ADMIN"}   Authorization: Bearer <jwt>
 │
 ├─ JwtAuthGuard (APP_GUARD)        verify JWT → req.user = {sub: A}
 ├─ WorkspaceAccessGuard            SELECT role FROM workspace_members WHERE (W, A)
 │                                    không có → 404 · không có 'member:update' → 403
 │                                    req.membership = {workspaceId: W, userId: A, role}
 ├─ ParseUUIDPipe(:userId), ZodValidationPipe(body)                      → 400
 └─ MembersService.updateRole
      load target U                   không có → 404
      canManageMember(actor, target)  && canAssignRole(actor, newRole)   → 403
      UPDATE ... WHERE (W, U) AND role = <role đã đọc>                   count 0 → 409
```

### 12.3 Bản đồ file

| File                                                        | Vai trò                                                                                                                                                |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/index.ts`                              | `WORKSPACE_ROLES`, `WORKSPACE_PERMISSIONS`, `hasWorkspacePermission`, `canAssignRole`, `canManageMember`, `canRemoveMember`, Zod schema, type response |
| `apps/api/prisma/schema.prisma`                             | `Workspace`, `WorkspaceMember` (composite PK, index `user_id`, cascade), enum `WorkspaceRole`                                                          |
| `apps/api/src/workspaces/workspace-access.guard.ts`         | Kiểm tra membership + RBAC, gắn `req.membership`                                                                                                       |
| `apps/api/src/workspaces/workspace-permission.decorator.ts` | `@WorkspacePermission()` gom metadata + guard + Swagger                                                                                                |
| `apps/api/src/workspaces/current-membership.decorator.ts`   | `@CurrentMembership()`                                                                                                                                 |
| `apps/api/src/workspaces/workspaces.service.ts`             | CRUD workspace, nested write tạo owner                                                                                                                 |
| `apps/api/src/workspaces/members.service.ts`                | Thêm/đổi role/xóa member, chuyển owner (interactive transaction), conditional write                                                                    |
| `apps/api/src/workspaces/*.controller.ts`                   | Route, validate input                                                                                                                                  |
| `apps/web/src/api/workspaces.ts`                            | Hàm gọi API + TanStack Query hooks                                                                                                                     |
| `apps/web/src/workspaces/*`                                 | UI danh sách workspace, thành viên; ẩn nút theo rule dùng chung                                                                                        |

---

## 13. Câu hỏi phỏng vấn + đáp án mẫu

<details><summary><b>Q1. RBAC và ABAC khác nhau thế nào? Dự án của bạn dùng gì?</b></summary>

RBAC gán quyền qua role: user có role, role có danh sách permission; dễ hiểu, dễ audit nhưng bị role explosion khi rule phụ thuộc ngữ cảnh. ABAC đánh giá rule trên thuộc tính của subject, resource, action và môi trường, linh hoạt hơn nhưng khó trả lời "ai có quyền gì". Em dùng RBAC theo scope workspace (Owner/Admin/Member, kiểm tra theo permission chứ không theo tên role) cho phần chung, cộng vài rule ABAC cho thao tác lên member: chỉ tác động lên người có role thấp hơn mình, chỉ gán role thấp hơn mình, owner không tự rời được.
</details>

<details><summary><b>Q2. Bạn đặt logic phân quyền ở đâu trong NestJS? Vì sao dùng Guard?</b></summary>

Guard chạy sau middleware và trước pipe/interceptor/handler, có ExecutionContext nên đọc được metadata của route qua Reflector. Em có global JwtAuthGuard cho authentication, và WorkspaceAccessGuard gắn qua decorator @WorkspacePermission('member:add'): guard load membership của user trong workspace, trả 404 nếu không phải member, 403 nếu role không có permission, rồi gắn membership vào request để handler dùng. Rule phụ thuộc target (role của người bị sửa) thì nằm trong service vì guard không nên load dữ liệu riêng của từng use case.
</details>

<details><summary><b>Q3. Thứ tự chạy của middleware, guard, interceptor, pipe, filter trong NestJS?</b></summary>

Middleware → guard → interceptor (trước) → pipe → handler → interceptor (sau) → exception filter khi có lỗi. Guard global chạy trước guard của controller, rồi đến guard của method. Hệ quả: guard đọc params chưa qua pipe nên phải tự validate nếu cần.
</details>

<details><summary><b>Q4. User không thuộc workspace gọi GET /workspaces/:id thì trả 403 hay 404?</b></summary>

Em trả 404 để không tiết lộ workspace đó có tồn tại, giống GitHub với private repo; attacker không dò được id. Khi user là member nhưng thiếu quyền thì trả 403 vì họ đã biết workspace tồn tại và UI cần biết lý do. 401 dành cho chưa đăng nhập.
</details>

<details><summary><b>Q5. Thiết kế bảng cho quan hệ user–workspace có role thế nào?</b></summary>

Quan hệ N–N nên dùng bảng trung gian workspace_members(workspace_id, user_id, role, joined_at) với composite primary key (workspace_id, user_id) để chặn trùng ngay ở DB. Role là thuộc tính của quan hệ nên phải nằm ở bảng này, không ở users. Thêm index trên user_id vì PK chỉ phục vụ query bắt đầu bằng workspace_id (leftmost prefix), và Postgres không tự index FK. FK hai bên ON DELETE CASCADE.
</details>

<details><summary><b>Q6. Composite index (workspace_id, user_id) có giúp query WHERE user_id = ? không?</b></summary>

Gần như không. B-tree sắp theo workspace_id trước rồi mới tới user_id, nên tìm theo user_id không có điểm bắt đầu, planner sẽ seq scan (hoặc full index scan nếu rẻ hơn). Cần index riêng trên user_id, hoặc index (user_id, workspace_id) nếu query còn lọc thêm workspace.
</details>

<details><summary><b>Q7. Giải thích 1NF, 2NF, 3NF bằng ví dụ. Khi nào denormalize?</b></summary>

1NF: giá trị nguyên tử, không lưu member_ids = '1,2,3'. 2NF: cột phụ thuộc toàn bộ khóa composite, ví dụ không để workspace_name trong workspace_members vì nó chỉ phụ thuộc workspace_id. 3NF: không phụ thuộc bắc cầu, ví dụ không để cột role_can_delete cạnh role. Chuẩn hóa tránh update/insert/delete anomaly. Denormalize khi đo được query đọc là bottleneck, ví dụ lưu member_count, chấp nhận chi phí đồng bộ khi ghi.
</details>

<details><summary><b>Q8. Chuyển quyền owner cần những gì để an toàn?</b></summary>

Hai bước hạ owner cũ và nâng owner mới phải nằm trong một transaction để không bao giờ có 0 hoặc 2 owner. Em dùng interactive transaction của Prisma với hai updateMany có điều kiện: hạ người gọi chỉ khi họ còn là OWNER, nâng target chỉ khi họ là member và chưa là OWNER; count khác 1 thì throw để rollback. Không cho gán OWNER qua endpoint đổi role thông thường, owner không được tự rời.
</details>

<details><summary><b>Q9. TOCTOU là gì? Trong phân quyền bạn xử lý thế nào?</b></summary>

Time of check to time of use: kiểm tra ở một thời điểm, hành động ở thời điểm sau, dữ liệu đổi ở giữa. Ví dụ admin kiểm tra target đang là MEMBER nên được xóa, nhưng owner vừa nâng target lên ADMIN. Em ghi có điều kiện: UPDATE/DELETE ... WHERE role = role đã kiểm tra, count = 0 thì trả 409 để client tải lại. Đây là optimistic concurrency với chính cột role. Cách khác là SELECT FOR UPDATE trong transaction hoặc isolation Serializable.
</details>

<details><summary><b>Q10. Prisma có những cách làm transaction nào? Lưu ý gì với interactive transaction?</b></summary>

Nested write (một lệnh create lồng nhau, Prisma tự bọc transaction), batch $transaction([...]) cho các query độc lập, và interactive $transaction(async tx => ...) khi có logic giữa các bước. Với interactive transaction: giữ ngắn vì nó giữ connection và lock, không gọi API ngoài bên trong, mọi query phải dùng tx, có timeout mặc định 5 giây, throw để rollback.
</details>

<details><summary><b>Q11. Làm sao đảm bảo dữ liệu của tenant này không lộ sang tenant khác?</b></summary>

Mỗi bảng có workspace_id; mọi route có workspaceId đi qua guard kiểm tra membership; service lấy workspaceId từ membership đã kiểm tra chứ không tin body; viết test cho trường hợp user khác workspace. Muốn phòng thủ ở tầng DB thì bật Postgres Row Level Security với policy lọc theo workspace_id set trong session. Khách hàng cần cô lập mạnh thì dùng schema hoặc database riêng mỗi tenant.
</details>

<details><summary><b>Q12. Frontend đã ẩn nút xóa với Member, backend còn cần kiểm tra không?</b></summary>

Bắt buộc. Ẩn nút chỉ là UX; ai cũng gọi được API bằng curl hay DevTools. Trong TaskFlow rule nằm ở packages/shared để frontend và backend dùng cùng một hàm, tránh lệch nhau, nhưng backend mới là nơi thực thi.
</details>

<details><summary><b>Q13. Postgres ENUM hay lookup table cho role?</b></summary>

Role cố định và ít đổi thì ENUM: type-safe trong Prisma/TypeScript, rẻ, DB chặn giá trị lạ. Thêm giá trị cần migration, xóa giá trị khó. Nếu cho phép khách hàng tự tạo role hoặc tùy chỉnh permission thì dùng bảng roles và role_permissions.
</details>

---

## 14. Tự kiểm tra

- [ ] Phân biệt ACL, RBAC, ABAC, ReBAC, mỗi loại một ví dụ
- [ ] Vì sao kiểm tra theo permission tốt hơn kiểm tra theo tên role
- [ ] Kể lại thứ tự pipeline của NestJS và vì sao guard phải tự validate `:workspaceId`
- [ ] Giải thích `SetMetadata`, `Reflector`, `applyDecorators` trong `@WorkspacePermission`
- [ ] Khi nào trả 401, 403, 404, 409 trong REQ-003
- [ ] Vẽ bảng `workspace_members`, giải thích composite PK và vì sao cần `@@index([userId])`
- [ ] Nêu 3 referential action và rủi ro của cascade
- [ ] Cho ví dụ vi phạm 1NF, 2NF, 3NF
- [ ] Nêu 4 tính chất ACID với ví dụ từ TaskFlow
- [ ] Phân biệt 3 kiểu transaction của Prisma
- [ ] Mô tả một kịch bản TOCTOU và cách conditional write chặn nó
- [ ] So sánh 4 cách giữ invariant "một owner"
- [ ] Nêu 3 mô hình multi-tenancy và RLS

### 🛠 Bài tập thực hành

1. Tạo 2 user A, B. A tạo workspace, dùng token của B gọi `GET /workspaces/<id>`: xác nhận 404. Thêm B làm MEMBER, gọi lại: 200. B gọi `PATCH /workspaces/<id>`: 403.
2. A thêm B làm ADMIN, thêm C làm MEMBER. B thử nâng C lên ADMIN (403), xóa C (204), xóa A (403).
3. Chạy `EXPLAIN ANALYZE SELECT * FROM workspace_members WHERE user_id = '<uuid>'` trước và sau khi tạm `DROP INDEX workspace_members_user_id_idx` (trên DB dev, rồi chạy lại migration). Với ít dữ liệu planner có thể vẫn chọn seq scan: thử insert vài chục nghìn dòng giả.
4. Tạm sửa `transferOwnership` để bước thứ hai dùng `this.prisma` thay vì `tx` và cho target là user không phải member: quan sát owner cũ bị hạ mà không ai được nâng (workspace mồ côi). Trả lại code.
5. Mở 2 terminal, cùng lúc owner nâng C lên ADMIN và admin B xóa C (dùng `curl` liên tiếp nhanh). Quan sát một bên nhận 409.
