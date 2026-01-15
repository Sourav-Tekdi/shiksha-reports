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


