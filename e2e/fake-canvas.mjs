// A stand-in for Canvas that behaves like a school with tokens disabled:
// Authorization headers are rejected, and /api/v1 answers only to the session cookie.
import http from 'node:http';

export function startFakeCanvas() {
  const log = [];
  const courses = [
    { id: 1, name: 'Data Structures', course_code: 'CS 310', apply_assignment_group_weights: true, term: { name: 'Fall 2026' },
      enrollments: [{ type: 'student', computed_current_score: 78, computed_current_grade: 'C+' }] },
    { id: 2, name: 'Formal Methods', course_code: 'CS 330', hide_final_grades: true, term: { name: 'Fall 2026' },
      enrollments: [{ type: 'student' }] },
    { id: 3, name: 'Linear Algebra', course_code: 'MATH 203', term: { name: 'Fall 2026' },
      enrollments: [{ type: 'student', computed_current_score: 95, computed_current_grade: null }] },
    { id: 4, name: 'Course I TA', course_code: 'CS 112', term: { name: 'Fall 2026' }, enrollments: [{ type: 'ta' }] },
  ];
  const sub = (score) => ({ score, workflow_state: score === null ? 'unsubmitted' : 'graded', missing: false });
  const item = (id, score, points) => ({ id, name: `Item ${id}`, points_possible: points, description: 'MUST NOT BE REQUESTED', submission: sub(score),
    due_at: score === null ? new Date(Date.now() + 3 * 86_400_000).toISOString() : null, html_url: `http://localhost/courses/1/assignments/${id}`, submission_types: ['online_upload'] });
  const groups = {
    // weighted: 90*0.4 + 70*0.6 = 78, matches the reported total -> verified
    1: [{ id: 11, name: 'Homework', group_weight: 40, rules: {}, assignments: [item(101, 90, 100)] },
        { id: 12, name: 'Exams', group_weight: 60, rules: {}, assignments: [item(102, 70, 100), item(103, null, 100)] }],
    // hidden total: 17/20 = 85 -> estimate
    2: [{ id: 21, name: 'Assignments', group_weight: 0, rules: {}, assignments: [item(201, 17, 20)] }],
    // Canvas drops the lowest quiz: 190/200 = 95 -> verified
    3: [{ id: 31, name: 'Quizzes', group_weight: 0, rules: { drop_lowest: 1 }, assignments: [item(301, 100, 100), item(302, 50, 100), item(303, 90, 100)] }],
  };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    log.push({ method: req.method, path: url.pathname, auth: Boolean(req.headers.authorization) });
    const json = (status, body, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
      res.end('while(1);' + JSON.stringify(body));
    };
    if (url.pathname === '/login') {
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'canvas_session=ok; Path=/; HttpOnly; SameSite=Lax' });
      return res.end('<title>Dashboard</title><h1>Fake Canvas</h1>');
    }
    if (url.pathname === '/logout') {
      res.writeHead(200, { 'content-type': 'text/html', 'set-cookie': 'canvas_session=; Path=/; Max-Age=0' });
      return res.end('<title>Signed out</title>');
    }
    if (!url.pathname.startsWith('/api/v1/')) { res.writeHead(404); return res.end(); }
    if (req.method !== 'GET' || req.headers.authorization) return json(401, { errors: [{ message: 'Invalid access token.' }] });
    if (!/canvas_session=ok/.test(req.headers.cookie ?? '')) return json(401, { status: 'unauthenticated' });
    if (url.pathname === '/api/v1/users/self') return json(200, { id: 42, name: 'Test Student' });
    if (url.pathname === '/api/v1/courses') {
      const page = Number(url.searchParams.get('page') ?? 1);
      const base = `http://localhost:${server.address().port}/api/v1/courses?${url.searchParams.toString().replace(/&?page=\d+/, '')}`;
      return page === 1
        ? json(200, courses.slice(0, 2), { link: `<${base}&page=2>; rel="next"` })
        : json(200, courses.slice(2));
    }
    const m = url.pathname.match(/^\/api\/v1\/courses\/(\d+)\/assignment_groups$/);
    if (m && groups[m[1]]) {
      log.at(-1).excludesDescription = url.searchParams.getAll('exclude_response_fields[]').includes('description');
      return json(200, groups[m[1]]);
    }
    return json(404, { errors: [{ message: 'The specified resource does not exist.' }] });
  });
  return new Promise((resolve) => server.listen(0, 'localhost', () =>
    resolve({ origin: `http://localhost:${server.address().port}`, log, close: () => server.close() })));
}
