import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('QuestionSet')
export class QuestionSet {
  @PrimaryColumn({ name: 'identifier', type: 'varchar', length: 255 })
  identifier: string;

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

  @Column({ name: 'domain', type: 'text', nullable: true })
  domain?: string;

  @Column({ name: 'sub_domain', type: 'text', nullable: true })
  subDomain?: string;

  @Column({ name: 'subject', type: 'text', nullable: true })
  subject?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updated_at: Date;
}
