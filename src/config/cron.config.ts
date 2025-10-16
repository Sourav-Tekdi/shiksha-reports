import { registerAs } from '@nestjs/config';

export default registerAs('cron', () => ({
  // Cron job schedule - runs at 12 PM daily
  schedule: process.env.CRON_SCHEDULE || '0 12 * * *',
  
  // Pratham Digital API configuration
  externalApi: {
    baseUrl: process.env.MIDDLEWARE_SERVICE_BASE_URL || 'https://interface.prathamdigital.org',
    endpoint: process.env.EXTERNAL_API_ENDPOINT || 'action/composite/v3/search',
    timeout: parseInt(process.env.EXTERNAL_API_TIMEOUT || '30000'), // 30 seconds
  },
  
  // Data fetching configuration
  dataTypes: {
    course: {
      primaryCategory: 'Course',
      fields: [
        'identifier', 'name', 'author', 'primaryCategory', 'channel', 'status',
        'contentType', 'language', 'se_domains', 'se_subdomains', 'se_subjects',
        'targetAgeGroup', 'audience', 'program', 'keywords', 'description',
        'createdBy', 'lastPublishedOn', 'childNodes', 'appIcon', 'posterImage', 'createdOn'
      ]
    },
    questionSet: {
      primaryCategory: 'Practice Question Set',
      fields: [
        'identifier', 'name', 'childNodes', 'createdOn', 'program', 
        'assessmentType', 'contentLanguage', 'domain', 'subDomain', 'subject'
      ]
    }
  },
  
  // Date filtering configuration
  dateFilter: {
    useCurrentDate: process.env.CRON_USE_CURRENT_DATE !== 'false', // Default: true
    customDate: process.env.CRON_CUSTOM_DATE || null, // Override with specific date if needed
  },
  
  // Logging configuration
  enableDetailedLogging: process.env.CRON_ENABLE_DETAILED_LOGGING === 'true',
  logApiResponses: process.env.CRON_LOG_API_RESPONSES === 'true',
}));
