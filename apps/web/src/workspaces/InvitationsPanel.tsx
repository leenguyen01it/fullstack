import { useState } from 'react';
import type { FormEvent } from 'react';
import {
  ASSIGNABLE_WORKSPACE_ROLES,
  canAssignRole,
  createInvitationSchema,
  type Workspace,
} from '@taskflow/shared';
import { useInvitationMutations, useInvitations } from '../api/invitations';

/**
 * Lets admins invite people by email with a role below their own, and lists or revokes pending invitations.
 * @since REQ-007
 */
export function InvitationsPanel({ workspace }: { workspace: Workspace }) {
  const { data: invitations } = useInvitations(workspace.id, true);
  const { create, revoke } = useInvitationMutations(workspace.id);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const grantableRoles = ASSIGNABLE_WORKSPACE_ROLES.filter((role) =>
    canAssignRole(workspace.myRole, role),
  );

  /**
   * Validates the email and role, then sends the invitation.
   * @since REQ-007
   */
  function handleInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = createInvitationSchema.safeParse(Object.fromEntries(new FormData(form)));
    if (!parsed.success) {
      setMessage({ ok: false, text: parsed.error.issues[0]?.message ?? 'Invalid input' });
      return;
    }
    create.mutate(parsed.data, {
      onSuccess: (invitation) => {
        form.reset();
        setMessage({ ok: true, text: `Invitation sent to ${invitation.email}` });
      },
      onError: (err) => setMessage({ ok: false, text: err.message }),
    });
  }

  return (
    <div className="members">
      <h3>Invitations</h3>
      <form className="row" onSubmit={handleInvite} noValidate>
        <input
          name="email"
          type="email"
          placeholder="Email to invite"
          aria-label="Email to invite"
        />
        <select name="role" aria-label="Role" defaultValue="MEMBER">
          {grantableRoles.map((role) => (
            <option key={role}>{role}</option>
          ))}
        </select>
        <button type="submit" disabled={create.isPending}>
          Invite
        </button>
      </form>
      {message && (
        <p className={message.ok ? 'up' : 'down'} role="status">
          {message.text}
        </p>
      )}
      {invitations && invitations.length > 0 && (
        <ul className="checks">
          {invitations.map((invitation) => (
            <li key={invitation.id}>
              <span>
                {invitation.email} <small className="subtitle">{invitation.role}</small>
                <br />
                <small className="subtitle">
                  expires {new Date(invitation.expiresAt).toLocaleDateString()}
                </small>
              </span>
              <button
                type="button"
                className="secondary"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(invitation.id)}
              >
                Revoke
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
