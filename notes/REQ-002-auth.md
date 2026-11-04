# REQ-002: Authentication (HTTP, cookie, CORS, JWT, hashing, XSS/CSRF, OAuth2)

> Code liên quan: `apps/api/src/auth/*`, `apps/api/src/config/env.ts`, `apps/api/prisma/schema.prisma` (model `RefreshToken`), `packages/shared/src/index.ts`, `apps/web/src/api/client.ts`, `apps/web/src/auth/*`
> Roadmap: Phase 2 (HTTP), Phase 3 (Authentication & Authorization), Bảo mật

## Mục lục

1. [HTTP nền tảng cho auth](#1-http-nền-tảng-cho-auth)
2. [Cookie](#2-cookie)
3. [CORS](#3-cors)
4. [Session và JWT](#4-session-và-jwt)
5. [JWT chi tiết](#5-jwt-chi-tiết)
6. [Access token + refresh token: rotation, reuse detection, revoke](#6-access-token--refresh-token-rotation-reuse-detection-revoke)
7. [Lưu token ở đâu](#7-lưu-token-ở-đâu)
8. [Hash mật khẩu](#8-hash-mật-khẩu)
9. [XSS và CSRF](#9-xss-và-csrf)
10. [OAuth2 và OpenID Connect](#10-oauth2-và-openid-connect)
11. [Luồng auth trong TaskFlow](#11-luồng-auth-trong-taskflow)
12. [Câu hỏi phỏng vấn + đáp án mẫu](#12-câu-hỏi-phỏng-vấn--đáp-án-mẫu)
13. [Tự kiểm tra](#13-tự-kiểm-tra)

---

## 1. HTTP nền tảng cho auth

### 1.1 HTTP là stateless

Mỗi request độc lập, server không "nhớ" request trước. Muốn biết "ai đang gọi" thì **mỗi request phải tự mang theo bằng chứng** (credential): cookie chứa session id, hoặc header `Authorization: Bearer <token>`.

### 1.2 Authentication và Authorization

|                      | Authentication (AuthN)                                | Authorization (AuthZ)                      |
| -------------------- | ----------------------------------------------------- | ------------------------------------------ |
| Câu hỏi              | Bạn là ai?                                            | Bạn được làm gì?                           |
| Ví dụ trong TaskFlow | Login, verify JWT trong `JwtAuthGuard`                | Owner/admin/member của workspace (REQ-003) |
| Status code khi fail | **401 Unauthorized** (thực chất là "unauthenticated") | **403 Forbidden**                          |

Các status khác hay gặp trong REQ này: `201 Created` (register), `204 No Content` (logout), `409 Conflict` (email đã tồn tại), `400 Bad Request` (validate fail).

### 1.3 Header quan trọng

- `Authorization: Bearer <access token>`: client gửi access token.
- `Set-Cookie`: server yêu cầu browser lưu cookie (refresh token).
- `Cookie`: browser **tự động** gửi cookie phù hợp với domain/path của request. Chính sự "tự động" này là nguồn gốc của CSRF (mục 9).
- `Origin`: browser tự gắn vào request cross-origin và mọi request POST; server dùng để kiểm tra CORS.

---

## 2. Cookie

Cookie là cặp key/value server gửi qua `Set-Cookie`, browser lưu và gửi lại trong các request sau. Các attribute quyết định bảo mật:

| Attribute           | Ý nghĩa                                                                                                          | TaskFlow dùng                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `HttpOnly`          | JavaScript (`document.cookie`) **không đọc được**. Chặn XSS lấy trộm cookie.                                     | ✅                                                                            |
| `Secure`            | Chỉ gửi qua HTTPS (riêng `localhost` được coi là secure context).                                                | ✅ khi `NODE_ENV=production`                                                  |
| `SameSite=Strict`   | Không gửi cookie khi request xuất phát từ site khác.                                                             | ✅                                                                            |
| `SameSite=Lax`      | Chỉ gửi khi điều hướng top-level bằng GET (bấm link). Là default của Chrome.                                     |                                                                               |
| `SameSite=None`     | Luôn gửi, bắt buộc kèm `Secure`. Dùng khi frontend và API khác site.                                             |                                                                               |
| `Path`              | Chỉ gửi cookie khi URL bắt đầu bằng path này.                                                                    | `/api/auth`: refresh token chỉ đi tới endpoint auth, không đi kèm mọi request |
| `Domain`            | Không set thì cookie chỉ thuộc đúng host hiện tại (an toàn nhất). Set `.example.com` thì mọi subdomain đều nhận. | không set                                                                     |
| `Max-Age`/`Expires` | Thời gian sống. Không set thì là session cookie, mất khi đóng browser.                                           | 7 ngày                                                                        |

### 2.1 Same-site khác same-origin

- **Origin** = scheme + host + port. `https://app.taskflow.com` và `https://api.taskflow.com` là **khác origin**.
- **Site** = scheme + eTLD+1 (registrable domain). Hai URL trên là **cùng site** (`taskflow.com`).
- CORS làm việc theo **origin**, còn SameSite làm việc theo **site**. Vì vậy `SameSite` không chặn được tấn công từ một subdomain bị chiếm (`evil.taskflow.com`).

### 2.2 Vì sao `Path=/api/auth` trong TaskFlow

Browser gọi `/api/auth/refresh`; Vite proxy (dev) và nginx (Docker) cắt prefix `/api` trước khi chuyển cho NestJS. Cookie path được browser so với URL **phía browser**, nên phải là `/api/auth` (giá trị `REFRESH_COOKIE_PATH` trong `apps/api/src/config/env.ts`). Hệ quả: gọi thẳng `http://localhost:3000/auth/refresh` (ví dụ từ Swagger) sẽ không mang cookie.

---

## 3. CORS

**Same-Origin Policy (SOP):** browser không cho JavaScript ở origin A **đọc response** từ origin B. **CORS** là cơ chế để server B nới lỏng SOP bằng header.

- **Simple request** (GET/POST với vài content-type đơn giản): browser gửi luôn, rồi chỉ chặn JS đọc response nếu thiếu `Access-Control-Allow-Origin`. Nghĩa là **request vẫn tới server**, side effect vẫn xảy ra. Đây là lý do CORS không chống được CSRF.
- **Preflight** (`OPTIONS`): khi dùng method khác, header custom (`Authorization`) hoặc `Content-Type: application/json`, browser hỏi trước; server không cho phép thì request thật không được gửi.
- **Credentials:** muốn browser gửi cookie cross-origin, client phải `fetch(url, { credentials: 'include' })` và server phải trả `Access-Control-Allow-Credentials: true` kèm **origin cụ thể**, không được dùng `*`.

Trong TaskFlow: `app.enableCors({ origin: CORS_ORIGIN.split(','), credentials: true })` ở `apps/api/src/main.ts`. Thực tế web gọi qua proxy `/api` nên là **same-origin**, CORS chỉ cần khi gọi API trực tiếp từ origin khác.

> ⚠️ CORS là cơ chế bảo vệ **người dùng trên browser**, không phải bảo vệ server. `curl` hay Postman bỏ qua CORS hoàn toàn.

---

## 4. Session và JWT

|                            | Server-side session                                       | JWT (stateless token)                                  |
| -------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| Lưu state ở đâu            | Server (Redis/DB), client chỉ giữ session id trong cookie | Trong chính token (claims đã ký), server không cần lưu |
| Verify mỗi request         | Tra Redis/DB                                              | Verify chữ ký bằng CPU, không I/O                      |
| Revoke (logout, khóa user) | Dễ: xóa session                                           | Khó: token còn hạn thì vẫn hợp lệ cho tới khi hết hạn  |
| Scale ngang                | Cần store dùng chung (Redis)                              | Mọi instance verify được nếu có key                    |
| Kích thước                 | Nhỏ (id)                                                  | Lớn hơn (header + payload + signature)                 |
| Phù hợp                    | Web app truyền thống, cần revoke tức thì                  | Microservice, mobile, API cho bên thứ ba               |

**Kết luận thực tế:** không có cái nào "tốt hơn" tuyệt đối. Hệ thống phổ biến (và TaskFlow) dùng **hybrid**: access token JWT ngắn hạn (stateless, nhanh) + refresh token **có lưu trong DB** (stateful, revoke được). Như vậy ta lấy được lợi ích của cả hai: request thường không cần query DB, còn quyền "gia hạn phiên" vẫn nằm trong tay server.

---

## 5. JWT chi tiết

### 5.1 Cấu trúc

`base64url(header).base64url(payload).base64url(signature)`

```json
// header
{ "alg": "HS256", "typ": "JWT" }
// payload (claims)
{ "sub": "<userId>", "jti": "<uuid>", "iat": 1762240000, "exp": 1762240900, "iss": "taskflow-api", "aud": "taskflow-web" }
```

- **Registered claims:** `sub` (subject, ai), `exp` (hết hạn), `iat` (phát hành lúc), `jti` (id duy nhất của token), `iss` (issuer), `aud` (audience).
- Payload chỉ được **encode** (base64url), **không mã hóa**. Ai cầm token cũng đọc được → không bao giờ để password, PII nhạy cảm trong payload.
- Chữ ký đảm bảo **integrity** (không sửa được) chứ không đảm bảo **confidentiality**. Cần bí mật thì dùng JWE.

### 5.2 HS256 và RS256

|                | HS256 (HMAC)                                      | RS256 / ES256 (asymmetric)                                   |
| -------------- | ------------------------------------------------- | ------------------------------------------------------------ |
| Key            | Một secret dùng chung để ký và verify             | Private key ký, public key verify                            |
| Ai verify được | Chỉ ai giữ secret (cũng ký được luôn)             | Ai có public key (công khai qua JWKS)                        |
| Dùng khi       | Một service vừa ký vừa verify (TaskFlow hiện tại) | Nhiều service verify, hoặc identity provider (Google, Auth0) |

TaskFlow dùng HS256 với `JWT_ACCESS_SECRET` tối thiểu 32 ký tự (Zod bắt buộc trong `env.ts`). Khi tách microservice ở Phase 8, chuyển sang RS256 để service khác chỉ cần public key.

### 5.3 Lỗ hổng kinh điển

- **`alg: none`:** token không chữ ký. Thư viện cũ chấp nhận nếu không ép thuật toán.
- **Algorithm confusion:** server dùng RS256, attacker đổi header thành HS256 và ký bằng **public key** (vốn công khai) như thể nó là HMAC secret.
- **Cách phòng:** luôn truyền danh sách `algorithms` khi verify. `AccessTokenService.verify` gọi `verifyAsync(token, { algorithms: ['HS256'], issuer, audience })`.
- **Secret yếu:** HS256 với secret ngắn có thể bị brute-force offline (attacker chỉ cần một token hợp lệ). Dùng secret ngẫu nhiên ≥ 256 bit: `openssl rand -base64 48`.

---

## 6. Access token + refresh token: rotation, reuse detection, revoke

### 6.1 Vì sao cần hai token

- **Access token:** ngắn hạn (15 phút), gửi kèm mọi request, stateless. Lộ thì thiệt hại bị giới hạn trong 15 phút.
- **Refresh token:** dài hạn (7 ngày), chỉ dùng để xin access token mới, chỉ đi tới `/api/auth/*`. Được lưu trong DB nên revoke được.

Nếu chỉ dùng một JWT dài hạn: lộ là attacker dùng được nhiều ngày và không có cách thu hồi.

### 6.2 Refresh token trong TaskFlow là opaque, không phải JWT

`crypto.randomBytes(32).toString('base64url')`: chuỗi ngẫu nhiên 256 bit, không mang thông tin gì. Vì server luôn tra DB khi refresh, không cần tự chứa claims như JWT.

DB chỉ lưu **SHA-256 hash** của token (`token_hash`), không lưu token gốc. Lộ DB thì attacker cũng không dùng được token. Ở đây dùng SHA-256 (nhanh) chứ không cần argon2 (chậm) vì token có 256 bit entropy, brute-force là bất khả thi; password thì entropy thấp nên mới cần hash chậm (mục 8).

### 6.3 Rotation

Mỗi lần gọi `/auth/refresh`: token cũ bị đánh dấu `rotated_at`, server phát token mới **cùng `family_id`**. Một refresh token chỉ dùng được **một lần**.

### 6.4 Reuse detection

Nếu một token **đã rotate** lại được gửi lên, nghĩa là có hai bên cùng cầm nó: user thật và attacker. Server không biết ai là ai, nên **revoke cả family** → cả hai phải login lại. Attacker mất quyền truy cập, user thật bị logout và nhận ra vấn đề.

```
login        → T1 (family F)
refresh(T1)  → T2, T1.rotated_at = now
refresh(T1)  → T1 đã rotate → REUSE → revoke mọi token của F → 401
refresh(T2)  → T2 đã bị revoke → 401
```

### 6.5 Race condition: grace window và conditional update

Hai trường hợp hợp lệ khiến **cùng một token bị gửi hai lần gần như đồng thời**:

1. React `StrictMode` chạy `useEffect` hai lần ở dev.
2. User mở hai tab, cả hai cùng refresh khi load.

Cách xử lý trong `RefreshTokenService.rotate`:

- **Conditional update (optimistic concurrency):** `updateMany({ where: { id, rotatedAt: null, revokedAt: null }, data: { rotatedAt: now } })`. Postgres đảm bảo chỉ một request thấy `count === 1`; request kia thấy `count === 0` và thua. Nếu làm kiểu "đọc rồi kiểm tra rồi ghi" (check-then-act) thì cả hai đều qua bước kiểm tra và đều phát token mới.
- **Grace window (10 giây):** token đã rotate trong vòng 10 giây thì coi là race hợp lệ, chỉ trả 401 chứ không revoke family. Quá 10 giây mới coi là reuse.
- **Phía client:** `refreshAccessToken` trong `apps/web/src/api/client.ts` là **single-flight**: nhiều lời gọi đồng thời dùng chung một Promise, nên trong một tab chỉ có một request refresh.

### 6.6 Logout với JWT

Access token stateless nên "logout" gồm:

1. Revoke refresh token family trong DB và xóa cookie → không gia hạn được nữa.
2. Đưa `jti` của access token hiện tại vào **denylist trên Redis** với TTL = thời gian còn lại của token (`auth:denylist:<jti>`). `JwtAuthGuard` kiểm tra denylist mỗi request.

Bước 2 làm mất một phần tính stateless (mỗi request thêm một lệnh `EXISTS` trên Redis, khoảng < 1ms). Đây là trade-off có chủ đích: nếu chấp nhận access token còn sống tối đa 15 phút sau logout thì có thể bỏ denylist. Denylist chỉ chứa token đã logout và tự hết hạn, nên Redis không phình ra.

Các cách revoke khác: đổi `tokenVersion` của user (mọi token có version cũ bị từ chối), đổi secret (logout toàn hệ thống).

---

## 7. Lưu token ở đâu

| Nơi lưu           | XSS đọc được?                     | CSRF?                                | Ghi chú                                            |
| ----------------- | --------------------------------- | ------------------------------------ | -------------------------------------------------- |
| `localStorage`    | ✅ Có, script nào cũng đọc được   | Không (không tự gửi)                 | Đơn giản nhưng XSS là mất token dài hạn            |
| Memory (biến JS)  | Khó hơn (phải chạy code đúng lúc) | Không                                | Mất khi reload → cần refresh token để khôi phục    |
| Cookie `HttpOnly` | ❌ Không đọc được                 | Có, vì browser tự gửi → cần SameSite | Không dùng được cho mobile/CLI gọi API khác domain |

**TaskFlow:** access token trong **memory** (`apps/web/src/api/client.ts`), refresh token trong **cookie HttpOnly + SameSite=Strict + Path=/api/auth**. Khi reload trang, `AuthProvider` gọi `/auth/refresh` để lấy lại access token ("silent login").

> ⚠️ Không có cách nào miễn nhiễm XSS. Nếu attacker chạy được JS trên trang, họ có thể gửi request **thay mặt user** ngay lúc đó dù không đọc được cookie. HttpOnly chỉ ngăn họ **mang token đi** dùng lâu dài. Chống XSS vẫn là ưu tiên số một.

---

## 8. Hash mật khẩu

### 8.1 Hash, encrypt, encode

- **Encode** (base64): đảo ngược được, không có key. Không phải bảo mật.
- **Encrypt** (AES): đảo ngược được nếu có key. Dùng cho dữ liệu cần đọc lại.
- **Hash** (SHA-256, argon2): một chiều. Password chỉ cần **so sánh**, không cần đọc lại → hash.

### 8.2 Vì sao không dùng SHA-256 cho password

SHA-256 được thiết kế để **nhanh**: GPU tính hàng tỷ hash/giây. Password do người đặt có entropy thấp nên brute-force/dictionary attack rất nhanh. Cần **slow hash** có tham số chi phí điều chỉnh được.

- **Salt:** chuỗi ngẫu nhiên riêng cho từng password, lưu kèm hash. Hai user cùng password vẫn có hash khác nhau → vô hiệu hóa **rainbow table** và buộc attacker crack từng user một.
- **Pepper:** secret chung lưu ngoài DB (env/KMS). Lộ DB mà không lộ pepper thì vẫn chưa crack được. TaskFlow chưa dùng.

### 8.3 bcrypt và argon2

|                | bcrypt                                | argon2id                                              |
| -------------- | ------------------------------------- | ----------------------------------------------------- |
| Năm            | 1999                                  | 2015 (thắng Password Hashing Competition)             |
| Tham số        | cost (số vòng, 2^cost)                | memory, time (iterations), parallelism                |
| Chống GPU/ASIC | Trung bình                            | Tốt, nhờ **memory-hard** (mỗi lần hash tốn nhiều RAM) |
| Giới hạn       | Chỉ dùng **72 byte** đầu của password | Không                                                 |

TaskFlow dùng **argon2id** (`PasswordService` trong `apps/api/src/auth/password.service.ts`) với cấu hình mặc định của thư viện `argon2` (memory 64 MiB, time 3). Hash có dạng `$argon2id$v=19$m=65536,t=3,p=4$<salt>$<hash>`: thuật toán, tham số và salt nằm ngay trong chuỗi, nên sau này tăng tham số thì hash cũ vẫn verify được (và có thể rehash khi user login lại).

Schema giới hạn password tối đa 128 ký tự: hash chậm nghĩa là password cực dài có thể bị lợi dụng để DoS server.

### 8.4 Timing attack và user enumeration

- Login trả về **cùng một thông báo** `Invalid email or password` cho cả "email không tồn tại" và "sai mật khẩu".
- Nhưng nếu email không tồn tại mà server trả lời ngay, còn email tồn tại thì tốn ~50ms để verify argon2, attacker vẫn **đo thời gian** để biết email nào có tài khoản. Vì vậy `AuthService.login` vẫn verify với một **dummy hash** khi không tìm thấy user, để thời gian phản hồi như nhau.
- Endpoint register thì buộc phải báo `409 Email already registered`, nên enumeration qua register là không tránh hoàn toàn được; giảm thiểu bằng rate limit (REQ-005) hoặc flow xác nhận email.

---

## 9. XSS và CSRF

### 9.1 XSS (Cross-Site Scripting)

Attacker chèn được JavaScript chạy trên trang của bạn.

- **Stored:** script lưu trong DB (ví dụ trong comment của task), ai xem cũng dính.
- **Reflected:** script nằm trong URL, server phản chiếu lại vào HTML.
- **DOM-based:** JS phía client tự đưa dữ liệu không tin cậy vào DOM (`innerHTML`, `location.hash`).

**Phòng chống:** React tự escape khi render `{value}`; tránh `dangerouslySetInnerHTML` (nếu bắt buộc thì sanitize bằng DOMPurify); **Content-Security-Policy** (helmet đã bật trên API); cookie `HttpOnly` để giới hạn thiệt hại.

### 9.2 CSRF (Cross-Site Request Forgery)

Trang `evil.com` tạo form POST tới `taskflow.com/api/auth/logout`. Browser **tự gửi cookie** của taskflow → request được xác thực dù user không hề muốn.

**Điều kiện để CSRF xảy ra:** credential được browser gửi tự động (cookie, Basic Auth). Header `Authorization: Bearer` do JS gắn vào thì **không** bị CSRF, vì evil.com không đọc được token.

**Phòng chống:**

1. **`SameSite=Strict`/`Lax`** cho cookie (TaskFlow dùng Strict).
2. **CSRF token** (synchronizer token hoặc double-submit cookie) cho app cũ hoặc khi buộc dùng `SameSite=None`.
3. Kiểm tra header `Origin`/`Referer`.
4. Bắt buộc `Content-Type: application/json` hoặc header custom: form HTML không tạo được, và fetch cross-origin sẽ bị preflight chặn.

Trong TaskFlow chỉ hai endpoint dùng cookie (`/auth/refresh`, `/auth/logout`); các endpoint khác dùng Bearer token nên miễn nhiễm CSRF. Refresh mà bị CSRF thì attacker cũng không đọc được response chứa access token (SOP chặn).

---

## 10. OAuth2 và OpenID Connect

> Phần này là lý thuyết; đăng nhập Google sẽ là một REQ riêng sau.

- **OAuth2** là giao thức **ủy quyền** (authorization): cho app A truy cập tài nguyên của user ở B (ví dụ đọc Google Drive) mà không cần password của B. Kết quả là **access token** dành cho resource server.
- **OpenID Connect (OIDC)** là lớp **xác thực** (authentication) xây trên OAuth2: thêm **ID token** (một JWT chứa `sub`, `email`, `name`) cho biết "user là ai". "Login with Google" là OIDC.

### 10.1 Các vai trò

Resource Owner (user) · Client (TaskFlow) · Authorization Server (Google accounts) · Resource Server (Google API).

### 10.2 Authorization Code flow + PKCE (flow nên dùng)

```
1. Browser → Google /authorize?response_type=code&client_id&redirect_uri&scope=openid email
            &state=<random>&code_challenge=SHA256(verifier)
2. User đăng nhập + đồng ý trên trang Google
3. Google → redirect_uri?code=<code>&state=<random>     (kiểm tra state để chống CSRF)
4. Backend → Google /token { code, client_secret, code_verifier }   (kênh back-channel)
5. Google → { id_token, access_token }
6. Backend verify id_token (chữ ký RS256 qua JWKS, iss, aud, exp), tìm hoặc tạo user,
   rồi phát access/refresh token của TaskFlow như login thường
```

- **`state`:** chống CSRF trên callback.
- **PKCE** (`code_verifier`/`code_challenge`): chống đánh cắp `code`, bắt buộc với public client (SPA, mobile) không giữ được `client_secret`.
- **Implicit flow** (token trả thẳng trên URL fragment) đã **deprecated**.
- **Client Credentials:** service gọi service, không có user.

---

## 11. Luồng auth trong TaskFlow

### 11.1 Endpoint

| Method | Path             | Auth                     | Kết quả                                            |
| ------ | ---------------- | ------------------------ | -------------------------------------------------- |
| POST   | `/auth/register` | public                   | 201, body `AuthResponse`, `Set-Cookie: tf_refresh` |
| POST   | `/auth/login`    | public                   | 200, như trên; sai thông tin → 401                 |
| POST   | `/auth/refresh`  | cookie                   | 200, access token mới + cookie mới (rotation)      |
| POST   | `/auth/logout`   | cookie (+ Bearer nếu có) | 204, revoke family, denylist jti, xóa cookie       |
| GET    | `/auth/me`       | Bearer                   | 200, `AuthUser`                                    |
| GET    | `/health`        | public                   | như REQ-001                                        |

### 11.2 Sơ đồ

```
Browser (memory: accessToken)            API                         Postgres / Redis
 │ POST /api/auth/login {email,pw} ─────▶ argon2.verify ──────────▶ users
 │ ◀── 200 {accessToken} + Set-Cookie tf_refresh (HttpOnly) ─────── insert refresh_tokens(hash)
 │ GET /api/auth/me  Authorization: Bearer ─▶ JwtAuthGuard: verify chữ ký, EXISTS denylist ─▶ Redis
 │ ... 15 phút sau: 401 ...
 │ POST /api/auth/refresh (cookie tự gửi) ─▶ rotate: conditional update ─▶ refresh_tokens
 │ ◀── 200 {accessToken mới} + cookie mới
 │ retry request ban đầu
```

### 11.3 Bản đồ file

| File                                          | Vai trò                                                              |
| --------------------------------------------- | -------------------------------------------------------------------- |
| `apps/api/src/auth/jwt-auth.guard.ts`         | Global guard (đăng ký bằng `APP_GUARD`), bỏ qua route có `@Public()` |
| `apps/api/src/auth/public.decorator.ts`       | `SetMetadata` để đánh dấu route public; guard đọc bằng `Reflector`   |
| `apps/api/src/auth/current-user.decorator.ts` | Custom param decorator lấy `request.user`                            |
| `apps/api/src/auth/access-token.service.ts`   | Ký/verify JWT, denylist trên Redis                                   |
| `apps/api/src/auth/refresh-token.service.ts`  | Phát, rotate, revoke refresh token; reuse detection                  |
| `apps/api/src/auth/password.service.ts`       | argon2id hash/verify, dummy hash                                     |
| `apps/api/src/auth/refresh-cookie.ts`         | Đặt và xóa cookie refresh                                            |
| `apps/api/src/auth/auth.service.ts`           | Ghép các bước register/login/refresh/logout                          |
| `apps/web/src/api/client.ts`                  | Giữ access token trong memory, tự refresh khi 401 (single-flight)    |
| `apps/web/src/auth/AuthProvider.tsx`          | Context user, silent login khi load trang                            |

### 11.4 Global guard và `@Public()`

Đăng ký guard toàn cục rồi "mở" từng route an toàn hơn cách ngược lại: quên gắn guard cho một route mới thì route đó **mặc định bị khóa** (fail closed) thay vì bị lộ (fail open).

---

## 12. Câu hỏi phỏng vấn + đáp án mẫu

<details><summary><b>Q1. So sánh session và JWT. Dự án của bạn dùng gì, tại sao?</b></summary>

Session lưu state ở server, client chỉ giữ session id; revoke dễ nhưng mỗi request phải tra store và cần store dùng chung khi scale. JWT tự chứa claims đã ký, verify bằng CPU không cần I/O, nhưng khó revoke trước khi hết hạn. Em dùng hybrid: access token JWT 15 phút để request thường không chạm DB, và refresh token opaque lưu hash trong Postgres để server vẫn kiểm soát được việc gia hạn và revoke.
</details>

<details><summary><b>Q2. Refresh token bị đánh cắp thì sao?</b></summary>

Em dùng refresh token rotation: mỗi token chỉ dùng một lần, mỗi lần refresh phát token mới cùng family. Nếu một token đã rotate bị dùng lại, nghĩa là có hai bên cùng cầm nó, server revoke cả family nên attacker mất quyền ngay khi user thật refresh (hoặc ngược lại). Ngoài ra token nằm trong cookie HttpOnly nên XSS không đọc được, SameSite=Strict và Path=/api/auth giới hạn nơi nó được gửi, và DB chỉ lưu SHA-256 hash nên lộ DB cũng không dùng được.
</details>

<details><summary><b>Q3. Logout khi dùng JWT thế nào?</b></summary>

Revoke refresh token trong DB và xóa cookie để không gia hạn được nữa. Access token còn sống tối đa 15 phút; nếu cần chặn ngay thì đưa jti vào denylist trên Redis với TTL bằng thời gian còn lại, guard kiểm tra denylist mỗi request. Đây là trade-off: thêm một lệnh Redis mỗi request để đổi lấy logout tức thì. Muốn logout mọi thiết bị thì revoke mọi refresh token của user hoặc tăng tokenVersion của user.
</details>

<details><summary><b>Q4. Lưu token ở localStorage hay cookie?</b></summary>

localStorage bị mọi script đọc được nên XSS lấy được token. Cookie HttpOnly thì JS không đọc được nhưng browser tự gửi nên phải chống CSRF bằng SameSite. Em để access token trong memory (ngắn hạn, mất khi reload) và refresh token trong cookie HttpOnly SameSite=Strict; reload trang thì gọi refresh để lấy lại access token. Dù vậy không cách nào miễn nhiễm XSS, nên vẫn phải escape output và bật CSP.
</details>

<details><summary><b>Q5. Tại sao không hash password bằng SHA-256? bcrypt và argon2 khác gì?</b></summary>

SHA-256 rất nhanh, GPU tính hàng tỷ hash mỗi giây, nên brute-force password entropy thấp rất dễ. Cần slow hash có salt và cost điều chỉnh được. bcrypt chỉ có tham số cost và chỉ dùng 72 byte đầu. argon2id là memory-hard, mỗi lần hash tốn nhiều RAM nên GPU/ASIC khó song song hóa, và tham số nằm trong chuỗi hash nên nâng cấp dần được. Còn refresh token thì em hash bằng SHA-256 vì nó có 256 bit ngẫu nhiên, không brute-force được.
</details>

<details><summary><b>Q6. Payload JWT có bí mật không? Làm sao chống giả mạo JWT?</b></summary>

Không, payload chỉ base64url, ai cũng decode được, nên không để dữ liệu nhạy cảm. Chữ ký chống sửa đổi. Khi verify phải ép danh sách algorithms để chặn alg none và algorithm confusion, kiểm tra exp, iss, aud, và dùng secret ngẫu nhiên đủ dài vì HS256 với secret yếu có thể bị brute-force offline.
</details>

<details><summary><b>Q7. CSRF là gì? CORS có chống được CSRF không?</b></summary>

CSRF là trang khác lừa browser gửi request tới site của mình, browser tự đính cookie nên request được xác thực. CORS không chống được vì CORS chỉ ngăn JS đọc response; simple request như form POST vẫn tới server và gây side effect. Chống CSRF bằng SameSite cookie, CSRF token, kiểm tra Origin, hoặc dùng Bearer token trong header vì trang khác không đọc được để gắn vào.
</details>

<details><summary><b>Q8. 401 khác 403 thế nào?</b></summary>

401 là chưa xác thực hoặc token không hợp lệ: client nên login hoặc refresh. 403 là đã biết bạn là ai nhưng bạn không có quyền: refresh cũng vô ích. Client của em chỉ tự refresh khi gặp 401.
</details>

<details><summary><b>Q9. Hai tab cùng refresh một lúc thì sao?</b></summary>

Cả hai gửi cùng một refresh token. Server rotate bằng conditional update (where rotatedAt is null), Postgres đảm bảo chỉ một request thắng. Request thua thấy token vừa rotate trong grace window 10 giây nên chỉ nhận 401 chứ không bị coi là reuse, tránh logout nhầm. Trong cùng một tab thì client dùng single-flight Promise nên chỉ có một request refresh.
</details>

<details><summary><b>Q10. Login trả "email không tồn tại" thì có vấn đề gì?</b></summary>

User enumeration: attacker biết email nào có tài khoản để nhắm credential stuffing hoặc phishing. Nên trả cùng thông báo cho cả hai trường hợp, và còn phải làm thời gian phản hồi như nhau, vì vậy em vẫn verify argon2 với một dummy hash khi không tìm thấy user. Kết hợp rate limit để chống brute-force.
</details>

<details><summary><b>Q11. OAuth2 và OpenID Connect khác nhau thế nào? Vì sao cần PKCE?</b></summary>

OAuth2 là ủy quyền, kết quả là access token để gọi API của resource server. OIDC thêm lớp xác thực với ID token là JWT cho biết user là ai; Login with Google là OIDC. Flow khuyến nghị là Authorization Code + PKCE: client tạo code_verifier ngẫu nhiên, gửi hash của nó khi authorize, rồi gửi verifier gốc khi đổi code lấy token, nên kẻ chặn được code cũng không đổi được token. state dùng để chống CSRF trên callback.
</details>

<details><summary><b>Q12. Vì sao đăng ký guard toàn cục rồi dùng @Public()?</b></summary>

Fail closed: route mới mặc định cần đăng nhập, quên gắn decorator thì chỉ gây lỗi 401 dễ phát hiện chứ không làm lộ dữ liệu. Guard đọc metadata của @Public() bằng Reflector, xét cả handler và class.
</details>

---

## 13. Tự kiểm tra

- [ ] Giải thích 401 và 403, và vì sao client chỉ refresh khi 401
- [ ] Kể đủ các attribute của cookie refresh trong TaskFlow và tác dụng của từng cái
- [ ] Phân biệt same-site và same-origin; vì sao SameSite không chặn được subdomain
- [ ] Giải thích preflight và vì sao `credentials: true` không đi với `origin: *`
- [ ] Vẽ cấu trúc JWT, nói được claim nào dùng để làm gì
- [ ] Giải thích alg none, algorithm confusion và cách code TaskFlow chặn
- [ ] Vẽ chuỗi rotation và reuse detection (T1 → T2 → reuse T1)
- [ ] Giải thích vì sao check-then-act gây race và conditional update sửa thế nào
- [ ] Nêu trade-off của denylist trên Redis
- [ ] Giải thích salt, pepper, vì sao argon2id tốt hơn bcrypt
- [ ] Giải thích timing attack trên login và dummy hash
- [ ] Phân biệt 3 loại XSS và 4 cách chống CSRF
- [ ] Vẽ Authorization Code + PKCE flow

### 🛠 Bài tập thực hành

1. Login, copy access token, dán vào jwt.io: đọc payload, đổi `sub` rồi gọi `/auth/me` với token đã sửa, quan sát 401.
2. Gọi `/auth/refresh` hai lần với cùng một cookie cách nhau > 10 giây (dùng `curl -b`), kiểm tra bảng `refresh_tokens` trong `npm run db:studio` để thấy cả family bị revoke.
3. Đo thời gian `/auth/login` với email tồn tại và không tồn tại (`curl -w '%{time_total}'`), xác nhận chênh lệch nhỏ. Sau đó tạm bỏ dummy hash và đo lại.
4. Mở DevTools > Application > Cookies, xác nhận `tf_refresh` có HttpOnly, SameSite=Strict, Path=/api/auth và `document.cookie` không thấy nó.
