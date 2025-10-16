import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../services/database.service';
import { TransformService } from 'src/constants/transformation/transform-service';

@Injectable()
export class CohortHandler {
  constructor(
    private readonly dbService: DatabaseService,
    private transformService: TransformService,
  ) {}

  async handleCohortUpsert(data: any) {
    try {
      console.log(`[CohortHandler] Processing COHORT_UPDATED/CREATED for cohortId: ${data.cohortId}`);
      console.log(`[CohortHandler] Incoming status: ${data.status}`);
      
      const transformedData = await this.transformService.transformCohortData(data);
      
      console.log(`[CohortHandler] Transformed status: ${transformedData.status}`);
      
      // Use upsertCohortData which properly handles updates
      const result = await this.dbService.upsertCohortData(transformedData);
      
      console.log(`[CohortHandler] Cohort ${result.action}: ${result.cohortId}`);
      return result;
    } catch (error) {
      console.error('Error handling cohort upsert:', error);
      throw error;
    }
  }

  async handleCohortDelete(data: any) {
    try {
      return this.dbService.deleteCohortData(data);
    } catch (error) {
      console.error('Error handling cohort delete:', error);
      throw error;
    }
  }

  async handleCohortUpdate(data: any) {
    try {
      console.log(`[CohortHandler] Processing COHORT_UPDATE for cohortId: ${data.cohortId}`);
      console.log(`[CohortHandler] Incoming status: ${data.status}`);
      
      const transformedData = await this.transformService.transformCohortData(data);
      
      console.log(`[CohortHandler] Transformed status: ${transformedData.status}`);
      
      // Use upsertCohortData which properly handles updates
      const result = await this.dbService.upsertCohortData(transformedData);
      
      console.log(`[CohortHandler] Cohort ${result.action}: ${result.cohortId}`);
      return result;
    } catch (error) {
      console.error('Error handling cohort update:', error);
      throw error;
    }
  }
} 