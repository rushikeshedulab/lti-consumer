import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatDuration, formatTime } from '../lib/api';
import { useAuth } from '../lib/auth';

interface ResourceLink {
  id: string;
  title: string;
  description: string;
  module_label: string | null;
  custom_params: Record<string, string>;
  created_via: string;
}
interface CourseModule {
  label: string;
  links: ResourceLink[];
}
interface CourseResponse {
  course: { id: string; title: string; description: string; content_source: string };
  role: string;
  modules: CourseModule[];
}
interface LaunchRow {
  id: string;
  resource_link_title: string | null;
  message_type: string;
  status: string;
  created_at: string;
  reported_started_at: string | null;
  reported_ended_at: string | null;
  reported_presence_secs: number | null;
  reported_watched_secs: number | null;
}

export default function CourseDetail() {
  const { courseId } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState<CourseResponse | null>(null);
  const [launches, setLaunches] = useState<LaunchRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!courseId) return;
    api<CourseResponse>(`/api/courses/${courseId}`).then(setData).catch((e: Error) => setError(e.message));
    api<{ launches: LaunchRow[] }>(`/api/courses/${courseId}/launches`)
      .then((r) => setLaunches(r.launches))
      .catch(() => undefined);
  }, [courseId]);

  useEffect(load, [load]);

  // Deep Linking runs in a popup and tells us when it is done.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type === 'lti.deepLinkingComplete') load();
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [load]);

  if (error) {
    return (
      <div className="page narrow">
        <div className="card">
          <h1>Cannot open course</h1>
          <p className="muted">{error}</p>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="page">
        <div className="card empty">Loading…</div>
      </div>
    );
  }

  const openDeepLinking = () => {
    window.open(
      `/lti/deep-link/initiate?courseId=${encodeURIComponent(courseId!)}`,
      'lti-deep-linking',
      'width=900,height=760',
    );
  };

  const seeded = data.modules.some((m) => m.links.some((l) => l.created_via === 'seed'));

  return (
    <div className="page">
      <Link to="/courses" className="muted small">
        &larr; My courses
      </Link>
      <h1 style={{ marginTop: 10 }}>{data.course.title}</h1>
      <p className="subtitle">{data.course.description}</p>

      {user?.role === 'instructor' && (
        <div className="card row">
          <div>
            <strong>Instructor tools</strong>
            <div className="muted small">
              Fetch the lecture list from the provider with an LTI Deep Linking request.
            </div>
          </div>
          <button style={{ marginLeft: 'auto' }} onClick={openDeepLinking}>
            Add content from provider
          </button>
        </div>
      )}

      {seeded && (
        <div className="notice warn" style={{ marginBottom: 16 }}>
          Some links below were seeded so the demo runs immediately. Sign in as{' '}
          <span className="mono">instructor@example.com</span> and use <strong>Add content from provider</strong> to
          recreate them through a real LTI Deep Linking round trip.
        </div>
      )}

      {data.modules.map((module) => (
        <div className="card" key={module.label}>
          <h2>{module.label}</h2>
          {module.links.map((link) => (
            <div
              key={link.id}
              className="row"
              style={{ padding: '11px 0', borderBottom: '1px solid var(--border)' }}
            >
              <div style={{ flex: 1, minWidth: 220 }}>
                <strong>{link.title}</strong>
                {link.description && (
                  <>
                    <br />
                    <span className="muted small">{link.description}</span>
                  </>
                )}
                <br />
                <span className="badge">provider lecture: {link.custom_params.lecture_id ?? '-'}</span>{' '}
                <span className="badge">{link.created_via === 'seed' ? 'seeded link' : 'via deep linking'}</span>
              </div>
              <Link className="btn" to={`/courses/${data.course.id}/launch/${link.id}`}>
                Launch lecture
              </Link>
            </div>
          ))}
          {module.links.length === 0 && <p className="muted small">No lectures linked yet.</p>}
        </div>
      ))}

      {data.modules.length === 0 && (
        <div className="card empty">
          No content linked to this course yet. An instructor must add it from the provider via Deep Linking.
        </div>
      )}

      <div className="card">
        <h2>Your launch history</h2>
        <p className="muted small">
          The LMS records that a launch happened. Viewing durations are measured by the provider and reported back
          over an authorised LTI service call - the LMS never sees the video itself.
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Lecture</th>
                <th>Message type</th>
                <th>Status</th>
                <th>Launched</th>
                <th>Watched (reported)</th>
              </tr>
            </thead>
            <tbody>
              {launches.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty">
                    No launches yet.
                  </td>
                </tr>
              )}
              {launches.map((l) => (
                <tr key={l.id}>
                  <td>{l.resource_link_title ?? <span className="muted">deep linking</span>}</td>
                  <td className="small mono">{l.message_type}</td>
                  <td>
                    <span className={l.status === 'authorized' ? 'badge good' : 'badge'}>{l.status}</span>
                  </td>
                  <td className="small">{formatTime(l.created_at)}</td>
                  <td className="small">
                    {l.reported_watched_secs !== null ? (
                      <>
                        {formatDuration(l.reported_watched_secs)}
                        <br />
                        <span className="muted">on page {formatDuration(l.reported_presence_secs ?? 0)}</span>
                      </>
                    ) : (
                      <span className="muted">not reported yet</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
