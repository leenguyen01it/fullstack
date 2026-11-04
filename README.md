# TaskFlow

Team task management app (Kanban boards, tasks, comments, realtime notifications) built as a fullstack portfolio project.

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite, TanStack Query, TypeScript |
| Backend | NestJS 12, Prisma 7, Zod, Pino |
| Data | PostgreSQL 17, Redis 8, RabbitMQ 4 |
| Infra | Docker (multi-stage), docker-compose, Nginx |

## Structure

```
apps/
  api/        NestJS REST API (Swagger at /docs)
  web/        React SPA
packages/
  shared/     Zod schemas and types shared by api and web
infra/
  nginx/      Nginx config for serving the SPA and proxying /api
docs/
  REQUIREMENTS.md   requirement log (REQ-xxx) referenced by @since/@updated tags
```

## Getting started

Requirements: Node.js 22+, Docker.

```bash
npm install
cp .env.example .env     # then set JWT_ACCESS_SECRET: openssl rand -base64 48
npm run infra:up          # PostgreSQL, Redis, RabbitMQ
npm run db:migrate        # apply Prisma migrations
npm run dev               # api → http://localhost:3000, web → http://localhost:5173
```

| URL | Service |
|---|---|
| http://localhost:5173 | Web (dev) |
| http://localhost:3000/health | API health check |
| http://localhost:3000/docs | Swagger UI |
| http://localhost:15672 | RabbitMQ management (taskflow / taskflow) |

If a host port is already taken, change `POSTGRES_PORT`, `REDIS_PORT`, `RABBITMQ_PORT` or `RABBITMQ_UI_PORT` in `.env` and update `DATABASE_URL` / `REDIS_URL` to match.

### Run everything in containers

```bash
docker compose --profile app up --build   # web → http://localhost:8080
```

## Scripts

| Command | Description |
|---|---|
| `npm run dev` | Build shared, start api and web in watch mode |
| `npm run build` | Build every workspace |
| `npm run typecheck` | Type-check every workspace |
| `npm run test` | Run tests in every workspace |
| `npm run infra:up` / `infra:down` | Start / stop infrastructure containers |
| `npm run db:migrate` | Create and apply a migration (dev) |
| `npm run db:studio` | Open Prisma Studio |
| `npm run format` | Format code with Prettier |
