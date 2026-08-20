import { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

interface DemoUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export default function Login() {
  const { user, login, loading } = useAuth();
  const navigate = useNavigate();
  const [demo, setDemo] = useState<{ users: DemoUser[]; password: string } | null>(null);
  const [email, setEmail] = useState('angad@example.com');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ users: DemoUser[]; password: string }>('/api/auth/demo-users')
      .then((d) => {
        setDemo(d);
        setPassword(d.password);
      })
      .catch(() => undefined);
  }, []);

  if (!loading && user) return <Navigate to="/courses" replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate('/courses');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page narrow" style={{ paddingTop: 60 }}>
      <div className="card">
        <h1>EduLab Consumer LMS</h1>
        <p className="subtitle">
          Sign in as a demo student. Course content is hosted by the EduLab Content Provider and opened through an
          LTI 1.3 launch.
        </p>
        <form onSubmit={submit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {error && (
            <div className="notice bad" style={{ marginBottom: 12 }}>
              {error}
            </div>
          )}
          <button type="submit" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>

      {demo && (
        <div className="card">
          <h3>Demo accounts</h3>
          <div className="table-wrap">
            <table>
              <tbody>
                {demo.users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.name}
                      <br />
                      <span className="muted small">{u.email}</span>
                    </td>
                    <td>
                      <span className="badge">{u.role}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="secondary small" onClick={() => setEmail(u.email)}>
                        Use
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small" style={{ marginBottom: 0, marginTop: 10 }}>
            Shared demo password: <span className="mono">{demo.password}</span>
          </p>
        </div>
      )}
    </div>
  );
}
