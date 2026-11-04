import { Link, useNavigate, useParams } from 'react-router';
import { useAcceptInvitation, useInvitationPreview } from '../api/invitations';
import { ApiRequestError } from '../api/client';
import { useAuth } from '../auth/AuthProvider';

/**
 * Shows what an emailed invitation grants and lets the signed-in invitee accept it, explaining when the
 * link is invalid or was sent to another email address.
 * @since REQ-007
 */
export function AcceptInvitationPage() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const preview = useInvitationPreview(token);
  const accept = useAcceptInvitation();

  if (preview.isPending) return <p className="subtitle">Checking invitation…</p>;
  if (preview.error) {
    return (
      <section className="card">
        <h2>Invitation unavailable</h2>
        <p className="subtitle">This link is invalid, expired, revoked or already used.</p>
        <Link to="/">Go to your workspaces</Link>
      </section>
    );
  }

  const invitation = preview.data;
  const wrongEmail = user && user.email !== invitation.email;
  const acceptError =
    accept.error instanceof ApiRequestError && accept.error.status === 403
      ? `This invitation was sent to ${invitation.email}. Sign in with that email to accept it.`
      : accept.error?.message;

  return (
    <section className="card">
      <h2>Join {invitation.workspaceName}</h2>
      <p>
        {invitation.invitedByName ?? 'Someone'} invited <b>{invitation.email}</b> to join as{' '}
        {invitation.role}.
      </p>
      <p className="subtitle">Expires {new Date(invitation.expiresAt).toLocaleString()}</p>
      {wrongEmail && (
        <p className="down">
          You are signed in as {user.email}. Sign out and sign in as {invitation.email} to accept.
        </p>
      )}
      {acceptError && <p className="down">{acceptError}</p>}
      <div className="row">
        <button
          type="button"
          disabled={accept.isPending || Boolean(wrongEmail)}
          onClick={() =>
            accept.mutate(token, {
              onSuccess: (workspace) => navigate(`/w/${workspace.id}`, { replace: true }),
            })
          }
        >
          Accept invitation
        </button>
        <Link to="/">Not now</Link>
      </div>
    </section>
  );
}
