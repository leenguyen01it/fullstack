import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddMemberInput,
  AssignableWorkspaceRole,
  CreateWorkspaceInput,
  UpdateWorkspaceInput,
  Workspace,
  WorkspaceMember,
} from '@taskflow/shared';
import { apiFetch } from './client';

/**
 * Builds the query keys for workspace data as a tree so a whole workspace can be invalidated by prefix.
 * @since REQ-003
 * @updated REQ-007
 */
export const workspaceKeys = {
  all: ['workspaces'] as const,
  detail: (workspaceId: string) => ['workspace', workspaceId] as const,
  members: (workspaceId: string) => ['workspace', workspaceId, 'members'] as const,
};

/**
 * Fetches the workspaces the signed-in user belongs to.
 * @since REQ-003
 * @updated REQ-007
 */
export function useWorkspaces() {
  return useQuery({
    queryKey: workspaceKeys.all,
    queryFn: () => apiFetch<Workspace[]>('/workspaces'),
  });
}

/**
 * Fetches one workspace with the user's role in it.
 * @since REQ-007
 */
export function useWorkspace(workspaceId: string) {
  return useQuery({
    queryKey: workspaceKeys.detail(workspaceId),
    queryFn: () => apiFetch<Workspace>(`/workspaces/${workspaceId}`),
  });
}

/**
 * Fetches the members of a workspace.
 * @since REQ-003
 * @updated REQ-007
 */
export function useMembers(workspaceId: string) {
  return useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: () => apiFetch<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`),
  });
}

/**
 * Provides create, rename and delete mutations that refresh workspace data on success.
 * @since REQ-003
 * @updated REQ-007
 */
export function useWorkspaceMutations() {
  const queryClient = useQueryClient();
  const invalidate = (workspaceId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
      workspaceId && queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId) }),
    ]);

  return {
    create: useMutation({
      mutationFn: (input: CreateWorkspaceInput) =>
        apiFetch<Workspace>('/workspaces', { method: 'POST', body: JSON.stringify(input) }),
      onSuccess: () => invalidate(),
    }),
    rename: useMutation({
      mutationFn: ({ id, ...input }: UpdateWorkspaceInput & { id: string }) =>
        apiFetch<Workspace>(`/workspaces/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
      onSuccess: (workspace) => invalidate(workspace.id),
    }),
    remove: useMutation({
      mutationFn: (id: string) => apiFetch<void>(`/workspaces/${id}`, { method: 'DELETE' }),
      onSuccess: (_data, id) => {
        queryClient.removeQueries({ queryKey: workspaceKeys.detail(id) });
        return invalidate();
      },
    }),
  };
}

/**
 * Provides add, change-role, remove and transfer-ownership mutations for one workspace,
 * refreshing the workspace subtree and the workspace list once each settles.
 * @since REQ-003
 * @updated REQ-007
 */
export function useMemberMutations(workspaceId: string) {
  const queryClient = useQueryClient();
  const base = `/workspaces/${workspaceId}`;
  const onSettled = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
    ]);

  return {
    add: useMutation({
      mutationFn: (input: AddMemberInput) =>
        apiFetch<WorkspaceMember>(`${base}/members`, {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      onSettled,
    }),
    updateRole: useMutation({
      mutationFn: ({ memberId, role }: { memberId: string; role: AssignableWorkspaceRole }) =>
        apiFetch<WorkspaceMember>(`${base}/members/${memberId}`, {
          method: 'PATCH',
          body: JSON.stringify({ role }),
        }),
      onSettled,
    }),
    remove: useMutation({
      mutationFn: (memberId: string) =>
        apiFetch<void>(`${base}/members/${memberId}`, { method: 'DELETE' }),
      onSettled,
    }),
    transfer: useMutation({
      mutationFn: (memberId: string) =>
        apiFetch<WorkspaceMember[]>(`${base}/transfer-ownership`, {
          method: 'POST',
          body: JSON.stringify({ userId: memberId }),
        }),
      onSettled,
    }),
  };
}
