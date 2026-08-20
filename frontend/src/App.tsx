import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import Login from './pages/Login';
import Courses from './pages/Courses';
import CourseDetail from './pages/CourseDetail';
import LaunchView from './pages/LaunchView';

function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <header className="app-header">
      <span className="brand">EduLab Consumer LMS</span>
      <span className="role">LTI 1.3 Platform</span>
      <nav>
        <NavLink to="/courses" className={({ isActive }) => (isActive ? 'active' : '')}>
          My courses
        </NavLink>
        <span className="badge" style={{ alignSelf: 'center' }}>
          {user.name} &middot; {user.role}
        </span>
        <a
          href="#"
          onClick={async (e) => {
            e.preventDefault();
            await logout();
            navigate('/login');
          }}
        >
          Sign out
        </a>
      </nav>
    </header>
  );
}

function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="page narrow">
        <div className="card empty">Loading…</div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <AuthProvider>
      <Header />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/courses"
          element={
            <Protected>
              <Courses />
            </Protected>
          }
        />
        <Route
          path="/courses/:courseId"
          element={
            <Protected>
              <CourseDetail />
            </Protected>
          }
        />
        <Route
          path="/courses/:courseId/launch/:linkId"
          element={
            <Protected>
              <LaunchView />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/courses" replace />} />
      </Routes>
    </AuthProvider>
  );
}
