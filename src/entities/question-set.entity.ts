import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('QuestionSet')
export class QuestionSet {
  @PrimaryColumn({ name: 'identifier', type: 'varchar', length: 255 })
  identifier: string;

  @Column({ name: 'level1', type: 'text', array: true, nullable: true })
  level1?: string[];

  @Column({ name: 'level2', type: 'text', array: true, nullable: true })
  level2?: string[];

  @Column({ name: 'level3', type: 'text', array: true, nullable: true })
  level3?: string[];

  @Column({ name: 'level4', type: 'text', array: true, nullable: true })
  level4?: string[];

  @Column({ name: 'name', type: 'text', nullable: true })
  name?: string;

  @Column({ name: 'child_nodes', type: 'text', nullable: true })
  childNodes?: string;

  @Column({ name: 'created_on', type: 'timestamp', nullable: true })
  createdOn?: Date;

  @Column({ name: 'program', type: 'text', nullable: true })
  program?: string;

  @Column({ name: 'assessment_type', type: 'varchar', length: 255, nullable: true })
  assessmentType?: string;

  @Column({ name: 'content_language', type: 'varchar', length: 100, nullable: true })
  contentLanguage?: string;

  @Column({ name: 'status', type: 'varchar', length: 100, nullable: true })
  status?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updated_at: Date;
}
