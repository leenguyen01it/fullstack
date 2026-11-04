import { useHealth } from '../api/health';

/**
 * Shows the live status of the API, database and Redis.
 * @since REQ-001
 * @updated REQ-007
 */
export function StatusCard() {
  const { data, isPending, isError, error } = useHealth();

  return (
    <section className="card">
      <h2>System status</h2>
      {isPending && <p>Checking…</p>}
      {isError && <p className="down">API unreachable: {error.message}</p>}
      {data && (
        <ul className="checks">
          <li>
            API <span className={data.status === 'ok' ? 'up' : 'down'}>{data.status}</span>
          </li>
          {Object.entries(data.checks).map(([name, state]) => (
            <li key={name}>
              {name} <span className={state}>{state}</span>
            </li>
          ))}
          <li>
            uptime <span>{data.uptime}s</span>
          </li>
        </ul>
      )}
    </section>
  );
}
