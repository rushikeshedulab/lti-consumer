import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, formatDuration, formatTime } from '../lib/api';

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
interface SyncState {
  ok: boolean;
  courses: number;
  links: number;
  syncedAt: string | null;
  error?: string;
}
interface CourseResponse {
  course: { id: string; title: string; description: string; content_source: string };
  role: string;
  modules: CourseModule[];
  sync: SyncState;
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
  const [data, setData] = useState<CourseResponse | null>(null);
  const [launches, setLaunches] = useState<LaunchRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    if (!courseId) return;
    api<CourseResponse>(`/api/courses/${courseId}`).then(setData).catch((e: Error) => setError(e.message));
    api<{ launches: LaunchRow[] }>(`/api/courses/${courseId}/launches`)
      .then((r) => setLaunches(r.launches))
      .catch(() => undefined);
  }, [courseId]);

  useEffect(load, [load]);

  // The lecture list is a mirror of the provider's catalog; this asks for a
  // fresh copy instead of waiting for the next background sync.
  const refresh = async () => {
    setRefreshing(true);
    try {
      await api('/api/courses/sync', { method: 'POST' });
      load();
    } finally {
      setRefreshing(false);
    }
  };

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

  return (
    <div className="page">
      <Link to="/courses" className="muted small">
        &larr; My courses
      </Link>
      <div className="row" style={{ marginTop: 10 }}>
        <div>
          <h1>{data.course.title}</h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>
            {data.course.description}
          </p>
        </div>
        <button className="secondary small" style={{ marginLeft: 'auto' }} onClick={refresh} disabled={refreshing}>
          {refreshing ? 'Checking…' : 'Check for new content'}
        </button>
      </div>

      <p className="muted small" style={{ margin: '12px 0 18px' }}>
        This list mirrors what the provider&rsquo;s administrator has published. Nothing is selected here.
        {data.sync?.syncedAt && <> Last checked {formatTime(data.sync.syncedAt)}.</>}
      </p>

      {data.sync && !data.sync.ok && (
        <div className="notice warn" style={{ marginBottom: 16 }}>
          Could not reach the content provider just now, so this list may be out of date.
          {data.sync.error && <span className="muted small"> ({data.sync.error})</span>}
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
                <span className="badge">provider item: {link.custom_params.lecture_id ?? '-'}</span>{' '}
                <span className="badge">
                  {link.created_via === 'deep_linking' ? 'via deep linking' : 'published by provider'}
                </span>
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
          The provider has not published anything in this course yet. It appears here as soon as the provider&rsquo;s
          administrator uploads it.
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
