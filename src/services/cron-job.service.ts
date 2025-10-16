import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Course } from '../entities/course.entity';
import { QuestionSet } from '../entities/question-set.entity';
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
      await this.processCourseData();
      
      // Process QuestionSet data
      await this.processQuestionSetData();

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

  /**
   * Process question set data from Pratham Digital API (for future use)
   */
  private async processQuestionSetData(): Promise<{
    totalProcessed: number;
    duration: number;
  }> {
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
