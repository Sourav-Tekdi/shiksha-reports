import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { 
  ExternalCourseData, 
  ExternalQuestionSetData,
  ExternalApiResponse,
  ExternalCourseApiResponse,
  ExternalQuestionSetApiResponse,
  PrathamApiRequest, 
  PrathamApiResponse, 
  PrathamContentData 
} from '../types/cron.types';
import { StructuredLogger } from '../utils/logger';

@Injectable()
export class ExternalApiService {
  private readonly logger = new StructuredLogger('ExternalApiService');
  private readonly axiosInstance: AxiosInstance;
  private readonly config: any;

  constructor(private readonly configService: ConfigService) {
    this.config = this.configService.get('cron');
    
    // Create axios instance with default configuration
    this.axiosInstance = axios.create({
      baseURL: this.config.externalApi.baseUrl,
      timeout: this.config.externalApi.timeout,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Shiksha-Reports-Cron/1.0',
        'sec-ch-ua': '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"macOS"',
      },
    });

    // Add request/response interceptors for logging
    this.setupInterceptors();
  }

  private setupInterceptors() {
    // Request interceptor
    this.axiosInstance.interceptors.request.use(
      (config) => {
        if (this.config.enableDetailedLogging) {
          this.logger.info('Making external API request', {
            url: config.url,
            method: config.method,
            timeout: config.timeout,
          });
        }
        return config;
      },
      (error) => {
        this.logger.error('Request interceptor error', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.axiosInstance.interceptors.response.use(
      (response) => {
        if (this.config.enableDetailedLogging) {
          this.logger.info('External API response received', {
            status: response.status,
            statusText: response.statusText,
            dataSize: JSON.stringify(response.data).length,
          });
        }
        return response;
      },
      (error) => {
        this.logger.error('External API request failed', error, {
          status: error.response?.status,
          statusText: error.response?.statusText,
          url: error.config?.url,
        });
        return Promise.reject(error);
      }
    );
  }

  /**
   * Fetch course data from Pratham Digital API
   */
  async fetchCourseData(): Promise<ExternalCourseApiResponse> {
    try {
      this.logger.info('Fetching course data from Pratham Digital API', {
        endpoint: this.config.externalApi.endpoint,
      });

      const response = await this.makeApiRequest('course');
      return this.processApiResponse(response, 'course') as ExternalCourseApiResponse;

    } catch (error) {
      this.logger.error('Failed to fetch course data from Pratham Digital API', error);
      
      return {
        success: false,
        error: error.message || 'Unknown error occurred',
      };
    }
  }

  /**
   * Fetch question set data from Pratham Digital API (for future use)
   */
  async fetchQuestionSetData(): Promise<ExternalQuestionSetApiResponse> {
    try {
      this.logger.info('Fetching question set data from Pratham Digital API', {
        endpoint: this.config.externalApi.endpoint,
      });

      const response = await this.makeApiRequest('questionSet');
      return this.processApiResponse(response, 'questionSet') as ExternalQuestionSetApiResponse;

    } catch (error) {
      this.logger.error('Failed to fetch question set data from Pratham Digital API', error);
      
      return {
        success: false,
        error: error.message || 'Unknown error occurred',
      };
    }
  }

  /**
   * Get previous day's date in IST timezone (YYYY-MM-DD format)
   */
  private getPreviousDayIST(): string {
    // Get current UTC time
    const now = new Date();
    
    // Convert to IST (UTC+5:30)
    const istOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
    const istTime = new Date(now.getTime() + istOffset);
    
    // Subtract 1 day
    istTime.setDate(istTime.getDate() - 1);
    
    // Format as YYYY-MM-DD
    const year = istTime.getFullYear();
    const month = String(istTime.getMonth() + 1).padStart(2, '0');
    const day = String(istTime.getDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  }

  /**
   * Make the actual API request
   */
  private async makeApiRequest(dataType: 'course' | 'questionSet'): Promise<AxiosResponse<PrathamApiResponse>> {
    const dataTypeConfig = this.config.dataTypes[dataType];
    
    // Get date for filtering (custom date or previous day in IST)
    const filterDate = this.config.dateFilter.customDate || this.getPreviousDayIST();
    
    // this.logger.info(`Making API request for ${dataType} data`, {
    //   date: filterDate,
    //   primaryCategory: dataTypeConfig.primaryCategory,
    //   useCurrentDate: this.config.dateFilter.useCurrentDate,
    // });
    
    const requestBody: PrathamApiRequest = {
      request: {
        filters: {
          status: ['Live'],
          primaryCategory: [dataTypeConfig.primaryCategory],
          createdOn: filterDate, // Previous day's date in IST or custom date from config
        },
        fields: dataTypeConfig.fields,
        limit: 2000, // Fetch all data in one request
        offset: 0,
      },
    };

    const requestConfig: AxiosRequestConfig = {
      method: 'POST',
      url: this.config.externalApi.endpoint,
      data: requestBody,
    };

    return this.axiosInstance.request(requestConfig);
  }

  /**
   * Process the API response and extract course data
   */
  private processApiResponse(response: AxiosResponse<PrathamApiResponse>, dataType: 'course' | 'questionSet'): ExternalCourseApiResponse | ExternalQuestionSetApiResponse {
    const { data, status } = response;

    if (status !== 200) {
      throw new Error(`API returned status ${status}`);
    }

    // Check if the response has the expected Pratham API structure
    if (!data.result) {
      throw new Error('Invalid Pratham API response structure - missing result');
    }

    // Handle different response structures for Course vs QuestionSet
    let prathamData: any[] = [];
    let convertedData: any[] = [];
    
    if (Array.isArray((data.result as any).content)) {
      // Course API response structure
      prathamData = (data.result as any).content;
      convertedData = this.convertPrathamToLegacyFormat(prathamData);
    } else if (Array.isArray((data.result as any).QuestionSet)) {
      // QuestionSet API response structure
      prathamData = (data.result as any).QuestionSet;
      convertedData = this.convertPrathamToQuestionSetFormat(prathamData);
    } else {
      throw new Error('Invalid Pratham API response structure - no content or QuestionSet found');
    }

    this.logger.info('Successfully processed Pratham API response', {
      totalItems: prathamData.length,
      count: data.result.count,
    });

    if (dataType === 'course') {
      return {
        success: true,
        data: convertedData as ExternalCourseData[],
      };
    } else {
      return {
        success: true,
        data: convertedData as ExternalQuestionSetData[],
      };
    }
  }

  /**
   * Convert Pratham API data to legacy format for backward compatibility
   */
  private convertPrathamToLegacyFormat(prathamData: any[]): ExternalCourseData[] {
    return prathamData
      .filter((item) => item && item.identifier)
      .map((item) => ({
        identifier: item.identifier,
        name: item.name || null,
        author: item.author || null,
        primaryuser: null, // Not available in Pratham API
        se_domains: item.se_domains ? JSON.stringify(item.se_domains) : null,
        contentlanguage: item.language ? JSON.stringify(item.language) : null,
        status: item.status ? item.status.toLowerCase() : 'live',
        targetagegroup: item.targetAgeGroup ? JSON.stringify(item.targetAgeGroup) : null,
        se_subdomains: null, // Not available in Pratham API
        childnodes: item.childNodes ? JSON.stringify(item.childNodes) : null,
        keywords: item.keywords ? JSON.stringify(item.keywords) : null,
        channel: item.channel || 'pratham',
        lastpublishedon: item.lastPublishedOn || item.createdOn || null,
        createdby: item.createdBy || null,
        program: item.program ? JSON.stringify(item.program) : null,
        audience: item.audience ? JSON.stringify(item.audience) : null,
        se_subjects: item.se_subjects ? JSON.stringify(item.se_subjects) : null,
        description: item.description || null,
      }));
  }

  /**
   * Convert Pratham API data to QuestionSet format
   */
  private convertPrathamToQuestionSetFormat(prathamData: any[]): ExternalQuestionSetData[] {
    return prathamData
      .filter((item) => item && item.identifier)
      .map((item) => ({
        identifier: item.identifier,
        name: item.name || item.Name || null,
        childNodes: item.childNodes || item.ChildNodes || null,
        createdOn: item.createdOn || item.CreatedOn || null,
        program: item.program || item.Program || null,
        assessmentType: item.assessmentType || item.AssessmentType || null,
        contentLanguage: item.language || item.contentLanguage || item.Language || item.ContentLanguage || null,
        se_domains: item.se_domains || item.Domain || item.domain || null,
        se_subdomains: item.se_subdomains || item.subDomain || item.SubDomain || null,
        se_subjects: item.se_subjects || item.subject || item.Subject || null,
        domain: item.se_domains || item.Domain || item.domain || null,
        subDomain: item.se_subdomains || item.subDomain || item.SubDomain || null,
        subject: item.se_subjects || item.subject || item.Subject || null,
        language: item.language || item.contentLanguage || item.Language || item.ContentLanguage || null,
      }));
  }

  /**
   * Validate and clean course data (legacy method for backward compatibility)
   */
  private validateCourseData(data: any[]): ExternalCourseData[] {
    return data
      .filter((item) => item && typeof item === 'object')
      .map((item) => ({
        identifier: item.identifier || item.id || item.courseId || '',
        name: item.name || item.title || item.courseName || null,
        author: item.author || item.createdBy || null,
        primaryuser: item.primaryuser || item.primaryUser || null,
        se_domains: item.se_domains || item.domains || null,
        contentlanguage: item.contentlanguage || item.language || item.contentLanguage || null,
        status: item.status || item.state || null,
        targetagegroup: item.targetagegroup || item.ageGroup || item.targetAgeGroup || null,
        se_subdomains: item.se_subdomains || item.subdomains || null,
        childnodes: item.childnodes || item.childNodes || null,
        keywords: item.keywords || item.tags || null,
        channel: item.channel || item.source || null,
        lastpublishedon: item.lastpublishedon || item.lastPublishedOn || item.publishedAt || null,
        createdby: item.createdby || item.createdBy || item.author || null,
        program: item.program || item.programName || null,
        audience: item.audience || item.targetAudience || null,
        se_subjects: item.se_subjects || item.subjects || null,
        description: item.description || item.summary || null,
      }))
      .filter((item) => item.identifier); // Only include items with valid identifier
  }


  /**
   * Test API connectivity
   */
  async testConnection(): Promise<boolean> {
    try {
      this.logger.info('Testing Pratham Digital API connection');
      
      // Test with a minimal course request
      const testRequest: PrathamApiRequest = {
        request: {
          filters: {
            status: ['Live'],
            primaryCategory: ['Course'],
          },
          fields: ['identifier', 'name'],
          limit: 1,
          offset: 0,
        },
      };

      const response = await this.axiosInstance.post(
        this.config.externalApi.endpoint,
        testRequest,
        { timeout: 10000 }
      );
      
      this.logger.info('API connection test successful', { 
        status: response.status,
        hasData: !!response.data?.result?.content?.length
      });
      return true;
    } catch (error) {
      this.logger.error('API connection test failed', error);
      return false;
    }
  }
}
