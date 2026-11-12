// A stand-in for Canvas that behaves like a school with tokens disabled:
// Authorization headers are rejected, and /api/v1 answers only to the session cookie.
import http from 'node:http';

export function startFakeCanvas() {
  const log = [];
  const courses = [
    { id: 1, name: 'Data Structures', course_code: 'CS 310', apply_assignment_group_weights: true, term: { name: 'Fall 2026' },
      enrollments: [{ type: 'student', computed_current_score: 91.4, computed_current_grade: 'A-' }] },
    { id: 2, name: 'Formal Methods', course_code: 'CS 330', hide_final_grades: true, term: { name: 'Fall 2026' },
      enrollments: [{ type: 'student' }] },
    { id: 3, name: 'Linear Algebra', course_code: 'MATH 203', term: { name: 'Fall 2026' },
      enrollments: [{ type: 'student', computed_current_score: 78.25, computed_current_grade: null }] },
    { id: 4, name: 'Course I TA', course_code: 'CS 112', term: { name: 'Fall 2026' }, enrollments: [{ type: 'ta' }] },
  ];
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
    return json(404, { errors: [{ message: 'The specified resource does not exist.' }] });
  });
  return new Promise((resolve) => server.listen(0, 'localhost', () =>
    resolve({ origin: `http://localhost:${server.address().port}`, log, close: () => server.close() })));
}
