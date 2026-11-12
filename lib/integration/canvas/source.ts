import type { Course } from '../../core/model';
import type { CourseDataSource } from '../source';
import { CanvasClient } from './client';
import { toCourse, type CanvasCourse } from './mappers';
import type { Transport } from './transport';

export const COURSES_PATH =
  '/api/v1/courses?enrollment_state=active&include[]=total_scores&include[]=term&per_page=50';

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
}
