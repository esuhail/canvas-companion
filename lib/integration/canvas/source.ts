import type { Course, Gradebook } from '../../core/model';
import type { CourseDataSource } from '../source';
import { CanvasClient } from './client';
import { toCourse, toGroup, type CanvasAssignmentGroup, type CanvasCourse } from './mappers';
import type { Transport } from './transport';

export const COURSES_PATH =
  '/api/v1/courses?enrollment_state=active&include[]=total_scores&include[]=term&per_page=50';

/** Descriptions and rubrics are excluded: we never need assignment content, only scores. */
export const gradebookPath = (courseId: string) =>
  `/api/v1/courses/${encodeURIComponent(courseId)}/assignment_groups?include[]=assignments&include[]=submission` +
  '&exclude_response_fields[]=description&exclude_response_fields[]=rubric&per_page=50';

export class CanvasSessionSource implements CourseDataSource {
  readonly live = true;
  readonly label: string;
  private readonly client: CanvasClient;

  constructor(origin: string, transport: Transport) {
    this.client = new CanvasClient(origin, transport);
    this.label = new URL(origin).host;
  }

  async listCourses(): Promise<Course[]> {
    const raw = await this.client.getAll<CanvasCourse>(COURSES_PATH);
    return raw.map(toCourse).filter((c): c is Course => c !== null);
  }

  async getGradebook(course: Course): Promise<Gradebook> {
    const raw = await this.client.getAll<CanvasAssignmentGroup>(gradebookPath(course.id));
    return { weighted: course.weighted, groups: raw.map(toGroup) };
  }
}
