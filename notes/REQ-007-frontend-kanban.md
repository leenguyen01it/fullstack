# REQ-007: Frontend (React rendering, hooks, TanStack Query, optimistic update, routing, performance)

> Code liên quan: `apps/web/src/*`: `App.tsx` (routes), `layout/*`, `pages/*`, `board/*` (Kanban), `tasks/TaskSearch.tsx`, `api/*` (TanStack Query hooks), `hooks/useDebouncedValue.ts`, `auth/AuthProvider.tsx`
> Roadmap: Phase 6 (React core, hệ sinh thái, performance)

## Mục lục

1. [React render như thế nào](#1-react-render-như-thế-nào)
2. [Hooks: những chỗ hay sai](#2-hooks-những-chỗ-hay-sai)
3. [Phân loại state và chỗ đặt nó](#3-phân-loại-state-và-chỗ-đặt-nó)
4. [TanStack Query](#4-tanstack-query)
5. [Optimistic update](#5-optimistic-update)
6. [Kéo thả với dnd-kit](#6-kéo-thả-với-dnd-kit)
7. [Routing và luồng đăng nhập](#7-routing-và-luồng-đăng-nhập)
8. [Form, validation, xung đột 409](#8-form-validation-xung-đột-409)
9. [Performance](#9-performance)
10. [Accessibility cơ bản](#10-accessibility-cơ-bản)
11. [Luồng REQ-007 trong TaskFlow](#11-luồng-req-007-trong-taskflow)
12. [Câu hỏi phỏng vấn + đáp án mẫu](#12-câu-hỏi-phỏng-vấn--đáp-án-mẫu)
13. [Tự kiểm tra](#13-tự-kiểm-tra)

---

## 1. React render như thế nào

### 1.1 Render phase và commit phase

- **Render phase**: React gọi function component để lấy cây element mới (JS object mô tả UI). **Thuần**: không side effect, có thể bị gọi nhiều lần, bị bỏ dở (concurrent rendering), bị gọi 2 lần trong `StrictMode` dev.
- **Reconciliation**: so cây mới với cây cũ (diff) để tìm thay đổi tối thiểu.
- **Commit phase**: áp thay đổi vào DOM thật, chạy `useLayoutEffect` (đồng bộ, trước khi browser paint), rồi `useEffect` (sau paint).

"Virtual DOM" chỉ là cây object này. Lợi ích chính không phải "nhanh hơn DOM" mà là **lập trình khai báo**: mô tả UI theo state, React tự tính phần DOM cần đổi.

### 1.2 Khi nào component re-render

1. **State** của nó đổi (`setState` với giá trị khác theo `Object.is`).
2. **Component cha re-render** (mặc định toàn bộ con re-render, bất kể props có đổi không).
3. **Context** mà nó dùng đổi giá trị.

Props đổi **không** phải nguyên nhân độc lập; props chỉ đổi khi cha re-render. `React.memo` cắt nguyên nhân (2) khi props bằng nhau (shallow compare).

### 1.3 Reconciliation và `key`

Thuật toán diff dựa trên hai giả định: phần tử khác **type** thì thay cả cây con; danh sách con được khớp theo **key**.

- Key phải **ổn định và duy nhất trong danh sách**: dùng `task.id`.
- **Không dùng index làm key** khi danh sách có thể thêm/xóa/đổi thứ tự (Kanban kéo thả): React khớp sai phần tử → state nội bộ (input đang gõ, focus, animation) dính vào nhầm item.
- Đổi `key` là cách **reset** state của component: TaskFlow dùng `key={user.id}`, `key={workspace.id}` để form không giữ dữ liệu của workspace trước.

### 1.4 Batching

React 18+ gộp nhiều `setState` trong cùng tick (kể cả trong Promise, setTimeout) thành **một** lần render (automatic batching).

---

## 2. Hooks: những chỗ hay sai

### 2.1 Quy tắc

Chỉ gọi hook ở **top level** của component/custom hook, không trong if/loop/callback. React nhận diện hook theo **thứ tự gọi**.

### 2.2 `useEffect`

- Effect là để **đồng bộ với hệ thống bên ngoài** (DOM API, subscription, timer, IntersectionObserver), không phải để "chạy code khi state đổi". Tính toán từ props/state thì làm thẳng trong render; phản ứng với hành động user thì làm trong event handler.
- **Dependency array** phải liệt kê mọi giá trị reactive dùng bên trong (ESLint `react-hooks/exhaustive-deps`). Thiếu → **stale closure** (effect đọc giá trị cũ).
- **Cleanup** chạy trước lần effect kế tiếp và khi unmount: hủy timer, observer, subscription. TaskFlow: `useDebouncedValue` clear timeout; `TaskSearch` disconnect `IntersectionObserver`.
- **StrictMode chạy effect 2 lần ở dev** (mount → cleanup → mount) để lộ cleanup sai. Bài học thật trong TaskFlow: `TaskEditor` ban đầu có cleanup `dialog.close()`; `close()` phát sự kiện `close` → gọi `onClose` → editor tự đóng ngay khi vừa mở. Sửa: effect chỉ `showModal()` khi chưa mở, không đóng trong cleanup (phần tử bị gỡ khỏi DOM thì tự đóng). Cleanup chỉ nên **hủy** thứ effect đã tạo, không gây side effect lên state của cha.

### 2.3 Race condition khi fetch trong effect

Gõ "a" rồi "ab": request "a" có thể về **sau** "ab" và ghi đè kết quả. Cách sửa: biến `ignore` trong cleanup, `AbortController`, hoặc dùng thư viện quản lý server state. **TanStack Query** xử lý sẵn vì mỗi query key là một cache entry riêng: kết quả của `['tasks', 'a']` không bao giờ ghi vào `['tasks', 'ab']`.

### 2.4 `useRef`

Giá trị **mutable sống qua các lần render mà không gây render** (DOM node, timer id, giá trị trước). Đọc/ghi `ref.current` trong render là sai (không thuần), làm trong effect/handler.

### 2.5 `useMemo` / `useCallback`: khi nào **thừa**

Chỉ có ích khi:

- Tính toán thật sự **đắt**, hoặc
- Giá trị/hàm được truyền vào component đã `memo`, hoặc là dependency của effect/hook khác.
  Bọc mọi thứ thì thêm chi phí so sánh deps và code khó đọc. TaskFlow: `TaskCard` được `memo` (nhiều card, re-render liên tục khi kéo), nên `onOpen` truyền vào nó được `useCallback`. React Compiler (React 19) tự memo hóa, giảm nhu cầu viết tay.

### 2.6 Custom hook

Tái sử dụng **logic có state**, không phải state: mỗi component gọi hook có state riêng. TaskFlow: `useDebouncedValue`, các hook `useBoard`, `useMoveTask`…

---

## 3. Phân loại state và chỗ đặt nó

| Loại                    | Ví dụ TaskFlow                                     | Đặt ở đâu                                                                                      |
| ----------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **Server state**        | Workspaces, board, members, kết quả search         | **TanStack Query** (cache, đồng bộ, refetch)                                                   |
| **URL state**           | Workspace/board đang mở, trang của danh sách board | **URL** (`/w/:workspaceId/b/:boardId`, `?page=2`): share link, back/forward, reload giữ nguyên |
| **Global client state** | User đăng nhập                                     | **Context** (`AuthProvider`); nhiều và đổi thường xuyên thì Zustand/Redux Toolkit              |
| **Local UI state**      | Ô input, dialog đang mở, trạng thái kéo            | `useState` trong component                                                                     |
| **Form state**          | Task editor                                        | Uncontrolled + `FormData` hoặc React Hook Form                                                 |

**Context và re-render**: mọi consumer re-render khi value đổi. Cách giảm: tách context theo tần suất đổi, `useMemo` value (TaskFlow `AuthProvider` đã làm), hoặc dùng store có **selector** (Zustand `useStore(s => s.x)` chỉ re-render khi phần được chọn đổi).

**Vì sao không bỏ server state vào Redux**: phải tự viết loading/error, cache, dedupe, refetch, invalidation, retry. Server state là **bản sao** của dữ liệu trên server, có thể cũ bất cứ lúc nào; TanStack Query sinh ra để quản lý đúng bài toán đó.

---

## 4. TanStack Query

### 4.1 Khái niệm

- **Query key** xác định cache entry: `['board', boardId]`, `['workspace', id, 'tasks', { q, assigneeId }]`. Key là mảng serialize được; đổi key = query khác.
- **staleTime**: bao lâu dữ liệu được coi là "tươi" (mặc định 0). Hết stale thì refetch khi mount/focus/reconnect.
- **gcTime** (cacheTime cũ): bao lâu cache của query **không còn ai dùng** được giữ lại (mặc định 5 phút).
- **Dedupe**: nhiều component cùng query key → một request.
- **Invalidation**: `invalidateQueries({ queryKey: ['workspace', id] })` đánh dấu stale mọi key **bắt đầu bằng** prefix đó và refetch query đang hiển thị. Thiết kế key theo cây để invalidate theo nhánh.

### 4.2 Mutation

`useMutation({ mutationFn, onMutate, onError, onSuccess, onSettled })`. Sau mutation: **invalidate** (đơn giản, đúng) hoặc **setQueryData** từ response (tiết kiệm một request).

### 4.3 Infinite query (cursor pagination của REQ-004)

```ts
useInfiniteQuery({
  queryKey: ['workspace', id, 'tasks', filters],
  queryFn: ({ pageParam }) => searchTasks(id, { ...filters, cursor: pageParam }),
  initialPageParam: undefined,
  getNextPageParam: (last) => last.nextCursor ?? undefined,
});
```

`fetchNextPage()` khi sentinel cuối danh sách lọt vào viewport (`IntersectionObserver`).

### 4.4 Cache và bảo mật

Cache nằm trong memory của tab. Khi **logout hoặc đổi user**, TaskFlow gọi `queryClient.clear()` để user sau không thấy dữ liệu của user trước.

---

## 5. Optimistic update

Cập nhật UI **ngay** như thể server đã thành công, rồi đồng bộ với kết quả thật. Hợp với thao tác **thường thành công** và cần cảm giác tức thì (kéo thả). Không hợp với thao tác dễ fail hoặc hậu quả lớn (thanh toán).

Quy trình (TaskFlow `useMoveTask`):

1. `onMutate`: `cancelQueries` (để refetch đang chạy không ghi đè), lưu **snapshot** `getQueryData`, `setQueryData` với board đã di chuyển task, trả snapshot làm context.
2. `onError`: `setQueryData(snapshot)` để **rollback**, báo lỗi cho user.
3. `onSettled`: `invalidateQueries` để lấy trạng thái thật từ server (server có thể đã sinh `position` khác, hoặc người khác cũng vừa kéo).

Vị trí gửi lên server là `afterTaskId` (task đứng ngay trước chỗ thả, `null` nếu lên đầu), server tự tính fractional index (REQ-004). Client không cần biết thuật toán sinh key; khi làm optimistic chỉ cần sắp lại mảng.

**Thứ tự khi nhiều mutation liên tiếp**: kéo 2 task nhanh, refetch của lần 1 về sau optimistic của lần 2 → nhấp nháy. `cancelQueries` trong `onMutate` của lần 2 hủy refetch của lần 1; và chỉ invalidate khi không còn mutation nào đang chạy (`isMutating`).

---

## 6. Kéo thả với dnd-kit

- **HTML5 Drag and Drop API** gốc: không hỗ trợ touch, khó tùy biến preview, accessibility kém. Thư viện như **dnd-kit** dùng pointer/keyboard events.
- **Sensors**: `PointerSensor` với `activationConstraint: { distance: 5 }` để click (mở task) không bị hiểu là kéo; `KeyboardSensor` cho phép kéo bằng bàn phím (Space nhặt, mũi tên di chuyển, Space thả).
- **Nhiều container (column)**: mỗi column là `SortableContext` + droppable. `onDragOver` chuyển task sang column khác trong **state tạm** để thấy preview; `onDragEnd` tính vị trí cuối cùng và gọi mutation.
- **DragOverlay** vẽ bản sao của card đi theo con trỏ, card gốc mờ đi.
- **Collision detection**: `closestCorners` so các góc của **hình chữ nhật card** (rộng 272px) với các droppable, nên với cột cao thấp khác nhau, thả vào cột giữa có thể rơi sang cột bên cạnh. TaskFlow dùng `pointerWithin` trước (droppable **dưới con trỏ**), chỉ fallback `closestCorners` khi con trỏ nằm giữa các vùng hoặc khi kéo bằng bàn phím. Lỗi này được phát hiện khi test thật trên trình duyệt.
- **Phím tắt**: `KeyboardSensor` mặc định dùng cả Space và Enter để nhặt card; TaskFlow chỉ dùng Space để Enter mở editor.
- Trong lúc kéo chỉ cập nhật state tạm cục bộ, không ghi cache/không gọi server mỗi lần di chuột.

---

## 7. Routing và luồng đăng nhập

### 7.1 Client-side routing

SPA đổi URL bằng History API (`pushState`), không tải lại trang. Server phải trả `index.html` cho **mọi** đường dẫn không phải file (nginx `try_files $uri /index.html`, Vite dev tự làm), nếu không reload `/w/123` sẽ 404.

### 7.2 Protected route

`RequireAuth` (layout route):

- Đang khôi phục session (silent refresh khi tải trang, REQ-002) → hiện loading, **không** redirect vội (nếu không user đã đăng nhập vẫn bị đá về login mỗi lần reload).
- Chưa đăng nhập → `<Navigate to="/login" state={{ from: location }} replace />`.
- Login xong → quay về `from` (ví dụ link mời `/invitations/:token` trong email).
- `replace` để nút Back không quay lại trang bị chặn.

Guard ở frontend chỉ là UX; API mới là nơi thực thi (REQ-003).

### 7.3 Silent refresh và 401

`apiFetch` (REQ-002) gặp 401 thì gọi `/auth/refresh` một lần (single-flight) rồi retry. Refresh thất bại → session `null` → `RequireAuth` chuyển về `/login`.

---

## 8. Form, validation, xung đột 409

- **Controlled** (`value` + `onChange`): React giữ giá trị, re-render mỗi phím; cần khi phải phản ứng tức thì (search box có debounce).
- **Uncontrolled** (`defaultValue` + đọc `FormData` khi submit): ít render, đơn giản; TaskFlow dùng cho phần lớn form.
- Validate bằng **cùng Zod schema** với backend (`packages/shared`), hiện lỗi theo field; server vẫn validate lại.
- **409 khi sửa task** (optimistic lock của REQ-004): `TaskEditor` hiện thông báo "Task was changed by someone else" với nút **Reload** (tải bản mới, reset form theo `version` mới). Không tự ghi đè: user quyết định.

---

## 9. Performance

| Kỹ thuật                                                             | Khi nào                                             | TaskFlow                                             |
| -------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------------- |
| `React.memo`                                                         | Component render nhiều, props ổn định               | `TaskCard`                                           |
| `useCallback`/`useMemo`                                              | Giữ props ổn định cho component memo, tính toán đắt | Handler truyền vào `TaskCard`, nhóm task theo column |
| **Code splitting** (`lazy` + `Suspense`)                             | Route/feature nặng ít người dùng ngay               | `BoardPage` (kèm dnd-kit) là chunk riêng             |
| **Debounce**                                                         | Input gây request                                   | Search 300 ms (`useDebouncedValue`)                  |
| `useDeferredValue` / `useTransition`                                 | Render nặng làm input giật (không giảm request)     |                                                      |
| **Virtualization** (react-window, TanStack Virtual)                  | Danh sách hàng nghìn dòng                           | Chưa cần; cursor pagination giới hạn 20/trang        |
| Tránh tạo object/array mới trong render cho props của component memo |                                                     |                                                      |

**Đo trước khi tối ưu**: React DevTools Profiler (component nào render, mất bao lâu, vì sao), Lighthouse / Core Web Vitals (**LCP** tải nội dung chính, **INP** độ trễ tương tác, **CLS** độ xô lệch layout), tab Performance.

**Bundle**: tree shaking (ESM, import có chọn lọc), `vite build` báo kích thước chunk; `rollup-plugin-visualizer` để soi.

---

## 10. Accessibility cơ bản

- Dùng phần tử ngữ nghĩa: `<button>` cho hành động (không `<div onClick>`), `<a>`/`<Link>` cho điều hướng, `<label>` cho input, `<dialog>` cho modal (focus trap và `Esc` sẵn có).
- Mọi chức năng dùng được bằng bàn phím (dnd-kit `KeyboardSensor`), focus nhìn thấy được.
- `aria-label` cho nút chỉ có icon, `aria-invalid` cho field lỗi, `aria-live`/`role="status"` cho thông báo động.

---

## 11. Luồng REQ-007 trong TaskFlow

### 11.1 Routes

| Path                         | Trang                  | Ghi chú                                                                                   |
| ---------------------------- | ---------------------- | ----------------------------------------------------------------------------------------- |
| `/login`                     | `LoginPage`            | Đăng nhập/đăng ký, quay về `from`                                                         |
| `/`                          | `HomePage`             | Danh sách workspace, tạo mới, trạng thái hệ thống                                         |
| `/w/:workspaceId`            | `WorkspacePage`        | Board (offset pagination `?page=`), search task (infinite), members, invitations, cài đặt |
| `/w/:workspaceId/b/:boardId` | `BoardPage` (lazy)     | Kanban: kéo thả, thêm task/column, editor                                                 |
| `/invitations/:token`        | `AcceptInvitationPage` | Xem trước và chấp nhận lời mời                                                            |

### 11.2 Query keys

```
['workspaces']                                   danh sách workspace của tôi
['workspace', id]                                một workspace
['workspace', id, 'members' | 'invitations']
['workspace', id, 'boards', page]
['workspace', id, 'tasks', { q, assigneeId }]    infinite
['board', boardId]                               board detail (optimistic khi kéo thả)
```

### 11.3 Bản đồ file

| File                                                        | Vai trò                                                      |
| ----------------------------------------------------------- | ------------------------------------------------------------ |
| `App.tsx`, `layout/AppLayout.tsx`, `layout/RequireAuth.tsx` | Routes, header, protected route                              |
| `auth/AuthProvider.tsx`                                     | Xóa cache query khi đổi user                                 |
| `api/boards.ts`                                             | `useBoard`, `useMoveTask` (optimistic), mutation task/column |
| `api/tasks.ts`                                              | `useTaskSearch` (infinite)                                   |
| `board/KanbanBoard.tsx`                                     | `DndContext`, state tạm khi kéo, tính `afterTaskId`          |
| `board/KanbanColumn.tsx`, `board/TaskCard.tsx`              | Sortable column/card, `memo`                                 |
| `board/TaskEditor.tsx`                                      | `<dialog>`, optimistic lock 409 + Reload                     |
| `tasks/TaskSearch.tsx`                                      | Debounce + infinite scroll                                   |
| `hooks/useDebouncedValue.ts`                                | Custom hook có cleanup                                       |

---

## 12. Câu hỏi phỏng vấn + đáp án mẫu

<details><summary><b>Q1. Tại sao không nên dùng index làm key?</b></summary>

Key giúp React khớp phần tử cũ và mới trong danh sách. Dùng index thì khi chèn, xóa hay đổi thứ tự, phần tử ở cùng vị trí bị coi là cùng một item, nên state nội bộ như input đang gõ, focus hay animation bị gán nhầm và React cập nhật nhiều DOM hơn cần thiết. Dùng id ổn định của dữ liệu. Index chỉ chấp nhận được với danh sách tĩnh không đổi thứ tự.
</details>

<details><summary><b>Q2. Khi nào component re-render? React.memo giúp gì?</b></summary>

Khi state của nó đổi, khi component cha re-render, hoặc khi context nó dùng đổi. React.memo bỏ qua re-render do cha khi props bằng nhau theo shallow compare, nên props kiểu object hay function phải ổn định (useMemo, useCallback), nếu không memo vô tác dụng. Chỉ nên dùng ở component render nhiều hoặc đắt, sau khi đo bằng Profiler.
</details>

<details><summary><b>Q3. useEffect gọi API bị race condition khi đổi tham số liên tục, xử lý thế nào?</b></summary>

Response của tham số cũ có thể về sau và ghi đè. Trong effect dùng cờ ignore ở cleanup hoặc AbortController để hủy request cũ. Tốt hơn là dùng TanStack Query: mỗi tham số là một query key riêng nên kết quả không ghi nhầm, còn có cache và dedupe. Kết hợp debounce để giảm số request khi gõ.
</details>

<details><summary><b>Q4. useMemo/useCallback lúc nào thừa?</b></summary>

Khi tính toán rẻ, khi kết quả không truyền vào component memo hay không làm dependency của hook khác. Lúc đó chỉ thêm chi phí so sánh dependency và làm code khó đọc. Dùng khi tính toán đắt hoặc cần giữ tham chiếu ổn định. React Compiler giảm nhu cầu viết tay.
</details>

<details><summary><b>Q5. Server state khác client state thế nào? Vì sao dùng TanStack Query?</b></summary>

Server state là bản sao dữ liệu nằm trên server, bất đồng bộ, có thể bị người khác thay đổi và cũ đi; client state thuộc về UI như dialog đang mở. TanStack Query lo cache theo key, dedupe request, loading/error, refetch khi stale hay focus, invalidation, retry, pagination, optimistic update, những thứ tự viết bằng Redux rất dài và dễ sai. Client state thì useState, context hoặc Zustand.
</details>

<details><summary><b>Q6. Optimistic update làm thế nào cho đúng?</b></summary>

Trong onMutate hủy các query đang fetch của key đó, lưu snapshot, cập nhật cache theo kết quả mong đợi và trả snapshot. onError khôi phục snapshot và báo lỗi. onSettled invalidate để đồng bộ với server. Chỉ dùng cho thao tác thường thành công và có thể hoàn tác. Kanban của em kéo task thì UI đổi ngay, server lỗi thì card nhảy về chỗ cũ.
</details>

<details><summary><b>Q7. Context gây re-render toàn cây thì làm sao?</b></summary>

Mọi consumer re-render khi value đổi. Memo hóa value, tách context theo phần đổi thường xuyên và phần ổn định, tách state và dispatch, đẩy provider xuống thấp gần nơi dùng, hoặc dùng store có selector như Zustand để component chỉ re-render khi phần nó chọn thay đổi.
</details>

<details><summary><b>Q8. Làm protected route thế nào? Reload trang có bị đá về login không?</b></summary>

Một layout route kiểm tra auth: đang khôi phục session thì hiện loading, chưa đăng nhập thì Navigate tới /login kèm location hiện tại trong state và replace, đăng nhập xong quay lại đúng trang. Khi reload, access token trong memory mất nên app gọi refresh bằng cookie HttpOnly trước, chờ xong mới quyết định, nên không bị đá về login. Đây chỉ là UX, API vẫn kiểm tra quyền.
</details>

<details><summary><b>Q9. Một trang hiển thị 10.000 dòng bị lag, tối ưu thế nào?</b></summary>

Đo bằng Profiler trước. Không render cả 10.000 dòng: phân trang hoặc infinite scroll với cursor, hoặc virtualization chỉ render phần trong viewport. Memo hóa row và giữ props ổn định, key ổn định, tránh tính toán nặng trong render, dùng useDeferredValue cho filter để input không giật, debounce khi filter gọi API.
</details>

<details><summary><b>Q10. Controlled và uncontrolled component khác gì?</b></summary>

Controlled thì React state là nguồn sự thật, value và onChange, re-render mỗi lần gõ, dễ validate tức thì và điều khiển giá trị. Uncontrolled thì DOM giữ giá trị, đọc qua ref hoặc FormData khi submit, ít render hơn. React Hook Form dựa trên uncontrolled để hiệu năng tốt.
</details>

<details><summary><b>Q11. Code splitting làm thế nào và lợi ích gì?</b></summary>

Dùng dynamic import qua React.lazy và bọc Suspense, bundler tách thành chunk riêng chỉ tải khi cần. Thường tách theo route hoặc feature nặng. Giảm JavaScript tải ban đầu, cải thiện LCP và thời gian tương tác. Đổi lại có thêm request khi vào route đó, có thể prefetch khi hover link.
</details>

---

## 13. Tự kiểm tra

- [ ] Render phase và commit phase; vì sao render phải thuần
- [ ] 3 nguyên nhân re-render; `memo` cắt nguyên nhân nào
- [ ] Vai trò của `key`, khi nào dùng key để reset state
- [ ] Effect dùng để làm gì và không dùng để làm gì; cleanup; stale closure
- [ ] Phân loại state và chỗ đặt mỗi loại
- [ ] `staleTime` khác `gcTime`; invalidate theo prefix key
- [ ] 3 bước optimistic update và vì sao cần `cancelQueries`
- [ ] Sensors và activation constraint trong dnd-kit
- [ ] Protected route và xử lý lúc đang khôi phục session
- [ ] Xử lý 409 trong form sửa task
- [ ] Code splitting, debounce, virtualization: khi nào dùng
- [ ] 3 Core Web Vitals

### 🛠 Bài tập thực hành

1. Mở React DevTools Profiler, kéo một task: xem card nào re-render. Bỏ `memo` ở `TaskCard` và so sánh.
2. DevTools Network chọn "Offline", kéo task: card nhảy về chỗ cũ và có thông báo lỗi (rollback).
3. Mở cùng một task ở hai tab, sửa và lưu ở tab 1, rồi lưu ở tab 2: thấy thông báo xung đột và nút Reload.
4. Gõ nhanh vào ô search, xem tab Network: chỉ có request sau khi ngừng gõ 300 ms. Cuộn xuống cuối danh sách: request trang tiếp theo có `cursor`.
5. `npm run build -w @taskflow/web`: xác nhận có chunk riêng cho `BoardPage`. Đăng xuất rồi đăng nhập bằng user khác: không thấy dữ liệu cũ nhấp nháy.
6. Reload ở `/w/<id>/b/<id>`: vẫn ở đúng board, không bị đá về `/login`.
