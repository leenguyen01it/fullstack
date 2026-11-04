import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateInvitationInput,
  Invitation,
  InvitationPreview,
  Workspace,
} from '@taskflow/shared';
import { apiFetch } from './client';
import { workspaceKeys } from './workspaces';

/**
 * Fetches the pending invitations of a workspace (admins only).
 * @since REQ-007
 */
export function useInvitations(workspaceId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['workspace', workspaceId, 'invitations'],
    queryFn: () => apiFetch<Invitation[]>(`/workspaces/${workspaceId}/invitations`),
    enabled,
  });
}

/**
 * Provides create and revoke mutations for a workspace's invitations.
 * @since REQ-007
 */
export function useInvitationMutations(workspaceId: string) {
  const queryClient = useQueryClient();
  const base = `/workspaces/${workspaceId}/invitations`;
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ['workspace', workspaceId, 'invitations'] });

  return {
    create: useMutation({
      mutationFn: (input: CreateInvitationInput) =>
        apiFetch<Invitation>(base, { method: 'POST', body: JSON.stringify(input) }),
      onSuccess: refresh,
    }),
    revoke: useMutation({
      mutationFn: (invitationId: string) =>
        apiFetch<void>(`${base}/${invitationId}`, { method: 'DELETE' }),
      onSuccess: refresh,
    }),
  };
}

/**
 * Looks up what an invitation token grants; never retried because a bad token stays bad.
 * @since REQ-007
 */
export function useInvitationPreview(token: string) {
  return useQuery({
    queryKey: ['invitation', token],
    queryFn: () =>
      apiFetch<InvitationPreview>('/invitations/lookup', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    retry: false,
  });
}

/**
 * Accepts an invitation and refreshes the workspace list.
 * @since REQ-007
 */
export function useAcceptInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) =>
      apiFetch<Workspace>('/invitations/accept', {
        method: 'POST',
        body: JSON.stringify({ token }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: workspaceKeys.all }),
  });
}
