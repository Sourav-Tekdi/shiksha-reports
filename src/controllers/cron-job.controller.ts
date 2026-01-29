import { Controller, Get, Post, HttpStatus, HttpException } from '@nestjs/common';
import { CronJobService } from '../services/cron-job.service';
import { CronJobStatus } from '../types/cron.types';

@Controller('cron')
export class CronJobController {
  constructor(private readonly cronJobService: CronJobService) {}

  /**
   * Get cron job status
   */
  @Get('status')
  getStatus(): CronJobStatus {
    return this.cronJobService.getJobStatus();
  }

  /**
   * Trigger manual execution of cron job
   */
  @Post('trigger')
  async triggerExecution(): Promise<{ message: string; timestamp: Date }> {
    try {
      await this.cronJobService.triggerManualExecution();
      return {
        message: 'Cron job execution triggered successfully',
        timestamp: new Date(),
      };
    } catch (error) {
      throw new HttpException(
        {
          message: 'Failed to trigger cron job execution',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Trigger manual execution of cohort migration
   */
  @Post('cohort-migration/trigger')
  async triggerCohortMigration(): Promise<{ message: string; timestamp: Date }> {
    try {
      await this.cronJobService.triggerCohortMigration();
      return {
        message: 'Cohort migration executed successfully',
        timestamp: new Date(),
      };
    } catch (error) {
      throw new HttpException(
        {
          message: 'Failed to execute cohort migration',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Trigger manual execution of taxonomy sync
   */
  @Post('taxonomy-sync/trigger')
  async triggerTaxonomySync(): Promise<{ message: string; timestamp: Date }> {
    try {
      await this.cronJobService.triggerTaxonomySync();
      return {
        message: 'Taxonomy sync executed successfully',
        timestamp: new Date(),
      };
    } catch (error) {
      throw new HttpException(
        {
          message: 'Failed to execute taxonomy sync',
          error: error.message,
        },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Health check endpoint
   */
  @Get('health')
  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    details: any;
  }> {
    return this.cronJobService.healthCheck();
  }
}
