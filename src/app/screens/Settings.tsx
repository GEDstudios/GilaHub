import { OptRow } from '../components/pickers';
import { TagManager } from '../components/Tags';
import { useHub } from '../context';
import { back } from '../router';
import { useOverlays } from '../ui/overlays';
import { Band, Section } from '../ui/primitives';
import { G } from '../ui/glyphs';
import { MeCard } from './settings/MeCard';
import { Notifications } from './settings/Notifications';
import { Preferences } from './settings/Preferences';
import { YourData } from './settings/YourData';
import { About } from './settings/About';

/**
 * Settings: one calm page where everything changes in place. My card (name, colour, devices),
 * Notifications, Tags, how I like things, my data, About; each section in its own file under
 * settings/. The bottom bar is arranged on Folders and Today on Today, each where it lives.
 */

/** Our tags: how many, and the way into them (the same sheet as from any tag picker). */
function TagsSection() {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const tags = hub.tags();
  return (
    <Section title="Tags">
      <div className="group">
        <OptRow
          icon={G.tag}
          title="Your tags"
          sub={tags.length ? tags.slice(0, 4).map((t) => t.name).join(', ') + (tags.length > 4 ? '…' : '') : 'Make some, then filter any screen by them'}
          value={tags.length || undefined}
          chev
          onClick={() => openSheet((close) => <TagManager onClose={close} />)}
        />
      </div>
    </Section>
  );
}

// ---------------------------------------------------------------- the page

export function Settings() {
  const hub = useHub();
  const me = hub.me();
  const partner = hub.partner();
  if (!me) return null;

  return (
    <>
      <Band className="band--root" title="Settings" onBack={() => back({ name: 'today' })} />
      <div className="column settings">
        <MeCard me={me} partner={partner} />

        <Notifications me={me} partner={partner} />
        <TagsSection />
        <Preferences />
        <YourData />
        <About me={me} partner={partner} />
      </div>
    </>
  );
}
