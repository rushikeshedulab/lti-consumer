import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

/**
 * The iframe host.
 *
 * The frame's FIRST request is same-origin (/lti/initiate), so the student's
 * LMS session cookie is sent normally. From there the browser is redirected out
 * to the tool and back through the full OIDC handshake, and what finally renders
 * inside this frame is the provider's own player - on the provider's origin,
 * serving the provider's video.
 */
export default function LaunchView() {
  const { courseId, linkId } = useParams();
  const [reloadKey, setReloadKey] = useState(0);

  const src = useMemo(
    () => `/lti/initiate?resourceLinkId=${encodeURIComponent(linkId ?? '')}&r=${reloadKey}`,
    [linkId, reloadKey],
  );

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 14 }}>
        <div>
          <Link to={`/courses/${courseId}`} className="muted small">
            &larr; Back to course
          </Link>
          <h1 style={{ margin: '8px 0 2px' }}>Lecture</h1>
          <p className="muted small" style={{ margin: 0 }}>
            Delivered by the content provider inside this LMS page via LTI 1.3.
          </p>
        </div>
        <div className="row" style={{ marginLeft: 'auto' }}>
          <button className="secondary small" onClick={() => setReloadKey((k) => k + 1)}>
            Relaunch
          </button>
          <Link className="btn secondary small" to={`/courses/${courseId}`}>
            Close lecture
          </Link>
        </div>
      </div>

      <div className="card tight">
        <div className="diagram">{`consumer (this page)  --form POST-->  provider /lti/login
provider  --redirect-->  consumer /lti/authorize   (signs the id_token)
consumer  --form POST-->  provider /lti/launch     (validated, then rendered below)`}</div>
      </div>

      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 10,
          overflow: 'hidden',
          background: 'var(--surface)',
        }}
      >
        <iframe
          key={reloadKey}
          src={src}
          title="Provider content"
          style={{ width: '100%', height: '78vh', border: 0, display: 'block' }}
          allow="fullscreen; autoplay; encrypted-media"
        />
      </div>

      <p className="muted small" style={{ marginTop: 12 }}>
        Closing this page ends the viewing session on the provider side (CONTENT_VIEW_ENDED).
      </p>
    </div>
  );
}
