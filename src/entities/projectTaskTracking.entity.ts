// ==========================
// ProjectTaskTracking.entity.ts
// ==========================
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity({ name: 'ProjectTaskTracking' })
export class ProjectTaskTracking {
  @PrimaryColumn()
  ProjectTaskTrackingId: string;

  @Column()
  ProjectId: string;

  @Column()
  ProjectTaskId: string;

  @Column({ type: 'uuid', nullable: true })
  CohortId: string;


  @Column({ type: 'uuid', nullable: true })
  CreatedBy: string;

  @Column({ type: 'uuid', nullable: true })
  UpdatedBy: string;

  @Column({ type: 'timestamp', default: () => 'now()' })
  CreatedAt: Date;

  @Column({ type: 'timestamp', default: () => 'now()' })
  UpdatedAt: Date;
}
