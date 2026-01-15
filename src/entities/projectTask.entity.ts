// ==========================
// ProjectTask.entity.ts
// ==========================
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity({ name: 'ProjectTask' })
export class ProjectTask {
  @PrimaryColumn()
  ProjectTaskId: string;

  @Column()
  ProjectId: string;

  @Column()
  TaskName: string;

  @Column({ nullable: true })
  ParentId: string;

  @Column({ type: 'date', nullable: true })
  StartDate: Date;

  @Column({ type: 'date', nullable: true })
  EndDate: Date;

  @Column({ type: 'jsonb', nullable: true })
  LearningResource: any;

  @Column({ type: 'uuid', nullable: true })
  CreatedBy: string;

  @Column({ type: 'uuid', nullable: true })
  UpdatedBy: string;

  @Column({ type: 'timestamp', default: () => 'now()' })
  CreatedAt: Date;

  @Column({ type: 'timestamp', default: () => 'now()' })
  UpdatedAt: Date;
}
