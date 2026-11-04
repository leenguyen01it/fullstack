# REQ-001: Lý thuyết nền tảng (JS, TS, Node, NestJS, Prisma, Docker)

> Code liên quan: `packages/shared`, `apps/api/src`, `apps/api/Dockerfile`, `docker-compose.yml`
> Roadmap: Phase 1 (JS/TS) và Phase 3 (Node + Docker)

## Mục lục
1. [JavaScript core](#1-javascript-core)
2. [TypeScript trong dự án](#2-typescript-trong-dự-án)
3. [Node.js internals](#3-nodejs-internals)
4. [NestJS: kiến trúc và Dependency Injection](#4-nestjs-kiến-trúc-và-dependency-injection)
5. [Module system: ESM và CommonJS, monorepo](#5-module-system-esm-và-commonjs-monorepo)
6. [Prisma và ORM](#6-prisma-và-orm)
7. [Docker](#7-docker)
8. [Health check](#8-health-check)
9. [Câu hỏi phỏng vấn + đáp án mẫu](#9-câu-hỏi-phỏng-vấn--đáp-án-mẫu)
10. [Tự kiểm tra](#10-tự-kiểm-tra)

---

## 1. JavaScript core

### 1.1 Event loop
JavaScript chạy **single-threaded**: chỉ có một **call stack**. Code bất đồng bộ (timer, I/O, Promise) không chạy song song trên stack; callback được đưa vào các **queue** và event loop lấy ra chạy khi stack trống.

Thứ tự ưu tiên trong Node.js (CommonJS):
1. **Code đồng bộ** trên call stack
2. **`process.nextTick` queue** (chỉ có trong Node)
3. **Microtask queue**: `.then/.catch/.finally`, phần code sau `await`, `queueMicrotask`
4. **Macrotask**: `setTimeout`, `setInterval`, `setImmediate`, I/O callback

Sau **mỗi** macrotask, Node xả sạch nextTick queue và microtask queue rồi mới sang macrotask tiếp theo.

```js
console.log('1');
setTimeout(() => console.log('2'), 0);
Promise.resolve().then(() => console.log('3'));
process.nextTick(() => console.log('4'));
(async () => {
  console.log('5');
  await null;
  console.log('6');
})();
console.log('7');
```

**Output:** `1 5 7 4 3 6 2`
- `1`, `5`, `7`: đồng bộ. Hàm `async` chạy đồng bộ cho tới `await` đầu tiên, nên `5` in ra ngay.
- `4`: nextTick được ưu tiên trước microtask.
- `3`, `6`: microtask chạy theo thứ tự được đăng ký (`.then` đăng ký trước phần sau `await`).
- `2`: macrotask (timer) chạy cuối.

> ⚠️ Trong ES module (file `.mjs`), code top-level tự chạy bên trong một microtask, nên `3` và `6` có thể in trước `4`. Interviewer thường hỏi phiên bản CommonJS.

**Hệ quả thực tế:** một vòng lặp CPU nặng (ví dụ tính toán 2 giây) sẽ **chặn toàn bộ server**, không request nào được xử lý trong thời gian đó. Đây là lý do không làm việc nặng CPU trên main thread của Node.

### 1.2 Closure
**Closure** là một function "nhớ" các biến của scope nơi nó được tạo ra, kể cả khi scope đó đã kết thúc.

```js
function createCounter() {
  let count = 0;
  return () => ++count;
}
const next = createCounter();
next(); // 1
next(); // 2  ← count vẫn sống trong closure
```

Ứng dụng: đóng gói state private, `debounce/throttle`, factory function, middleware (`(options) => (req, res, next) => {...}`), React hooks.
**Rủi ro:** memory leak khi closure giữ tham chiếu tới object lớn, ví dụ một event listener không bao giờ được gỡ.

Câu hỏi kinh điển, `var` trong vòng lặp:
```js
for (var i = 0; i < 3; i++) setTimeout(() => console.log(i)); // 3 3 3
for (let i = 0; i < 3; i++) setTimeout(() => console.log(i)); // 0 1 2
```
`var` có function scope (cả 3 callback dùng chung một biến `i`); `let` có block scope (mỗi vòng lặp tạo một binding `i` mới).

### 1.3 `this`
Giá trị của `this` phụ thuộc vào **cách gọi** function, không phụ thuộc nơi khai báo:

| Cách gọi | `this` |
|---|---|
| `new Foo()` | object mới được tạo |
| `fn.call(obj)` / `apply` / `bind` | `obj` |
| `obj.method()` | `obj` |
| `fn()` | `undefined` (strict mode) / `globalThis` |
| Arrow function | kế thừa `this` của scope bao ngoài, không có `this` riêng |

Lỗi hay gặp: truyền `obj.method` làm callback thì mất `this` → dùng arrow function hoặc `.bind(obj)`.

### 1.4 Promise và async/await
- Promise có 3 trạng thái: `pending` → `fulfilled` hoặc `rejected`, và chỉ đổi trạng thái một lần.
- `async/await` là cú pháp tiện hơn trên nền Promise; lỗi được bắt bằng `try/catch`.

| Hàm | Hành vi |
|---|---|
| `Promise.all` | Chờ tất cả; **reject ngay** khi có một cái lỗi |
| `Promise.allSettled` | Chờ tất cả; trả về trạng thái từng cái, không bao giờ reject |
| `Promise.race` | Lấy kết quả của cái **xong đầu tiên** (thành công hoặc lỗi) |
| `Promise.any` | Lấy cái **thành công đầu tiên**; chỉ reject khi tất cả đều lỗi |

📍 Trong dự án: `health.controller.ts` dùng `Promise.all` để kiểm tra DB và Redis **song song**. Nếu dùng hai `await` liên tiếp thì thời gian chờ sẽ là tổng của hai, thay vì lâu nhất trong hai. Hai hàm `isHealthy()` tự `catch` lỗi bên trong nên `Promise.all` không bị reject.

---

## 2. TypeScript trong dự án

### 2.1 Suy ra type từ schema: `z.infer`
```ts
// packages/shared/src/index.ts
export const registerSchema = z.object({ email: z.email(), password: z.string().min(8), ... });
export type RegisterInput = z.infer<typeof registerSchema>;
```
- TypeScript chỉ tồn tại lúc compile; ở runtime type biến mất. **Zod** validate dữ liệu ở runtime, và `z.infer` sinh ra type tương ứng ở compile time.
- Lợi ích: một nguồn sự thật duy nhất cho cả validate và type, dùng chung giữa FE và BE nên không bị lệch.

### 2.2 `as const` và indexed access type
```ts
export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number]; // 'TODO' | 'IN_PROGRESS' | 'DONE'
```
- Không có `as const`, type của mảng là `string[]`. Có `as const`, type là tuple `readonly ['TODO', 'IN_PROGRESS', 'DONE']`.
- `[number]` lấy ra union của tất cả phần tử. Cách này vừa có giá trị dùng ở runtime (cho `z.enum`), vừa có type.

### 2.3 Generics có ràng buộc
```ts
// apps/api/src/common/pipes/zod-validation.pipe.ts
export class ZodValidationPipe<T extends ZodType> implements PipeTransform<unknown, z.infer<T>> { ... }
```
- `T extends ZodType`: T bắt buộc phải là một Zod schema.
- Input là `unknown` (dữ liệu từ client, chưa tin được); output là `z.infer<T>` (đã validate xong, có type chính xác).
- **`unknown` và `any`:** `any` tắt kiểm tra type hoàn toàn. `unknown` buộc phải thu hẹp type (narrowing) trước khi dùng, nên an toàn hơn cho dữ liệu từ bên ngoài.

### 2.4 Decorator và metadata
```ts
@Injectable()
export class PrismaService { constructor(config: ConfigService<Env, true>) {} }
```
- Decorator là function gắn **metadata** vào class, method hoặc property.
- `emitDecoratorMetadata` (trong `tsconfig.json`) khiến TS ghi lại **type của các tham số constructor** ở runtime. NestJS đọc metadata này để biết cần inject cái gì.
- Vì vậy dev server dùng `nest start` (compile bằng `tsc`), không dùng `tsx`/esbuild: esbuild **không hỗ trợ** `emitDecoratorMetadata`, nên DI sẽ hỏng.

### 2.5 Các flag strict quan trọng (`tsconfig.base.json`)
- `strict`: bật `strictNullChecks`, `noImplicitAny`, và các kiểm tra khác.
- `noUncheckedIndexedAccess`: `arr[0]` có type `T | undefined`, buộc phải kiểm tra trước khi dùng.
- `ConfigService<Env, true>`: tham số `true` khiến `config.get('PORT')` trả về `number` thay vì `number | undefined`, vì env đã được validate lúc khởi động.

---

## 3. Node.js internals

### 3.1 Kiến trúc
- **V8:** engine chạy JavaScript.
- **libuv:** thư viện C cung cấp event loop và I/O bất đồng bộ.
  - **Network I/O** (HTTP, TCP, kết nối DB): dùng cơ chế của hệ điều hành (epoll/kqueue), **không** tốn thread.
  - **Thread pool** (mặc định 4 thread, chỉnh bằng `UV_THREADPOOL_SIZE`): dùng cho `fs`, `dns.lookup`, `crypto` (pbkdf2, scrypt), `zlib`. Thư viện `bcrypt` cũng chạy trên thread pool.

**Tại sao single-thread mà vẫn chịu tải cao?** Server web chủ yếu **chờ I/O** (DB, network). Trong lúc chờ, Node không bị block mà xử lý request khác. Một thread có thể giữ hàng nghìn kết nối cùng lúc.
**Khi nào Node không phù hợp?** Tác vụ **CPU-bound** (xử lý ảnh/video, tính toán nặng). Cách xử lý: `worker_threads`, đẩy việc vào queue cho worker riêng, hoặc viết service bằng ngôn ngữ khác.

### 3.2 Các phase của event loop
```
   ┌─> timers          (setTimeout, setInterval)
   │   pending callbacks
   │   poll            (lấy I/O event mới, chạy callback I/O)
   │   check           (setImmediate)
   └── close callbacks (socket.on('close'))
   Giữa các callback: xả nextTick queue + microtask queue
```
- `setImmediate` và `setTimeout(fn, 0)`: ở main module, thứ tự **không xác định**. Bên trong một I/O callback, `setImmediate` **luôn chạy trước** (vì phase check nằm ngay sau phase poll).
- Lạm dụng `process.nextTick` đệ quy có thể gây "đói" (starve) I/O, vì nextTick queue luôn được xả trước.

### 3.3 Graceful shutdown
📍 `main.ts` gọi `app.enableShutdownHooks()`. Khi nhận `SIGTERM` (Docker/K8s gửi tín hiệu này khi dừng container), NestJS gọi `onModuleDestroy`, từ đó `PrismaService` đóng kết nối DB và `RedisService` gọi `quit()`.
Nếu không làm vậy: request đang xử lý dở bị cắt ngang, kết nối DB bị treo lại phía server. Sau một khoảng grace period (mặc định 10 giây trong Docker), process sẽ bị `SIGKILL`.

---

## 4. NestJS: kiến trúc và Dependency Injection

### 4.1 Các khối xây dựng
| Khối | Vai trò | Trong dự án |
|---|---|---|
| **Module** | Gom các thành phần liên quan thành một nhóm | `AppModule`, `PrismaModule`, `RedisModule` |
| **Controller** | Nhận HTTP request, trả response | `HealthController` |
| **Provider/Service** | Chứa business logic, được inject vào nơi khác | `PrismaService`, `RedisService` |
| **`@Global()`** | Export provider cho mọi module mà không cần import | `PrismaModule`, `RedisModule` |

### 4.2 Dependency Injection (DI) và Inversion of Control (IoC)
```ts
constructor(private readonly prisma: PrismaService, private readonly redis: RedisService) {}
```
- Class **không tự `new`** các dependency của nó. **IoC container** của Nest tạo instance (mặc định là **singleton**) và truyền vào qua constructor.
- **Lợi ích:**
  - Loose coupling: dễ thay implementation.
  - **Dễ test:** khi test có thể thay `PrismaService` bằng mock (`Test.createTestingModule(...).overrideProvider(...)`).
  - Quản lý vòng đời tập trung (lifecycle hook).
- Scope: `DEFAULT` (singleton), `REQUEST` (mỗi request một instance, chậm hơn), `TRANSIENT`.

### 4.3 Request lifecycle (rất hay bị hỏi)
```
Request
 → Middleware        (helmet, cors, pino-http logger)
 → Guard             (auth, phân quyền: cho đi tiếp hay không)       ← REQ-002, REQ-003
 → Interceptor (trước)
 → Pipe              (validate/transform input: ZodValidationPipe)
 → Controller handler → Service
 → Interceptor (sau) (biến đổi response, đo thời gian)
 → Exception Filter  (nếu có lỗi: AllExceptionsFilter)
Response
```
📍 `AllExceptionsFilter` dùng `@Catch()` không tham số, nên bắt **mọi** lỗi và đưa về một format `ApiError` thống nhất. Lỗi 5xx được log kèm stack trace, nhưng client chỉ nhận message chung chung (không lộ chi tiết nội bộ).

### 4.4 Lifecycle hooks
`onModuleInit` → `onApplicationBootstrap` → (app chạy) → `onModuleDestroy` → `beforeApplicationShutdown` → `onApplicationShutdown`.

### 4.5 Validate config khi khởi động (fail fast)
📍 `config/env.ts` validate `process.env` bằng Zod ngay lúc app khởi động. Nếu thiếu `DATABASE_URL`, app **dừng ngay** với lỗi rõ ràng, thay vì chạy được và tới khi có request đầu tiên mới lỗi một cách khó hiểu.

---

## 5. Module system: ESM và CommonJS, monorepo

| | CommonJS (CJS) | ES Modules (ESM) |
|---|---|---|
| Cú pháp | `require` / `module.exports` | `import` / `export` |
| Load | Đồng bộ, lúc runtime | Bất đồng bộ, phân tích tĩnh |
| Tree shaking | Khó | Có (bundler loại được code không dùng) |
| Top-level await | Không | Có |

📍 **Vấn đề trong dự án:** NestJS chạy bằng CJS, còn Vite/React dùng ESM. Package `shared` được build ra **cả hai** định dạng bằng `tsup`, và `package.json` khai báo trường `exports` có điều kiện:
```json
"exports": { ".": {
  "import":  { "types": "./dist/index.d.ts",  "default": "./dist/index.js" },
  "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
}}
```
Node hoặc bundler tự chọn file theo cách gọi: `import` lấy file `.js`, `require` lấy file `.cjs`.

**npm workspaces / monorepo:** nhiều package trong cùng một repo, `npm install` một lần ở gốc. Các package nội bộ được **symlink** vào `node_modules/@taskflow/*`, dependency chung được **hoist** lên `node_modules` ở gốc.
Ưu điểm: chia sẻ code và type, thay đổi đồng bộ (atomic) trong một commit. Nhược điểm: CI/build phức tạp hơn khi repo lớn (lúc đó dùng Turborepo/Nx).

---

## 6. Prisma và ORM

- **ORM** (Object-Relational Mapping): làm việc với DB qua object và method thay vì viết SQL tay.
  - Ưu điểm: type-safe, nhanh khi làm CRUD, có migration.
  - Nhược điểm: dễ sinh query kém (N+1), query phức tạp vẫn cần SQL thuần (`$queryRaw`).
- **`schema.prisma`:** nguồn sự thật duy nhất cho data model. `prisma generate` sinh ra client có type đầy đủ (trong dự án là `src/generated/prisma`).
- **Migration:** file SQL có version, lưu trong git, để mọi môi trường có cùng schema.

| Lệnh | Dùng ở đâu | Hành vi |
|---|---|---|
| `prisma migrate dev` | Máy dev | So sánh schema với DB, **tạo** migration mới và áp dụng; có thể reset DB |
| `prisma migrate deploy` | CI / Production | **Chỉ áp dụng** các migration đang chờ, không bao giờ tạo mới hay reset |

📍 Trong `docker-compose.yml`, service `migrate` chạy `migrate deploy` trước, còn `api` chỉ khởi động khi `migrate` đã `service_completed_successfully`.

- **Driver adapter (Prisma 7):** Prisma client giao tiếp với Postgres qua driver JavaScript `pg` (`@prisma/adapter-pg`) thay vì engine Rust riêng như các bản trước.
- **Connection pool:** mở kết nối DB rất tốn kém (TCP + TLS + xác thực), nên tái sử dụng một pool kết nối. Vì vậy `PrismaService` là **singleton**: nếu mỗi request lại `new PrismaClient()`, DB sẽ nhanh chóng hết `max_connections`.

---

## 7. Docker

### 7.1 Khái niệm
- **Image:** bản đóng gói chỉ đọc, gồm nhiều **layer** xếp chồng; mỗi lệnh trong Dockerfile tạo một layer.
- **Container:** một instance đang chạy của image, có thêm một layer ghi được ở trên cùng.
- **Container và VM:** container **dùng chung kernel** của host và chỉ cô lập bằng namespace + cgroup, nên nhẹ và khởi động trong vài giây. VM có kernel và hệ điều hành riêng, nên nặng hơn nhưng cô lập mạnh hơn.
- **Volume:** lưu dữ liệu bền vững bên ngoài container (`postgres-data`). Xóa container thì dữ liệu vẫn còn.

### 7.2 Layer cache: thứ tự lệnh quan trọng
📍 `apps/api/Dockerfile`:
```dockerfile
COPY package.json package-lock.json ./      # 1. chỉ copy file khai báo dependency
COPY apps/api/package.json apps/api/
RUN npm ci ...                               # 2. cài dependency (lâu)
COPY apps/api apps/api                       # 3. sau đó mới copy source code
```
Khi chỉ sửa code mà không đổi dependency, layer `npm ci` được lấy từ cache, nên build chỉ mất vài giây thay vì vài phút. Nếu `COPY . .` ngay từ đầu, mỗi lần sửa code đều phải cài lại toàn bộ dependency.

### 7.3 Multi-stage build
```
deps    → cài toàn bộ dependency (kể cả devDependency)
build   → compile TypeScript ra dist/
runtime → cài lại chỉ dependency production + copy dist/  ← chỉ stage này thành image cuối
```
Image cuối không chứa compiler, source TypeScript hay devDependency, nên **nhỏ hơn** và **ít bề mặt tấn công hơn**. Ngoài ra container chạy bằng user `node` (không phải root).

### 7.4 Câu chuyện thực tế để kể khi phỏng vấn: image 3.73GB → 827MB
- **Triệu chứng:** image API nặng 3.73GB.
- **Điều tra:** chạy `du -sh node_modules/*` bên trong image và thấy `@prisma` chiếm 2.2GB. `npm explain prisma` cho thấy `@prisma/client` khai báo `prisma` là **optional peer dependency**; npm tự cài bản `8.0.0-rc` (kèm rất nhiều gói phụ). Vì là peer chứ không phải dev dependency nên `--omit=dev` không loại bỏ được.
- **Sửa:** thêm `overrides: { prisma: "7.10.1" }` trong `package.json` ở gốc, tạo lại lockfile. Image còn 827MB.
- **Bước tiếp theo** (để dành cho REQ-014): `npm ci -w` vẫn cài dependency của các workspace khác; có thể dùng `turbo prune`, bundle API bằng esbuild, hoặc dùng image distroless.
- **Bài học:** luôn kiểm tra kích thước image; hiểu các loại dependency (dependencies, devDependencies, peerDependencies, optionalDependencies); không cài bản `rc` cho production.

### 7.5 docker-compose
- `depends_on` + `condition: service_healthy`: chờ Postgres **thật sự sẵn sàng nhận kết nối**, không chỉ chờ container khởi động xong.
- `profiles: ['app']`: `npm run infra:up` chỉ bật hạ tầng; `--profile app` bật thêm API và web.
- Port bind `127.0.0.1:...`: chỉ truy cập được từ máy local, không lộ DB ra mạng ngoài.
- Trong mạng nội bộ của compose, các service gọi nhau bằng **tên service** (`postgres:5432`, `redis:6379`), không dùng `localhost`.

---

## 8. Health check

📍 `GET /health` trả về **200** khi DB và Redis đều `up`, và **503 Service Unavailable** khi có ít nhất một cái `down`. Load balancer và orchestrator đọc **status code**, không đọc nội dung body.

**Liveness và readiness** (K8s, sẽ làm ở REQ-014):
| | Liveness | Readiness |
|---|---|---|
| Câu hỏi | Process còn sống không? | Có phục vụ được request không? |
| Thất bại thì | **Restart** container | **Ngừng gửi traffic** tới container (không restart) |
| Nên kiểm tra | Chỉ bản thân process | Cả các dependency (DB, Redis) |

⚠️ `/health` hiện tại kiểm tra cả DB, tức là một readiness check. Nếu dùng nó làm **liveness**, khi DB sập K8s sẽ restart **toàn bộ** pod API liên tục. Restart không làm DB sống lại, chỉ khiến sự cố nặng thêm (cascading failure). Vì vậy cần tách ra `/health/live` và `/health/ready`.

---

## 9. Câu hỏi phỏng vấn + đáp án mẫu

<details><summary><b>Q1. Node.js single-thread vậy sao xử lý được nhiều request đồng thời?</b></summary>

Code JS chạy trên một thread, nhưng I/O được giao cho libuv và hệ điều hành xử lý bất đồng bộ. Network I/O dùng epoll/kqueue; file, crypto, dns dùng thread pool. Trong lúc chờ DB trả kết quả, event loop tiếp tục xử lý request khác. Vì web server chủ yếu là I/O-bound nên mô hình này rất hiệu quả. Điểm yếu là tác vụ CPU-bound sẽ block event loop; khi đó em dùng worker_threads hoặc đẩy việc sang queue cho worker riêng xử lý.
</details>

<details><summary><b>Q2. So sánh process.nextTick, Promise.then, setImmediate, setTimeout(0).</b></summary>

nextTick chạy ngay sau thao tác hiện tại và trước cả microtask. Promise.then là microtask, chạy khi call stack trống, trước mọi macrotask. setTimeout(0) thuộc phase timers; setImmediate thuộc phase check. Ở main module, thứ tự giữa setTimeout(0) và setImmediate không xác định; bên trong I/O callback thì setImmediate luôn chạy trước. Lạm dụng nextTick đệ quy có thể làm đói I/O.
</details>

<details><summary><b>Q3. Dependency Injection là gì? Lợi ích trong NestJS?</b></summary>

DI là việc một class nhận dependency từ bên ngoài thay vì tự tạo. NestJS có IoC container đọc metadata của constructor (nhờ emitDecoratorMetadata), tạo instance (mặc định là singleton) và inject vào. Lợi ích: giảm coupling, dễ thay implementation, và quan trọng nhất là dễ test, vì có thể override PrismaService bằng mock trong testing module. Ví dụ trong dự án em, PrismaService là singleton nên toàn app dùng chung một connection pool.
</details>

<details><summary><b>Q4. Mô tả request lifecycle trong NestJS.</b></summary>

Middleware → Guard → Interceptor (trước) → Pipe → Handler → Interceptor (sau) → Response. Có lỗi ở bất kỳ bước nào thì Exception Filter xử lý. Guard quyết định có cho request đi tiếp không (auth, phân quyền); Pipe validate và transform input; Interceptor dùng cho logging, cache, biến đổi response; Filter chuẩn hóa format lỗi. Trong dự án em có một global filter đưa mọi lỗi về chung một format ApiError.
</details>

<details><summary><b>Q5. Làm sao tối ưu Docker image cho app Node?</b></summary>

(1) Multi-stage build: stage build có devDependency và compiler, stage runtime chỉ có dependency production và dist. (2) Sắp thứ tự layer: copy package.json/lockfile và npm ci trước, copy source sau để tận dụng cache. (3) Base image nhỏ (alpine/distroless). (4) .dockerignore để loại node_modules, .git, .env. (5) Chạy bằng user không phải root. Kể thêm câu chuyện thực tế: image của em từng nặng 3.73GB vì npm tự cài optional peer dependency là bản prisma rc; em điều tra bằng du và npm explain, sửa bằng overrides, image còn 827MB.
</details>

<details><summary><b>Q6. Container khác VM thế nào?</b></summary>

Container dùng chung kernel của host và được cô lập bằng namespace (process, network, filesystem) và cgroup (giới hạn CPU, RAM). Nhờ vậy nó nhẹ, khởi động nhanh, chạy được nhiều container trên một máy. VM chạy hệ điều hành riêng trên hypervisor nên nặng hơn nhưng cô lập mạnh hơn. Container không chạy được kernel khác với host: ví dụ container Linux trên macOS thực chất chạy bên trong một VM Linux.
</details>

<details><summary><b>Q7. migrate dev và migrate deploy khác nhau thế nào? Chạy migration trên production ra sao?</b></summary>

migrate dev dùng ở máy dev: so sánh schema, tạo file migration mới và có thể reset DB. migrate deploy chỉ áp dụng các migration chưa chạy, không tạo mới hay reset, nên an toàn cho production. Migration nên chạy thành một bước riêng trong pipeline hoặc một job/init container trước khi app khởi động, giống service migrate trong docker-compose của em. Với bảng lớn cần thay đổi kiểu backward-compatible (expand và contract): thêm cột mới trước, deploy code mới, rồi mới xóa cột cũ, để không có downtime.
</details>

<details><summary><b>Q8. Tại sao PrismaClient phải là singleton?</b></summary>

Mỗi PrismaClient giữ một connection pool riêng. Nếu tạo mới cho mỗi request, số kết nối tăng rất nhanh, vượt max_connections của Postgres và gây lỗi "too many connections"; ngoài ra mở kết nối cũng tốn thời gian (TCP + TLS + xác thực). Singleton giúp tái sử dụng pool. Khi scale nhiều instance thì tổng số kết nối bằng số instance nhân pool size; lúc đó cần pgBouncer.
</details>

<details><summary><b>Q9. Liveness probe khác readiness probe thế nào?</b></summary>

Liveness trả lời "process còn sống không"; nếu fail, K8s restart container. Readiness trả lời "có nhận traffic được không"; nếu fail, K8s rút pod khỏi Service nhưng không restart. Liveness chỉ nên kiểm tra bản thân process, không kiểm tra DB: nếu DB sập mà liveness lại kiểm tra DB thì toàn bộ pod bị restart liên tục, sự cố lan rộng thêm.
</details>

<details><summary><b>Q10. Tại sao validate env lúc khởi động? Tại sao dùng Zod khi đã có TypeScript?</b></summary>

Fail fast: thiếu hoặc sai config thì app dừng ngay khi deploy, kèm thông báo rõ ràng, thay vì chạy được rồi lỗi ngẫu nhiên lúc có request. TypeScript chỉ kiểm tra lúc compile, còn dữ liệu từ env, request body hay API bên ngoài là dữ liệu runtime mà TS không đảm bảo được. Zod validate ở runtime, và z.infer sinh type từ schema nên không phải khai báo hai lần.
</details>

<details><summary><b>Q11. ESM khác CJS thế nào? Package dùng cho cả hai môi trường thì xử lý ra sao?</b></summary>

CJS dùng require, load đồng bộ lúc runtime. ESM dùng import/export, phân tích tĩnh được nên hỗ trợ tree shaking và top-level await. Package shared của em build ra cả .js (ESM) và .cjs (CJS) bằng tsup; trường exports trong package.json dùng điều kiện import/require để Node hoặc bundler tự chọn đúng file và đúng file type.
</details>

<details><summary><b>Q12. Output của đoạn code ở mục 1.1? Giải thích.</b></summary>

1 5 7 4 3 6 2. Code đồng bộ chạy trước (hàm async chạy đồng bộ tới await đầu tiên nên 5 in sớm). Sau đó nextTick (4), rồi microtask theo thứ tự đăng ký (3 rồi 6), cuối cùng là timer (2).
</details>

---

## 10. Tự kiểm tra

Đánh dấu khi bạn **tự giải thích được bằng lời** mà không cần nhìn tài liệu:

- [ ] Vẽ được sơ đồ event loop và giải thích output của các đoạn code trộn timer, Promise, nextTick
- [ ] Giải thích closure và lỗi `var` trong vòng lặp
- [ ] Nêu 5 quy tắc xác định `this`
- [ ] Phân biệt `Promise.all`, `allSettled`, `race`, `any`
- [ ] Giải thích `z.infer`, `as const`, generics có ràng buộc trong code của dự án
- [ ] Giải thích tại sao NestJS cần `emitDecoratorMetadata`
- [ ] Vẽ request lifecycle của NestJS
- [ ] Giải thích graceful shutdown và SIGTERM
- [ ] Phân biệt ESM và CJS; giải thích trường `exports` của `packages/shared`
- [ ] Phân biệt `migrate dev` và `migrate deploy`
- [ ] Giải thích layer cache và multi-stage build trong `apps/api/Dockerfile`
- [ ] Kể được câu chuyện image 3.73GB → 827MB theo mô hình STAR
- [ ] Phân biệt liveness và readiness

### 🛠 Bài tập thực hành (làm trong `scratch/` hoặc REPL)
1. Tự viết `debounce`, `throttle`, `Promise.all`, `memoize` bằng TypeScript.
2. Viết type `DeepPartial<T>` và `DeepReadonly<T>`.
3. Viết một endpoint tính Fibonacci(45) đồng bộ, gọi song song với `/health`, quan sát `/health` bị block. Sau đó chuyển sang `worker_threads` và so sánh.
4. Chạy `docker history taskflow-api` và giải thích từng layer.
