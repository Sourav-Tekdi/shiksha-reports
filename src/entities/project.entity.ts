// ==========================
// Project.entity.ts
// ==========================
import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity({ name: 'Project' })
export class Project {
  @PrimaryColumn()
  ProjectId: string; // mongo string

  @Column()
  ProjectName: string;

  @Column({ nullable: true })
  Board: string;

  @Column({ nullable: true })
  Medium: string;

  @Column({ nullable: true })
  Subject: string;

  @Column({ nullable: true })
  Grade: string;

  @Column({ nullable: true })
  Type: string;

  @Column({ type: 'date', nullable: true })
  StartDate: Date;

  @Column({ type: 'date', nullable: true })
  EndDate: Date;

  @Column({ type: 'uuid', nullable: true })
  CreatedBy: string;

  @Column({ type: 'uuid', nullable: true })
  TenantId: string;

  @Column({ type: 'uuid', nullable: true })
  AcademicYear: string;
}
