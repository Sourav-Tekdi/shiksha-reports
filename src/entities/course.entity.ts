import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'Course' })
export class Course {
  @PrimaryColumn({ name: 'identifier', type: 'varchar', length: 255 })
  identifier: string;

  @Column({ name: 'name', type: 'text', nullable: true })
  name?: string;

  @Column({ name: 'author', type: 'varchar', length: 255, nullable: true })
  author?: string;

  @Column({ name: 'primaryuser', type: 'varchar', length: 255, nullable: true })
  primaryuser?: string;

  @Column({ name: 'se_domains', type: 'text', nullable: true })
  se_domains?: string;

  @Column({ name: 'contentlanguage', type: 'varchar', length: 100, nullable: true })
  contentlanguage?: string;

  @Column({ name: 'status', type: 'varchar', length: 100, nullable: true })
  status?: string;

  @Column({ name: 'targetagegroup', type: 'varchar', length: 100, nullable: true })
  targetagegroup?: string;

  @Column({ name: 'se_subdomains', type: 'text', nullable: true })
  se_subdomains?: string;

  @Column({ name: 'childnodes', type: 'text', nullable: true })
  childnodes?: string;

  @Column({ name: 'keywords', type: 'text', nullable: true })
  keywords?: string;

  @Column({ name: 'channel', type: 'varchar', length: 255, nullable: true })
  channel?: string;

  @Column({ name: 'lastpublishedon', type: 'timestamp', nullable: true })
  lastpublishedon?: Date;

  @Column({ name: 'createdby', type: 'varchar', length: 255, nullable: true })
  createdby?: string;

  @Column({ name: 'program', type: 'varchar', length: 255, nullable: true })
  program?: string;

  @Column({ name: 'audience', type: 'varchar', length: 255, nullable: true })
  audience?: string;

  @Column({ name: 'se_subjects', type: 'text', nullable: true })
  se_subjects?: string;

  @Column({ name: 'description', type: 'text', nullable: true })
  description?: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  created_at: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  updated_at: Date;
}
