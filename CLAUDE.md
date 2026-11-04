# TaskFlow: project conventions

Fullstack learning project used to prepare for Middle-level interviews. Learning plan: `ROADMAP.md`.
Stack: npm workspaces monorepo · TypeScript · NestJS + Prisma (`apps/api`) · React + Vite (`apps/web`) · Zod schemas in `packages/shared` · PostgreSQL, Redis, RabbitMQ via `docker-compose.yml`.

## Communication
- Talk to the user in Vietnamese. Everything written into code or repo docs is in English, except `notes/`.

## Theory notes (`notes/`)
- Learning is tied to requirements: before coding a REQ, write its theory note `notes/REQ-xxx-<slug>.md`; the REQ ↔ topic map lives in `notes/README.md`.
- Notes are written in Vietnamese, keeping technical terms in English.
- Each note covers the theory the REQ uses, linked to the real files in this repo, and ends with interview questions plus model answers and a self-check list.
- Mark the note as done (✅) in `notes/README.md` when written.

## Code comments (mandatory)
- Every function, class, method and exported schema/type has a JSDoc header in **English** that states **what it does** (its feature/behavior).
- Do not write side notes, explanations of why, teaching remarks or inline commentary inside functions.
- Tag the requirement that introduced it, and add one `@updated` line for each later requirement that changes it:

```ts
/**
 * Validates the payload for registering a new user account.
 * @since REQ-001
 * @updated REQ-004
 */
```

## Requirements log
- Every new piece of work gets a new `REQ-xxx` row in `docs/REQUIREMENTS.md` (ID, title, roadmap phase, status) before code is written.
- When touching an existing function for a new requirement, append `@updated REQ-xxx`; never remove earlier tags.
