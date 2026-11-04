import { z } from 'zod';

export { generateKeyBetween } from './fractional-index';

/**
 * Validates an email address, trimming whitespace and lowercasing it.
 * @since REQ-002
 */
export const emailSchema = z.string().trim().toLowerCase().pipe(z.email('Invalid email address'));

/**
 * Validates the payload for registering a new user account.
 * @since REQ-001
 * @updated REQ-002
 */
export const registerSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
  name: z.string().trim().min(1, 'Name is required').max(100),
});
export type RegisterInput = z.infer<typeof registerSchema>;

/**
 * Validates the payload for logging in with email and password.
 * @since REQ-001
 * @updated REQ-002
 */
export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(128),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Describes the public profile of a signed-in user.
 * @since REQ-002
 */
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

/**
 * Describes the body returned by register, login and refresh.
 * @since REQ-002
 */
export interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: AuthUser;
}

/**
 * Lists the roles a user can hold inside a workspace, from highest to lowest.
 * @since REQ-003
 */
export const WORKSPACE_ROLES = ['OWNER', 'ADMIN', 'MEMBER'] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

/**
 * Lists the roles that can be granted when adding a member or changing a role; OWNER only moves by transfer.
 * @since REQ-003
 */
export const ASSIGNABLE_WORKSPACE_ROLES = ['ADMIN', 'MEMBER'] as const;
export type AssignableWorkspaceRole = (typeof ASSIGNABLE_WORKSPACE_ROLES)[number];

/**
 * Ranks workspace roles so higher roles outrank lower ones.
 * @since REQ-003
 */
export const WORKSPACE_ROLE_RANK: Record<WorkspaceRole, number> = { OWNER: 3, ADMIN: 2, MEMBER: 1 };

/**
 * Maps each workspace permission to the roles that hold it.
 * @since REQ-003
 * @updated REQ-004
 */
export const WORKSPACE_PERMISSIONS = {
  'workspace:read': ['OWNER', 'ADMIN', 'MEMBER'],
  'workspace:update': ['OWNER', 'ADMIN'],
  'workspace:delete': ['OWNER'],
  'workspace:transfer': ['OWNER'],
  'member:read': ['OWNER', 'ADMIN', 'MEMBER'],
  'member:add': ['OWNER', 'ADMIN'],
  'member:update': ['OWNER', 'ADMIN'],
  'member:remove': ['OWNER', 'ADMIN', 'MEMBER'],
  'board:read': ['OWNER', 'ADMIN', 'MEMBER'],
  'board:create': ['OWNER', 'ADMIN'],
  'board:update': ['OWNER', 'ADMIN'],
  'board:delete': ['OWNER', 'ADMIN'],
  'task:read': ['OWNER', 'ADMIN', 'MEMBER'],
  'task:create': ['OWNER', 'ADMIN', 'MEMBER'],
  'task:update': ['OWNER', 'ADMIN', 'MEMBER'],
  'task:delete': ['OWNER', 'ADMIN', 'MEMBER'],
} as const satisfies Record<string, readonly WorkspaceRole[]>;
export type WorkspacePermissionName = keyof typeof WORKSPACE_PERMISSIONS;

/**
 * Returns true when the role holds the workspace permission.
 * @since REQ-003
 */
export function hasWorkspacePermission(
  role: WorkspaceRole,
  permission: WorkspacePermissionName,
): boolean {
  return (WORKSPACE_PERMISSIONS[permission] as readonly WorkspaceRole[]).includes(role);
}

/**
 * Returns true when the actor may act on a member holding the target role (strictly lower rank).
 * @since REQ-003
 */
export function canManageMember(actorRole: WorkspaceRole, targetRole: WorkspaceRole): boolean {
  return WORKSPACE_ROLE_RANK[actorRole] > WORKSPACE_ROLE_RANK[targetRole];
}

/**
 * Returns true when the actor may grant the role: never OWNER, and only roles ranked below the actor.
 * @since REQ-003
 */
export function canAssignRole(actorRole: WorkspaceRole, role: WorkspaceRole): boolean {
  return role !== 'OWNER' && WORKSPACE_ROLE_RANK[actorRole] > WORKSPACE_ROLE_RANK[role];
}

/**
 * Returns true when the actor may remove the target: anyone but the owner may leave,
 * and others may be removed only by a higher role.
 * @since REQ-003
 */
export function canRemoveMember(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole,
  isSelf: boolean,
): boolean {
  if (isSelf) return actorRole !== 'OWNER';
  return canManageMember(actorRole, targetRole);
}

/**
 * Validates a workspace name, trimming whitespace.
 * @since REQ-003
 */
export const workspaceNameSchema = z.string().trim().min(1, 'Name is required').max(80);

/**
 * Validates the payload for creating a workspace.
 * @since REQ-003
 */
export const createWorkspaceSchema = z.object({ name: workspaceNameSchema });
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceSchema>;

/**
 * Validates the payload for renaming a workspace.
 * @since REQ-003
 */
export const updateWorkspaceSchema = z.object({ name: workspaceNameSchema });
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceSchema>;

/**
 * Validates the payload for adding a registered user to a workspace by email.
 * @since REQ-003
 */
export const addMemberSchema = z.object({
  email: emailSchema,
  role: z.enum(ASSIGNABLE_WORKSPACE_ROLES).default('MEMBER'),
});
export type AddMemberInput = z.infer<typeof addMemberSchema>;

/**
 * Validates the payload for changing a member's role.
 * @since REQ-003
 */
export const updateMemberRoleSchema = z.object({ role: z.enum(ASSIGNABLE_WORKSPACE_ROLES) });
export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

/**
 * Validates the payload for handing workspace ownership to another member.
 * @since REQ-003
 */
export const transferOwnershipSchema = z.object({ userId: z.uuid('Invalid user id') });
export type TransferOwnershipInput = z.infer<typeof transferOwnershipSchema>;

/**
 * Describes a workspace as seen by one of its members.
 * @since REQ-003
 */
export interface Workspace {
  id: string;
  name: string;
  createdAt: string;
  myRole: WorkspaceRole;
  memberCount: number;
}

/**
 * Describes a member of a workspace.
 * @since REQ-003
 */
export interface WorkspaceMember {
  userId: string;
  email: string;
  name: string;
  role: WorkspaceRole;
  joinedAt: string;
}

/**
 * Returns true when the actor may delete a task: admins and owners delete any task, members only their own.
 * @since REQ-004
 */
export function canDeleteTask(actorRole: WorkspaceRole, isCreator: boolean): boolean {
  return isCreator || WORKSPACE_ROLE_RANK[actorRole] >= WORKSPACE_ROLE_RANK.ADMIN;
}

/**
 * Validates offset pagination query parameters.
 * @since REQ-004
 */
export const offsetPageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type OffsetPageQuery = z.infer<typeof offsetPageQuerySchema>;

/**
 * Describes one page of an offset-paginated list.
 * @since REQ-004
 */
export interface OffsetPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Describes one page of a cursor-paginated list; nextCursor is null on the last page.
 * @since REQ-004
 */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

/**
 * Validates a board or column name, trimming whitespace.
 * @since REQ-004
 */
export const boardNameSchema = z.string().trim().min(1, 'Name is required').max(80);

/**
 * Validates the payload for creating or renaming a board.
 * @since REQ-004
 */
export const boardInputSchema = z.object({ name: boardNameSchema });
export type BoardInput = z.infer<typeof boardInputSchema>;

/**
 * Validates the payload for creating or renaming a board column.
 * @since REQ-004
 */
export const columnInputSchema = z.object({ name: boardNameSchema });
export type ColumnInput = z.infer<typeof columnInputSchema>;

/**
 * Validates a task title, trimming whitespace.
 * @since REQ-004
 */
export const taskTitleSchema = z.string().trim().min(1, 'Title is required').max(200);

/**
 * Validates the payload for creating a task at the end of a column.
 * @since REQ-001
 * @updated REQ-004
 */
export const createTaskSchema = z.object({
  columnId: z.uuid(),
  title: taskTitleSchema,
  description: z.string().max(5000).nullish(),
  assigneeId: z.uuid().nullish(),
  dueDate: z.coerce.date().nullish(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/**
 * Validates a partial task edit; version must be the one the client last read.
 * @since REQ-004
 */
export const updateTaskSchema = z
  .object({
    version: z.number().int().positive(),
    title: taskTitleSchema.optional(),
    description: z.string().max(5000).nullable().optional(),
    assigneeId: z.uuid().nullable().optional(),
    dueDate: z.coerce.date().nullable().optional(),
  })
  .refine(
    ({ version: _version, ...changes }) => Object.values(changes).some((v) => v !== undefined),
    {
      message: 'Nothing to update',
    },
  );
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/**
 * Validates a drag-and-drop move: the target column and the task to land after (null for the top).
 * @since REQ-004
 */
export const moveTaskSchema = z.object({
  columnId: z.uuid(),
  afterTaskId: z.uuid().nullable(),
});
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;

/**
 * Validates task search query parameters with cursor pagination.
 * @since REQ-004
 */
export const taskSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  boardId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type TaskSearchQuery = z.infer<typeof taskSearchQuerySchema>;

/**
 * Describes a board in a list.
 * @since REQ-004
 */
export interface BoardSummary {
  id: string;
  name: string;
  createdAt: string;
}

/**
 * Describes a user referenced by a task.
 * @since REQ-004
 */
export interface TaskUser {
  id: string;
  name: string;
}

/**
 * Describes a task.
 * @since REQ-004
 */
export interface Task {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  position: string;
  version: number;
  assignee: TaskUser | null;
  creatorId: string | null;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Describes a board column with its tasks in order.
 * @since REQ-004
 */
export interface BoardColumn {
  id: string;
  name: string;
  position: string;
  tasks: Task[];
}

/**
 * Describes a board with its columns and tasks in order.
 * @since REQ-004
 */
export interface BoardDetail extends BoardSummary {
  columns: BoardColumn[];
}

/**
 * Describes the response body of the health check endpoint.
 * @since REQ-001
 */
export interface HealthResponse {
  status: 'ok' | 'error';
  uptime: number;
  checks: Record<string, 'up' | 'down'>;
}

/**
 * Describes the error body the API returns for every failed request.
 * @since REQ-001
 */
export interface ApiError {
  statusCode: number;
  message: string;
  errors?: Record<string, string[]>;
  path: string;
  timestamp: string;
}

/**
 * Validates the payload for inviting someone to a workspace by email.
 * @since REQ-006
 */
export const createInvitationSchema = z.object({
  email: emailSchema,
  role: z.enum(ASSIGNABLE_WORKSPACE_ROLES).default('MEMBER'),
});
export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;

/**
 * Validates an invitation token sent back by the invitee.
 * @since REQ-006
 */
export const invitationTokenSchema = z.object({ token: z.string().min(20).max(200) });
export type InvitationTokenInput = z.infer<typeof invitationTokenSchema>;

/**
 * Describes a pending invitation as seen by workspace admins.
 * @since REQ-006
 */
export interface Invitation {
  id: string;
  email: string;
  role: WorkspaceRole;
  invitedBy: { id: string; name: string } | null;
  expiresAt: string;
  createdAt: string;
}

/**
 * Describes what an invitee sees before accepting an invitation.
 * @since REQ-006
 */
export interface InvitationPreview {
  workspaceId: string;
  workspaceName: string;
  email: string;
  role: WorkspaceRole;
  invitedByName: string | null;
  expiresAt: string;
}
