import { StatusCard } from '../components/StatusCard';
import { WorkspacesPanel } from '../workspaces/WorkspacesPanel';

/**
 * Shows the user's workspaces and the system status.
 * @since REQ-007
 */
export function HomePage() {
  return (
    <>
      <WorkspacesPanel />
      <StatusCard />
    </>
  );
}
