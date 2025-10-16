import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { DatabaseService } from '../services/database.service';
import { TransformService } from 'src/constants/transformation/transform-service';
import {
  AssessmentTrackingData,
  validateRequired,
  validateString,
  ValidationError,
} from '../types';

@Injectable()
export class AssessmentHandler {
  constructor(
    private readonly dbService: DatabaseService,
    private readonly transformService: TransformService,
  ) { }

  async handleAssessmentUpsert(data: AssessmentTrackingData) {
    try {
      // Validate required fields
      validateString(data.assessmentTrackingId, 'assessmentTrackingId');
      validateString(data.userId, 'userId');
      validateString(data.tenantId, 'tenantId');

      const identifier = data?.courseId || data?.contentId; // Adjust key if it's nested elsewhere
      if (!identifier) {
        throw new Error('Identifier is required for API call');
      }

      // ==================== OLD CODE (COMMENTED OUT) ====================
      // const baseUrl = process.env.MIDDLEWARE_SERVICE_BASE_URL;
      // if (!baseUrl) {
      //   throw new Error('MIDDLEWARE_SERVICE_BASE_URL not configured');
      // }

      // const url = new URL('action/composite/v3/search', baseUrl);

      // const payload = {
      //   request: {
      //     filters: {
      //       identifier: [identifier],
      //     },
      //   },
      // };

      // const apiResponse = await axios.post(
      //   url.toString(),
      //   payload,
      //   {
      //     timeout: 10000, // 10 second timeout
      //     headers: {
      //       'Content-Type': 'application/json',
      //     },
      //   }
      // );

      // let externalData;
      // if ((apiResponse.data as any)?.result?.QuestionSet?.[0]) {
      //   externalData = (apiResponse.data as any)?.result?.QuestionSet?.[0];
      // } else if ((apiResponse.data as any)?.result?.content?.[0]) {
      //   externalData = apiResponse.data?.result?.content?.[0];
      // } else {
      //   throw new Error('Invalid API response structure or empty QuestionSet');
      // }
      // ==================== END OLD CODE ====================

      // ==================== NEW CODE (ACTIVE) ====================
      const baseUrl = process.env.COURSE_HIERARCHY_API_URL;
      if (!baseUrl) {
        throw new Error('COURSE_HIERARCHY_API_URL not configured');
      }

      // Construct URL: baseUrl + identifier
      const url = `${baseUrl}api/course/v1/hierarchy/${identifier}?mode=edit`;
      console.log(`[AssessmentHandler] Fetching course hierarchy from: ${url}`);

      const apiResponse = await axios.get(
        url,
        {
          timeout: 10000, // 10 second timeout
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
          },
        }
      );

      // Extract data from the new API response structure
      let externalData;
      if (apiResponse.data?.result?.content) {
        externalData = apiResponse.data.result.content;
      } else {
        throw new Error('Invalid API response structure or empty content');
      }
      // ==================== END NEW CODE ====================

      const enrichedData = {
        ...data,
        // Add metadata from API with safe access
        assessmentName: externalData?.name || null,
        description: externalData?.description || null,
        subject: Array.isArray(externalData?.subject)
          ? externalData.subject[0]
          : externalData?.subject || null,
        domain: externalData?.domain || null,
        subDomain: Array.isArray(externalData?.subDomain)
          ? externalData.subDomain[0]
          : externalData?.subDomain || null,
        channel: externalData?.channel || null,
        assessmentType: externalData?.assessmentType || '-',
        program: Array.isArray(externalData?.program)
          ? externalData.program[0]
          : externalData?.program || null,
        targetAgeGroup: Array.isArray(externalData?.targetAgeGroup)
          ? externalData.targetAgeGroup[0]
          : externalData?.targetAgeGroup || null,
        contentLanguage: Array.isArray(externalData?.contentLanguage)
          ? externalData.contentLanguage[0]
          : externalData?.contentLanguage || null,
        status: externalData?.status || null,
        framework: externalData?.framework || null,
        summaryType: externalData?.summaryType || null,
      };

      // Step 2: Transform data using new AssessmentTracker structure
      const { assessmentData, scoreDetails } =
        await this.transformService.transformAssessmentTrackerData(
          enrichedData,
        );

      // Step 3: Save assessment tracker data
      await this.dbService.upsertAssessmentTracker(assessmentData);
    } catch (error) {
      if (error instanceof ValidationError) {
        console.error(
          'Validation failed in handleAssessmentUpsert:',
          error.message,
        );
        throw new Error(`Validation failed: ${error.message}`);
      }
      console.error('Error handling assessment upsert:', error);
      throw error;
    }
  }

  async handleAssessmentDelete(data: { assessmentTrackingId: string }) {
    try {
      validateString(data.assessmentTrackingId, 'assessmentTrackingId');
      return this.dbService.deleteAssessmentTrackerData(data);
    } catch (error) {
      if (error instanceof ValidationError) {
        throw new Error(`Validation failed: ${error.message}`);
      }
      throw error;
    }
  }
}
