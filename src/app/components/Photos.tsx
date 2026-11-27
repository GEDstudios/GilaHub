import { useState } from 'react';
import type { Hub } from '../../core/hub';
import { useHub } from '../context';
import { haptic } from '../ui/haptics';
import { Icon } from '../ui/Icon';
import { Sheet, useOverlays } from '../ui/overlays';
import { shrinkImage } from './Sketch';
import { TOAST } from '../ui/tokens';
import { G } from '../ui/glyphs';
import { Button } from '../ui/primitives';

/**
 * Photos on a task or a folder: a strip of little prints (each a touch turned, like the notes),
 * a + at its end for another, a tap opens one big. They're kept the way the thing is: an Only me
 * task's photos are only mine.
 */

/** Ask for a photo (the camera or the library) and make it small enough to keep. Call it from a tap. */
function pickPhoto(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.append(input);
    let settled = false;
    const done = (v: string | null) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(v);
    };
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return done(null);
      const r = new FileReader();
      r.onload = () =>
        shrinkImage(String(r.result), 1080)
          .then(done)
          .catch(() => done(null));
      r.onerror = () => done(null);
      r.readAsDataURL(f);
    };
    // Closed without picking (where the browser says so).
    input.addEventListener('cancel', () => done(null));
    input.click();
  });
}

/** Pick a photo and put it on `on` ("item:<id>", "list:<id>"). Call it from a tap. */
export async function addPhotoTo(hub: Hub, toast: (text: string, opts?: { ms?: number }) => void, on: string): Promise<void> {
  const url = await pickPhoto();
  if (!url) return;
  hub.addPhoto(on, url);
  haptic('success');
  toast('Photo added', { ms: TOAST.short });
}

export function useAddPhoto(on: string) {
  const hub = useHub();
  const { toast } = useOverlays();
  return () => addPhotoTo(hub, toast, on);
}

const TURN = [-3, 2, -1.5, 3, -2.5, 1.5];

export function Photos({ on }: { on: string }) {
  const hub = useHub();
  const { openSheet } = useOverlays();
  const add = useAddPhoto(on);
  const photos = hub.photosOf(on);
  if (!photos.length) return null;
  return (
    <div className="photos" role="group" aria-label="Photos">
      {photos.map((p, i) => {
        const src = hub.shotOf('photo', p.id);
        return (
          <button
            key={p.id}
            type="button"
            className="photos__print"
            style={{ rotate: `${TURN[i % TURN.length]}deg` }}
            aria-label={`Photo ${i + 1}`}
            onClick={() => openSheet((close) => <PhotoSheet id={p.id} onClose={close} />)}
          >
            {src ? <img src={src} alt="" /> : <span className="photos__wait" />}
          </button>
        );
      })}
      <button type="button" className="photos__add" aria-label="Add a photo" onClick={() => void add()}>
        <Icon name={G.photo} />
        <Icon name={G.add} className="photos__plus" />
      </button>
    </div>
  );
}

/** One photo, big; it can be taken off (Undo brings it back). */
function PhotoSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const hub = useHub();
  const { toast } = useOverlays();
  const [src] = useState(() => hub.shotOf('photo', id));
  return (
    <Sheet onClose={onClose} label="Photo">
      <div className="photosheet">
        {src ? <img src={src} alt="" /> : <p className="hint">Still on its way…</p>}
        <Button
          icon={G.delete}
          quiet
          block
          onClick={() => {
            const undo = hub.removePhoto(id);
            onClose();
            toast('Photo removed', { undo });
          }}
        >
          Remove photo
        </Button>
      </div>
    </Sheet>
  );
}
