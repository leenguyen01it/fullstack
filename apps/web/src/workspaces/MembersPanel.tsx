import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  ASSIGNABLE_WORKSPACE_ROLES,
  addMemberSchema,
  canAssignRole,
  canManageMember,
  canRemoveMember,
  hasWorkspacePermission,
  type AssignableWorkspaceRole,
  type Workspace,
  type WorkspaceMember,
} from '@taskflow/shared';
import { useMemberMutations, useMembers } from '../api/workspaces';
import { useAuth } from '../auth/AuthProvider';

/**
 * Lists a workspace's members and shows only the add, change-role, remove, leave and
 * transfer-ownership actions the user's role allows.
 * @since REQ-003
 * @updated REQ-007
 */
export function MembersPanel({ workspace, onLeft }: { workspace: Workspace; onLeft: () => void }) {
  const userId = useAuth().user?.id;
  const { data: members, isPending, error } = useMembers(workspace.id);
  const mutations = useMemberMutations(workspace.id);
  const [addError, setAddError] = useState<string | null>(null);
  const myRole = workspace.myRole;
  const grantableRoles = ASSIGNABLE_WORKSPACE_ROLES.filter((role) => canAssignRole(myRole, role));
  const actionError =
    mutations.updateRole.error ?? mutations.remove.error ?? mutations.transfer.error;

  /**
   * Validates the email and role, then adds the member.
   * @since REQ-003
   */
  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = addMemberSchema.safeParse(Object.fromEntries(new FormData(form)));
    if (!parsed.success) {
      setAddError(parsed.error.issues[0]?.message ?? 'Invalid input');
      return;
    }
    setAddError(null);
    mutations.add.mutate(parsed.data, {
      onSuccess: () => form.reset(),
      onError: (err) => setAddError(err.message),
    });
  }

  /**
   * Removes the member, or leaves the workspace when the member is the signed-in user.
   * @since REQ-003
   */
  function handleRemove(member: WorkspaceMember) {
    mutations.remove.mutate(member.userId, {
      onSuccess: () => {
        if (member.userId === userId) onLeft();
      },
    });
  }

  return (
    <div className="members">
      <h3>Members</h3>
      {isPending && <p className="subtitle">Loading…</p>}
      {error && <p className="down">{error.message}</p>}
      <ul className="checks">
        {members?.map((member) => {
          const isSelf = member.userId === userId;
          const canChangeRole = !isSelf && canManageMember(myRole, member.role);
          return (
            <li key={member.userId}>
              <span>
                {member.name} {isSelf && <small>(you)</small>}
                <br />
                <small className="subtitle">{member.email}</small>
              </span>
              <span className="row">
                {canChangeRole && grantableRoles.length > 1 ? (
                  <select
                    aria-label={`Role of ${member.name}`}
                    value={member.role}
                    disabled={mutations.updateRole.isPending}
                    onChange={(event) =>
                      mutations.updateRole.mutate({
                        memberId: member.userId,
                        role: event.target.value as AssignableWorkspaceRole,
                      })
                    }
                  >
                    {grantableRoles.map((role) => (
                      <option key={role}>{role}</option>
                    ))}
                  </select>
                ) : (
                  <small>{member.role}</small>
                )}
                {myRole === 'OWNER' && !isSelf && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={mutations.transfer.isPending}
                    onClick={() => mutations.transfer.mutate(member.userId)}
                  >
                    Make owner
                  </button>
                )}
                {canRemoveMember(myRole, member.role, isSelf) && (
                  <button
                    type="button"
                    className="secondary"
                    disabled={mutations.remove.isPending}
                    onClick={() => handleRemove(member)}
                  >
                    {isSelf ? 'Leave' : 'Remove'}
                  </button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {actionError && <p className="down">{actionError.message}</p>}

      {hasWorkspacePermission(myRole, 'member:add') && (
        <form className="row" onSubmit={handleAdd} noValidate>
          <input
            name="email"
            type="email"
            placeholder="Email of a registered user"
            aria-label="Email"
          />
          <select name="role" aria-label="Role" defaultValue="MEMBER">
            {grantableRoles.map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
          <button type="submit" disabled={mutations.add.isPending}>
            Add
          </button>
        </form>
      )}
      {addError && <p className="down">{addError}</p>}
    </div>
  );
}
