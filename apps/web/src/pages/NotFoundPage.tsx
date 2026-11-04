import { Link } from 'react-router';

/**
 * Tells the user the page or resource does not exist, with a link home.
 * @since REQ-007
 */
export function NotFoundPage({ what = 'Page' }: { what?: string }) {
  return (
    <section className="card">
      <h2>{what} not found</h2>
      <p className="subtitle">It may have been deleted, or you may not have access to it.</p>
      <Link to="/">Back to your workspaces</Link>
    </section>
  );
}
