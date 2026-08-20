import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';

interface Course {
  id: string;
  title: string;
  description: string;
  content_source: string;
  role: string;
  link_count: string;
}

export default function Courses() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ courses: Course[] }>('/api/courses')
      .then((r) => setCourses(r.courses))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="page">
      <h1>My courses</h1>
      <p className="subtitle">
        The LMS holds enrolment and course metadata. Every lecture you open is served live by the content provider
        over LTI 1.3.
      </p>

      {loading && <div className="card empty">Loading…</div>}

      <div className="grid two">
        {courses.map((course) => (
          <div className="card" key={course.id}>
            <span className="badge accent">{course.role}</span>
            <h2 style={{ marginTop: 10 }}>{course.title}</h2>
            <p className="muted small">{course.description}</p>
            <dl className="kv" style={{ margin: '14px 0' }}>
              <dt>Content source</dt>
              <dd>{course.content_source}</dd>
              <dt>Lectures linked</dt>
              <dd>{course.link_count}</dd>
            </dl>
            <Link className="btn" to={`/courses/${course.id}`}>
              Open course
            </Link>
          </div>
        ))}
      </div>

      {!loading && courses.length === 0 && <div className="card empty">You are not enrolled in any courses.</div>}
    </div>
  );
}
