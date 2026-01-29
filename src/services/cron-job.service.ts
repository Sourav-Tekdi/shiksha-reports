import { Injectable, Logger, OnModuleInit, OnModuleDestroy, ConsoleLogger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../entities/course.entity';
import { QuestionSet } from '../entities/question-set.entity';
import { Content } from '../entities/content.entity';
import { ExternalApiService } from './external-api.service';
import { TransformService } from '../constants/transformation/transform-service';
import { DatabaseService } from './database.service';
import { CronJobStatus, ExternalApiResponse, PrathamContentData } from '../types/cron.types';
import { StructuredLogger } from '../utils/logger';

@Injectable()
export class CronJobService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new StructuredLogger('CronJobService');
  private readonly config: any;
  private jobStatus: CronJobStatus = {
    isRunning: false,
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
  };

  constructor(
    private readonly configService: ConfigService,
    private readonly externalApiService: ExternalApiService,
    private readonly transformService: TransformService,
    private readonly databaseService: DatabaseService,
    @InjectRepository(Course)
    private readonly courseRepo: Repository<Course>,
    @InjectRepository(QuestionSet)
    private readonly questionSetRepo: Repository<QuestionSet>,
    @InjectRepository(Content)
    private readonly contentRepo: Repository<Content>,
  ) {
    this.config = this.configService.get('cron');
  }

  async onModuleInit() {
    this.logger.info('CronJobService initialized', {
      schedule: this.config.schedule,
    });

    // Test external API connection on startup
    const isConnected = await this.externalApiService.testConnection();
    if (!isConnected) {
      this.logger.warn('External API connection test failed on startup');
    }
  }

  async onModuleDestroy() {
    this.logger.info('CronJobService shutting down');
  }

  /**
   * Main cron job method - runs at 12 AM IST (midnight) daily
   */
  @Cron('30 18 * * *') // Runs at 12:00 AM IST (18:30 UTC = 00:00 IST)
  async executeCronJob() {
    if (this.jobStatus.isRunning) {
      this.logger.warn('Cron job is already running, skipping this execution');
      return;
    }

    this.jobStatus.isRunning = true;
    this.jobStatus.lastExecution = new Date();
    this.jobStatus.totalExecutions++;

    try {
      this.logger.info('Starting daily cron job execution', {
        executionNumber: this.jobStatus.totalExecutions,
        timestamp: this.jobStatus.lastExecution,
      });

      // Process Course data
      // await this.processCourseData();

      // Process QuestionSet data
      await this.processQuestionSetData();

      // Process Content data
      // await this.processContentData();

      this.jobStatus.lastSuccess = new Date();
      this.jobStatus.successfulExecutions++;
      this.jobStatus.lastError = undefined;

      this.logger.info('Daily cron job completed successfully', {
        executionNumber: this.jobStatus.totalExecutions,
      });

    } catch (error) {
      this.jobStatus.failedExecutions++;
      this.jobStatus.lastError = error.message;

      this.logger.error('Daily cron job failed', error, {
        executionNumber: this.jobStatus.totalExecutions,
        errorCount: this.jobStatus.failedExecutions,
      });
    } finally {
      this.jobStatus.isRunning = false;
    }
  }

  /**
   * Cohort Migration cron job - runs at 12:05 AM IST daily
   */
  @Cron('35 18 * * *') // Runs at 12:05 AM IST (18:35 UTC = 00:05 IST)
  async executeCohortMigrationJob() {
    const jobName = 'CohortMigration';
    
    if (this.jobStatus.isRunning) {
      this.logger.warn(`${jobName} cron job is already running, skipping this execution`);
      return;
    }

    this.logger.info(`Starting ${jobName} cron job execution`, {
      timestamp: new Date(),
    });

    try {
      await this.migrateCohorts();
      this.logger.info(`${jobName} cron job completed successfully`);
    } catch (error) {
      this.logger.error(`${jobName} cron job failed`, error);
      throw error;
    }
  }

  /**
   * Manual trigger for cohort migration
   */
  async triggerCohortMigration(): Promise<void> {
    this.logger.info('Manually triggered cohort migration');
    return this.migrateCohorts();
  }

  /**
   * Taxonomy Sync cron job - runs at 11:00 PM IST daily
   */
  @Cron('30 17 * * *') // Runs at 11:00 PM IST (17:30 UTC = 23:00 IST)
  async executeTaxonomySyncJob() {
    const jobName = 'TaxonomySync';
    
    if (this.jobStatus.isRunning) {
      this.logger.warn(`${jobName} cron job is already running, skipping this execution`);
      return;
    }

    this.logger.info(`Starting ${jobName} cron job execution`, {
      timestamp: new Date(),
    });

    try {
      await this.syncTaxonomy();
      this.logger.info(`${jobName} cron job completed successfully`);
    } catch (error) {
      this.logger.error(`${jobName} cron job failed`, error);
      throw error;
    }
  }

  /**
   * Manual trigger for taxonomy sync
   */
  async triggerTaxonomySync(): Promise<void> {
    this.logger.info('Manually triggered taxonomy sync');
    return this.syncTaxonomy();
  }

  /**
   * Migrate cohorts from source to destination database
   */
  private async migrateCohorts(): Promise<void> {
    const { Client } = require('pg');
    const dbConfig = require('../../shiksha-migration/db');
    
    this.logger.info('=== STARTING COHORT MIGRATION ===');
    
    const filterDate = new Date().toISOString().split('T')[0]; // Today's date in YYYY-MM-DD format
    this.logger.info(`📅 Filter: Only migrating cohorts created on: ${filterDate}`);
    
    const sourceClient = new Client(dbConfig.source);
    const destClient = new Client(dbConfig.destination);

    try {
      await sourceClient.connect();
      this.logger.info('Connected to source database');
      await destClient.connect();
      this.logger.info('Connected to destination database');

      // Fetch cohorts created today
      const srcQuery = `
        SELECT c."cohortId", c."tenantId", c."name", c."createdAt", c."parentId"
        FROM public."Cohort" c
        WHERE c."createdAt"::date = $1::date
        ORDER BY c."createdAt" ASC
      `;
      
      const result = await sourceClient.query(srcQuery, [filterDate]);
      this.logger.info(`Found ${result.rows.length} cohorts to migrate (created on ${filterDate})`);

      for (const cohort of result.rows) {
        await this.upsertCoreCohort(destClient, cohort);
        await this.upsertCohortFieldValues(sourceClient, destClient, cohort.cohortId);
      }

      this.logger.info('All cohorts processed successfully');
    } catch (err) {
      this.logger.error('Critical error during cohort migration', err);
      throw err;
    } finally {
      await sourceClient.end();
      await destClient.end();
      this.logger.info('Disconnected from databases');
    }
  }

  /**
   * Upsert core cohort record
   */
  private async upsertCoreCohort(destClient: any, cohort: any): Promise<void> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    
    const parentId = (() => {
      const v = cohort.parentId;
      if (!v) return null;
      return uuidRegex.test(String(v)) ? v : null;
    })();

    const insert = `
      INSERT INTO public."Cohort" (
        "CohortID", "TenantID", "CohortName", "CreatedOn", "ParentID"
      ) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT ("CohortID") DO UPDATE SET
        "TenantID" = EXCLUDED."TenantID",
        "CohortName" = EXCLUDED."CohortName",
        "CreatedOn" = EXCLUDED."CreatedOn",
        "ParentID" = EXCLUDED."ParentID"
    `;

    const values = [
      cohort.cohortId,
      cohort.tenantId || null,
      cohort.name || null,
      cohort.createdAt || null,
      parentId,
    ];

    await destClient.query(insert, values);
    this.logger.debug(`Core upsert done for CohortID=${cohort.cohortId}`);
  }

  /**
   * Upsert cohort field values
   */
  private async upsertCohortFieldValues(sourceClient: any, destClient: any, cohortId: string): Promise<void> {
    // Import the cohort migration logic
    const { 
      COHORT_FIELD_ID_TO_COLUMN,
      transformCohortType,
      lookupParentCohortTypeFromSource,
      coerceValueForColumn 
    } = require('../../shiksha-migration/cohort-migration');

    this.logger.debug(`Starting field values migration for cohort: ${cohortId}`);
    
    // Get cohort parent information
    const cohortQuery = `SELECT "parentId" FROM public."Cohort" WHERE "cohortId" = $1`;
    const cohortRes = await sourceClient.query(cohortQuery, [cohortId]);
    const parentId = cohortRes.rows.length > 0 ? cohortRes.rows[0].parentId : null;
    const hasParent = !!parentId;

    this.logger.debug(`Cohort ${cohortId} hasParent: ${hasParent}, parentId: ${parentId}`);

    // Look up parent type
    let parentType = null;
    if (hasParent) {
      parentType = await lookupParentCohortTypeFromSource(sourceClient, parentId);
      this.logger.debug(`Child cohort ${cohortId} has parent ${parentId} with type: ${parentType}`);
    }

    // Fetch field values
    const fvQuery = `
      SELECT fv."fieldId", fv.value
      FROM public."FieldValues" fv
      WHERE fv."itemId" = $1
    `;
    const fvRes = await sourceClient.query(fvQuery, [cohortId]);
    this.logger.debug(`Found ${fvRes.rows.length} field values for cohort ${cohortId}`);
    
    const updates = {};
    let hasTypeField = false;
    
    for (const row of fvRes.rows) {
      const fieldId = row.fieldId;
      const columnName = COHORT_FIELD_ID_TO_COLUMN[fieldId];
      if (!columnName) continue;

      let coerced = coerceValueForColumn(row.value, columnName, fieldId);
      
      if (columnName === 'Type') {
        hasTypeField = true;
        const originalValue = coerced;
        coerced = transformCohortType(coerced, hasParent, parentType);
        this.logger.debug(`Type transformation for cohort ${cohortId}: ${originalValue} -> ${coerced}`);
      }
      
      updates[columnName] = coerced;
    }

    // Apply batch type if no Type field was found but we have parent type
    if (hasParent && !hasTypeField && parentType) {
      const batchType = transformCohortType('', hasParent, parentType);
      if (batchType && batchType !== '') {
        updates['Type'] = batchType;
        this.logger.debug(`Applying batch type for cohort ${cohortId}: ${batchType}`);
      }
    }

    if (Object.keys(updates).length === 0) {
      this.logger.debug(`No updates to apply for cohort ${cohortId}`);
      return;
    }

    // Build dynamic UPDATE
    const setFragments: string[] = [];
    const params: any[] = [cohortId];
    let idx = 2;
    for (const [col, val] of Object.entries(updates)) {
      setFragments.push(`"${col}" = $${idx}`);
      params.push(val);
      idx += 1;
    }

    const updateSql = `
      UPDATE public."Cohort"
      SET ${setFragments.join(', ')}
      WHERE "CohortID" = $1
    `;

    await destClient.query(updateSql, params);
    this.logger.debug(`Field values updated for CohortID=${cohortId}`);
  }

  /**
   * Sync taxonomy from API to database with intersection logic
   * Processes multiple frameworks sequentially
   */
  private async syncTaxonomy(): Promise<void> {
    const axios = require('axios');
    const path = require('path');
    const fs = require('fs');
    const { Client } = require('pg');
    const dbConfig = require('../../shiksha-migration/db');
    
    const FRAMEWORKS = ['scp-framework', 'pos-framework', 'pragyanpath-framework'];
    
    this.logger.info('🚀 STARTING MULTI-FRAMEWORK TAXONOMY SYNC', { 
      frameworks: FRAMEWORKS,
      totalFrameworks: FRAMEWORKS.length 
    });

    const overallResults = {
      totalFrameworks: FRAMEWORKS.length,
      successfulFrameworks: 0,
      failedFrameworks: 0,
      frameworkResults: [] as any[]
    };

    for (let i = 0; i < FRAMEWORKS.length; i++) {
      const FRAMEWORK_NAME = FRAMEWORKS[i];
      
      try {
        this.logger.info(`\n${'='.repeat(80)}`);
        this.logger.info(`📦 Processing Framework ${i + 1}/${FRAMEWORKS.length}: ${FRAMEWORK_NAME}`);
        this.logger.info('='.repeat(80));

        const result = await this.syncSingleFramework(FRAMEWORK_NAME, axios, path, fs, dbConfig);
        
        overallResults.successfulFrameworks++;
        overallResults.frameworkResults.push({
          framework: FRAMEWORK_NAME,
          status: 'success',
          ...result
        });

        this.logger.info(`✅ Framework ${FRAMEWORK_NAME} completed successfully!\n`);

      } catch (error) {
        overallResults.failedFrameworks++;
        overallResults.frameworkResults.push({
          framework: FRAMEWORK_NAME,
          status: 'failed',
          error: error.message
        });

        this.logger.error(`❌ Framework ${FRAMEWORK_NAME} failed`, error);
        // Continue with next framework instead of stopping
      }
    }

    // Final summary
    this.logger.info('\n' + '='.repeat(80));
    this.logger.info('🎯 OVERALL TAXONOMY SYNC SUMMARY');
    this.logger.info('='.repeat(80));
    this.logger.info(`Total Frameworks: ${overallResults.totalFrameworks}`);
    this.logger.info(`Successful: ${overallResults.successfulFrameworks}`);
    this.logger.info(`Failed: ${overallResults.failedFrameworks}`);
    
    for (const result of overallResults.frameworkResults) {
      if (result.status === 'success') {
        this.logger.info(`\n✓ ${result.framework}:`, {
          expected: result.expected,
          existing: result.existing,
          matched: result.matched,
          toInsert: result.toInsert,
          toDelete: result.toDelete
        });
      } else {
        this.logger.error(`\n✗ ${result.framework}: ${result.error}`);
      }
    }
    
    this.logger.info('='.repeat(80));

    if (overallResults.failedFrameworks > 0) {
      throw new Error(`Taxonomy sync completed with ${overallResults.failedFrameworks} failed framework(s)`);
    }
  }

  /**
   * Sync a single framework's taxonomy data
   */
  private async syncSingleFramework(
    FRAMEWORK_NAME: string,
    axios: any,
    path: any,
    fs: any,
    dbConfig: any
  ): Promise<any> {
    const { Client } = require('pg');
    const API_URL = `https://lap.prathamdigital.org/api/framework/v1/read/${FRAMEWORK_NAME}?categories=board,gradeLevel,subject,medium`;
    
    // Helper functions
    const findByIdentifier = (items: any[], identifier: string) => {
      return items.find((item: any) => item.identifier === identifier);
    };
    
    const escapeSql = (str: any): string => {
      if (!str) return '';
      return str.toString().replace(/'/g, "''");
    };

    const destClient = new Client(dbConfig.destination);
    
    try {
      // Fetch from API
      this.logger.info('📡 Fetching data from API...');
      const response = await axios.get(API_URL);
      const categories = response.data.result.framework.categories;

      const boards = categories.find((c: any) => c.code === 'board')?.terms || [];
      const mediums = categories.find((c: any) => c.code === 'medium')?.terms || [];
      const grades = categories.find((c: any) => c.code === 'gradeLevel')?.terms || [];
      const subjects = categories.find((c: any) => c.code === 'subject')?.terms || [];

      this.logger.info(`✓ Fetched: ${boards.length} boards, ${mediums.length} mediums, ${grades.length} grades, ${subjects.length} subjects`);

      // Connect to DB
      await destClient.connect();
      this.logger.info('✓ Connected to database');

      // Fetch existing records
      const result = await destClient.query(
        `SELECT id, level1, level2, level3, level4, status FROM taxonomy WHERE taxonomyid = $1`, 
        [FRAMEWORK_NAME]
      );
      const existingRecords = result.rows;
      const existingMap = new Map();
      for (const r of existingRecords) {
        existingMap.set(`${r.level1}|${r.level2}|${r.level3}|${r.level4}`, r);
      }

      this.logger.info(`Found ${existingRecords.length} existing records in database`);

      // Generate expected records with INTERSECTION logic
      const expectedRecords: any[] = [];
      const expectedKeys = new Set<string>();

      for (const board of boards) {
        if (board.status === 'Retired') continue;
        
        const boardAssocs = Array.isArray(board.associations) ? board.associations : [];
        const boardMediums = boardAssocs.filter((a: any) => a?.category === 'medium' && a.status === 'Live');
        const boardSubjects = boardAssocs.filter((a: any) => a?.category === 'subject' && a.status === 'Live');

        this.logger.debug(`📋 ${board.name}: ${boardMediums.length} mediums, ${boardSubjects.length} subjects`);

        for (const boardMedium of boardMediums) {
          const medium = findByIdentifier(mediums, boardMedium.identifier);
          if (!medium || medium.status === 'Retired') continue;

          const mediumAssocs = Array.isArray(medium.associations) ? medium.associations : [];
          const mediumSubjects = mediumAssocs.filter((a: any) => a?.category === 'subject' && a.status === 'Live');

          // INTERSECTION: Board ∩ Medium
          const matchedSubjects = mediumSubjects.filter((ms: any) => 
            boardSubjects.some((bs: any) => bs.identifier === ms.identifier)
          );

          this.logger.debug(`  ${medium.name}: ${matchedSubjects.length} matched subjects`);

          for (const grade of grades) {
            if (grade.status === 'Retired') continue;

            const gradeAssocs = Array.isArray(grade.associations) ? grade.associations : [];
            const gradeSubjects = gradeAssocs.filter((a: any) => a?.category === 'subject' && a.status === 'Live');

            // FINAL INTERSECTION: (Board ∩ Medium) ∩ Grade
            const finalSubjects = matchedSubjects.filter((ms: any) => 
              gradeSubjects.some((gs: any) => gs.identifier === ms.identifier)
            );

            for (const subjectAssoc of finalSubjects) {
              const subject = findByIdentifier(subjects, subjectAssoc.identifier);
              if (!subject || subject.status === 'Retired') continue;

              expectedRecords.push({
                level1: grade.name,
                level2: board.name,
                level3: medium.name,
                level4: subject.name,
                status: subject.status
              });

              expectedKeys.add(`${grade.name}|${board.name}|${medium.name}|${subject.name}`);
            }
          }
        }
      }

      this.logger.info(`✓ Generated ${expectedRecords.length} expected records`);

      // Compare and generate SQL statements
      const insertStatements: any[] = [];
      const deleteStatements: any[] = [];
      let matchedCount = 0;

      for (const exp of expectedRecords) {
        const key = `${exp.level1}|${exp.level2}|${exp.level3}|${exp.level4}`;
        if (!existingMap.has(key)) {
          const name = `${exp.level2} - ${exp.level1} - ${exp.level3} - ${exp.level4}`;
          const sql = `INSERT INTO taxonomy (taxonomyid, taxonomy_name, taxonomy_description, level1, level2, level3, level4, level5, status) VALUES ('${FRAMEWORK_NAME}', '${escapeSql(name)}', '${escapeSql(name)}', '${escapeSql(exp.level1)}', '${escapeSql(exp.level2)}', '${escapeSql(exp.level3)}', '${escapeSql(exp.level4)}', NULL, '${exp.status}');`;
          insertStatements.push({ sql, ...exp });
          this.logger.debug(`➕ To Insert: ${exp.level2} > ${exp.level3} > ${exp.level1} > ${exp.level4}`);
        } else {
          matchedCount++;
        }
      }

      for (const [key, record] of existingMap) {
        if (!expectedKeys.has(key)) {
          const sql = `DELETE FROM taxonomy WHERE id = ${record.id};`;
          deleteStatements.push({ sql, ...record });
          this.logger.debug(`🗑️  To Delete: ${record.level2} > ${record.level3} > ${record.level1} > ${record.level4}`);
        }
      }

      // Save SQL files
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputDir = path.join(__dirname, '../../shiksha-migration/taxonomy-scripts');
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      if (insertStatements.length > 0) {
        let content = `-- INSERT for ${FRAMEWORK_NAME}\n-- ${insertStatements.length} records\n-- Generated at ${new Date().toISOString()}\n\n`;
        insertStatements.forEach((s: any) => { content += s.sql + '\n'; });
        const filename = `taxonomy-insert-${FRAMEWORK_NAME}-${timestamp}.sql`;
        fs.writeFileSync(path.join(outputDir, filename), content);
        this.logger.info(`✓ INSERT script saved: ${filename} (${insertStatements.length} records)`);
      }

      if (deleteStatements.length > 0) {
        let content = `-- DELETE for ${FRAMEWORK_NAME}\n-- ${deleteStatements.length} records\n-- Generated at ${new Date().toISOString()}\n\n`;
        deleteStatements.forEach((s: any) => { content += s.sql + '\n'; });
        const filename = `taxonomy-delete-${FRAMEWORK_NAME}-${timestamp}.sql`;
        fs.writeFileSync(path.join(outputDir, filename), content);
        this.logger.info(`✓ DELETE script saved: ${filename} (${deleteStatements.length} records)`);
      }

      const summary = {
        expected: expectedRecords.length,
        existing: existingRecords.length,
        matched: matchedCount,
        toInsert: insertStatements.length,
        toDelete: deleteStatements.length
      };

      this.logger.info('-'.repeat(60));
      this.logger.info(`${FRAMEWORK_NAME} Summary:`, summary);
      this.logger.info('-'.repeat(60));

      return summary;

    } catch (error) {
      this.logger.error(`❌ Failed to sync framework ${FRAMEWORK_NAME}`, error);
      throw error;
    } finally {
      await destClient.end();
    }
  }

  /**
   * Process course data from Pratham Digital API
   */
  private async processCourseData(): Promise<{
    totalProcessed: number;
    duration: number;
  }> {
    const startTime = Date.now();
    let totalProcessed = 0;

    try {
      this.logger.info('Fetching course data from Pratham Digital API');

      // Fetch data from external API
      const apiResponse = await this.externalApiService.fetchCourseData();
      if (!apiResponse.success || !apiResponse.data || apiResponse.data.length === 0) {
        this.logger.info('No course data available from Pratham Digital API', {
          success: apiResponse.success,
          dataLength: apiResponse.data?.length || 0,
        });
        return { totalProcessed: 0, duration: Date.now() - startTime };
      }

      this.logger.info(`Processing ${apiResponse.data.length} courses`);

      // Transform and save each course individually
      for (const courseData of apiResponse.data) {
        try {
          const transformedCourse = await this.transformService.transformExternalCourseData(courseData);

          // Enrich with hierarchy (level arrays + childnodes)
          const hierarchy = await this.externalApiService.getCourseHierarchy(courseData.identifier);
          if (hierarchy) {
            const levels = this.externalApiService.mapCourseLevelsByChannel(hierarchy);
            (transformedCourse as any).level1 = levels.level1 || null;
            (transformedCourse as any).level2 = levels.level2 || null;
            (transformedCourse as any).level3 = levels.level3 || null;
            (transformedCourse as any).level4 = levels.level4 || null;
            (transformedCourse as any).childnodes = hierarchy.children ? JSON.stringify(hierarchy.children) : (transformedCourse as any).childnodes || null;
          }

          await this.saveCourseData(transformedCourse);
          totalProcessed++;
        } catch (error) {
          this.logger.error('Failed to process course data', error, {
            identifier: courseData.identifier,
          });
        }
      }

      this.logger.info(`Successfully processed ${totalProcessed} courses`);

    } catch (error) {
      this.logger.error('Failed to process course data', error);
      throw error;
    }

    const duration = Date.now() - startTime;
    return { totalProcessed, duration };
  }

  // Build flat rows for QuestionSet hierarchy:
  // Output: Array of rows with exact keys:
  // - "section Index Number"
  // - "Section ID"
  // - "Section name"
  // - "Question Index Number"
  // - "Question DO_ID"
  // - "Question Name"
  // - "Question Type"
  // Each row represents one Question under its nearest Section.
  // Missing values are represented as empty string "".
  private buildCompactQuestionSetChildren(root: any): any[] {
    const ensureString = (v: any): string => (v === undefined || v === null ? '' : String(v));
    const ensureIndex = (v: any): number | string => (v === undefined || v === null ? '' : v);
    const stripHtml = (s: any): string => {
      const text = ensureString(s);
      return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
    };
    const extractQuestionTitle = (node: any, sectionName: string): string => {
      // Prefer editorState.question/body when available, then title/name fallbacks
      const candidates = [
        node?.editorState?.question,
        node?.editorState?.body,
        node?.body,
        node?.title,
        node?.metadata?.name,
        node?.name, // last fallback
      ];
      for (const c of candidates) {
        const cleaned = stripHtml(c);
        if (cleaned && cleaned.length > 0 && cleaned !== sectionName) {
          return cleaned;
        }
      }
      return '';
    };

    const rows: any[] = [];

    type SectionCtx = {
      sectionIndex: number | string;
      sectionId: string;
      sectionName: string;
    } | null;

    const visit = (node: any, ctx: SectionCtx) => {
      if (!node || typeof node !== 'object') return;

      if (node.objectType === 'QuestionSet') {
        const newCtx: SectionCtx = {
          sectionIndex: ensureIndex((node as any).index),
          sectionId: ensureString(node.identifier),
          sectionName: ensureString(node.name),
        };
        if (Array.isArray(node.children)) {
          for (const child of node.children) {
            visit(child, newCtx);
          }
        }
        return;
      }

      if (node.objectType === 'Question') {
        const sectionName = ctx ? ctx.sectionName : '';
        rows.push({
          'section Index Number': ctx ? ctx.sectionIndex : '',
          'Section do_id': ctx ? ctx.sectionId : '',
          'Section name': ctx ? ctx.sectionName : '',
          'Question Index Number': ensureIndex((node as any).index),
          'Question do_id': ensureString(node.identifier),
          'Question Name': extractQuestionTitle(node, sectionName),
          'Question Type': ensureString((node as any).qType),
        });
        return;
      }

      if (Array.isArray(node.children)) {
        for (const child of node.children) {
          visit(child, ctx);
        }
      }
    };

    visit(root, null);
    return rows;
  }

  /**
   * Process question set data from Pratham Digital API (for future use)
   */
  private async processQuestionSetData() {
    const startTime = Date.now();
    let totalProcessed = 0;

    try {
      this.logger.info('Fetching question set data from Pratham Digital API');

      // Fetch data from external API
      const apiResponse = await this.externalApiService.fetchQuestionSetData();

      if (!apiResponse.success || !apiResponse.data || apiResponse.data.length === 0) {
        this.logger.info('No question set data available from Pratham Digital API', {
          success: apiResponse.success,
          dataLength: apiResponse.data?.length || 0,
        });
        return { totalProcessed: 0, duration: Date.now() - startTime };
      }

      this.logger.info(`Processing ${apiResponse.data.length} question sets`);

      // Transform and save each question set individually
      for (const questionSetData of apiResponse.data) {
        try {
          const transformedQuestionSet = await this.transformService.transformQuestionSetData(questionSetData);
          this.logger.debug(`QuestionSet ${questionSetData.identifier} status: ${transformedQuestionSet.status}`);

          // Enrich with hierarchy (level arrays + child_nodes)
          const qs = await this.externalApiService.getQuestionSetHierarchy(questionSetData.identifier);
          if (qs) {
            const levels = this.externalApiService.mapQuestionSetLevelsByFramework(qs);
            (transformedQuestionSet as any).level1 = levels.level1 || null;
            (transformedQuestionSet as any).level2 = levels.level2 || null;
            (transformedQuestionSet as any).level3 = levels.level3 || null;
            (transformedQuestionSet as any).level4 = levels.level4 || null;
            // Build compact childNodes JSON: sections with minimal fields and their questions
            const compact = this.buildCompactQuestionSetChildren(qs);
            (transformedQuestionSet as any).childNodes = compact.length > 0 ? JSON.stringify(compact) : (transformedQuestionSet as any).childNodes || null;
          }
          console.log(transformedQuestionSet);
          await this.saveQuestionSetData(transformedQuestionSet);
          totalProcessed++;
        } catch (error) {
          this.logger.error('Failed to process question set data', error, {
            identifier: questionSetData.identifier,
          });
        }
      }

      this.logger.info(`Successfully processed ${totalProcessed} question sets`);

    } catch (error) {
      this.logger.error('Failed to process question set data', error);
      throw error;
    }

    const duration = Date.now() - startTime;
    return { totalProcessed, duration };
  }

  /**
   * Process content data from Pratham Digital API
   */
  private async processContentData(): Promise<{
    totalProcessed: number;
    duration: number;
  }> {
    const startTime = Date.now();
    let totalProcessed = 0;

    try {
      this.logger.info('Fetching content data from Pratham Digital API');

      // Fetch data from external API
      const apiResponse = await this.externalApiService.fetchContentData();

      if (!apiResponse.success || !apiResponse.data || apiResponse.data.length === 0) {
        this.logger.info('No content data available from Pratham Digital API', {
          success: apiResponse.success,
          dataLength: apiResponse.data?.length || 0,
        });
        return { totalProcessed: 0, duration: Date.now() - startTime };
      }

      this.logger.info(`Processing ${apiResponse.data.length} content items`);

      // Transform and save each content item individually
      for (const contentData of apiResponse.data) {
        try {
          const transformedContent = await this.transformService.transformContentData(contentData);
          await this.saveContentData(transformedContent);
          totalProcessed++;
        } catch (error) {
          this.logger.error('Failed to process content data', error, {
            identifier: contentData.identifier,
          });
        }
      }

      this.logger.info(`Successfully processed ${totalProcessed} content items`);

    } catch (error) {
      this.logger.error('Failed to process content data', error);
      throw error;
    }

    const duration = Date.now() - startTime;
    return { totalProcessed, duration };
  }

  /**
   * Save course data to database
   */
  private async saveCourseData(courseData: Partial<Course>): Promise<void> {
    try {
      // Check if course already exists
      const existingCourse = await this.courseRepo.findOne({
        where: { identifier: courseData.identifier }
      });

      if (existingCourse) {
        // Update existing course
        await this.courseRepo.update(
          { identifier: courseData.identifier },
          {
            ...courseData,
            updated_at: new Date(),
          }
        );
        this.logger.debug('Updated existing course', { identifier: courseData.identifier });
      } else {
        // Create new course
        await this.courseRepo.save(courseData);
        this.logger.debug('Created new course', { identifier: courseData.identifier });
      }
    } catch (error) {
      this.logger.error('Failed to save course data', error, {
        identifier: courseData.identifier,
      });
      throw error;
    }
  }

  /**
   * Save question set data to database (for future use)
   */
  private async saveQuestionSetData(questionSetData: Partial<QuestionSet>): Promise<void> {
    try {
      // Check if question set already exists
      const existingQuestionSet = await this.questionSetRepo.findOne({
        where: { identifier: questionSetData.identifier }
      });

      if (existingQuestionSet) {
        // Update existing question set
        await this.questionSetRepo.update(
          { identifier: questionSetData.identifier },
          {
            ...questionSetData,
            updated_at: new Date(),
          }
        );
        this.logger.debug('Updated existing question set', { identifier: questionSetData.identifier });
      } else {
        // Create new question set
        await this.questionSetRepo.save(questionSetData);
        this.logger.debug('Created new question set', { identifier: questionSetData.identifier });
      }
    } catch (error) {
      this.logger.error('Failed to save question set data', error, {
        identifier: questionSetData.identifier,
      });
      throw error;
    }
  }

  /**
   * Save content data to database
   */
  private async saveContentData(contentData: Partial<Content>): Promise<void> {
    try {
      // Check if content already exists
      const existingContent = await this.contentRepo.findOne({
        where: { identifier: contentData.identifier }
      });

      if (existingContent) {
        // Update existing content
        await this.contentRepo.update(
          { identifier: contentData.identifier },
          {
            ...contentData,
            updated_at: new Date(),
          }
        );
        this.logger.debug('Updated existing content', { identifier: contentData.identifier });
      } else {
        // Create new content
        await this.contentRepo.save(contentData);
        this.logger.debug('Created new content', { identifier: contentData.identifier });
      }
    } catch (error) {
      this.logger.error('Failed to save content data', error, {
        identifier: contentData.identifier,
      });
      throw error;
    }
  }

  /**
   * Get current job status
   */
  getJobStatus(): CronJobStatus {
    return { ...this.jobStatus };
  }

  /**
   * Manually trigger the cron job
   */
  async triggerManualExecution(): Promise<void> {
    this.logger.info('Manual cron job execution triggered');
    await this.executeCronJob();
  }

  /**
   * Health check method
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    details: any;
  }> {
    try {
      const apiConnected = await this.externalApiService.testConnection();
      
      return {
        status: apiConnected ? 'healthy' : 'unhealthy',
        details: {
          apiConnected,
          jobStatus: this.jobStatus,
          lastExecution: this.jobStatus.lastExecution,
          lastSuccess: this.jobStatus.lastSuccess,
          lastError: this.jobStatus.lastError,
        },
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        details: {
          error: error.message,
          jobStatus: this.jobStatus,
        },
      };
    }
  }
}


