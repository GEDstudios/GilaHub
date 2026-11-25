import { useHub, useSync } from '../context';
import { navigate } from '../router';
import { Avatar } from '../ui/primitives';

/** My avatar with a quiet sync dot; opens Settings. */
export function SyncBadge() {
  const hub = useHub();
  const { status } = useSync();
  const me = hub.me();
  const label =
    status === 'synced' ? 'Synced' : status === 'local' ? 'On this device only' : status === 'offline' ? 'Offline · saved on this device' : 'Syncing';
  return (
    <button type="button" className="me" onClick={() => navigate({ name: 'settings' })} aria-label={`Settings · ${label}`} title={label}>
      <Avatar member={me} size="md" />
      <span className={`syncdot syncdot--${status}`} />
    </button>
  );
}

/** Just the dot, for places that are already a button. */
export function SyncDot() {
  const { status } = useSync();
  return <span className={`syncdot syncdot--${status}`} style={{ marginLeft: 'auto' }} title={status} />;
}
