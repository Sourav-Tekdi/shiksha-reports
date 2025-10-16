// Pratham Digital API request types
export interface PrathamApiRequest {
  request: {
    filters: {
      status: string[];
      primaryCategory: string[];
      createdOn?: string;
    };
    fields: string[];
    limit: number;
    offset: number;
  };
}

// Pratham Digital API response types
export interface PrathamApiResponse {
  id: string;
  ver: string;
  ts: string;
  params: {
    resmsgid: string;
    msgid: string;
    status: string;
    err: string | null;
    errmsg: string | null;
  };
  responseCode: string;
  result: {
    content?: PrathamContentData[];
    QuestionSet?: PrathamContentData[];
    count: number;
  };
}

export interface PrathamContentData {
  identifier: string;
  name: string;
  appIcon?: string;
  description?: string;
  posterImage?: string;
  mimeType?: string;
  resourceType?: string;
  primaryCategory: string;
  contentType?: string;
  trackable?: {
    enabled: string;
    autoBatch: string;
  };
  children?: string[];
  childNodes?: string[]; // Alternative field name
  leafNodes?: string[];
  createdOn?: string;
  lastPublishedOn?: string; // Alternative field name
  author?: string;
  createdBy?: string;
  channel?: string;
  status?: string;
  language?: string[];
  se_domains?: string[];
  targetAgeGroup?: string[];
  keywords?: string[];
  program?: string[];
  audience?: string[];
  se_subjects?: string[];
}

// Legacy interface for backward compatibility
export interface ExternalCourseData {
  identifier: string;
  name?: string;
  author?: string;
  primaryuser?: string;
  se_domains?: string;
  contentlanguage?: string;
  status?: string;
  targetagegroup?: string;
  se_subdomains?: string;
  childnodes?: string;
  keywords?: string;
  channel?: string;
  lastpublishedon?: string | Date;
  createdby?: string;
  program?: string;
  audience?: string;
  se_subjects?: string;
  description?: string;
}

// QuestionSet data interface for API responses
export interface ExternalQuestionSetData {
  identifier: string;
  name?: string;
  childNodes?: string[] | string;
  createdOn?: string | Date;
  program?: string[] | string;
  assessmentType?: string;
  contentLanguage?: string[] | string;
  se_domains?: string[] | string;
  se_subdomains?: string[] | string;
  se_subjects?: string[] | string;
  domain?: string[] | string;
  subDomain?: string[] | string;
  subject?: string[] | string;
  language?: string[] | string;
}

export interface ExternalApiResponse {
  success: boolean;
  data?: ExternalCourseData[] | ExternalQuestionSetData[];
  error?: string;
}

export interface ExternalCourseApiResponse {
  success: boolean;
  data?: ExternalCourseData[];
  error?: string;
}

export interface ExternalQuestionSetApiResponse {
  success: boolean;
  data?: ExternalQuestionSetData[];
  error?: string;
}

// Cron job execution status
export interface CronJobStatus {
  isRunning: boolean;
  lastExecution?: Date;
  lastSuccess?: Date;
  lastError?: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  nextExecution?: Date;
}


// Configuration types
export interface CronJobConfig {
  schedule: string;
  externalApi: {
    baseUrl: string;
    endpoint: string;
    timeout: number;
  };
  enableDetailedLogging: boolean;
  logApiResponses: boolean;
}
