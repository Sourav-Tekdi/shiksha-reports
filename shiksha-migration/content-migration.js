const { Client } = require('pg');
const axios = require('axios');
const dbConfig = require('./db');

console.log('=== Loading api-migration.js ===');

const API_URL = 'https://interface.prathamdigital.org/interface/v1/action/composite/v3/search';
const LIMIT = 1000;

// Define which fields should be stored as arrays
const ARRAY_FIELDS = [
  'se_domains',
  'se_subdomains',
  'se_subjects',
  'targetAgeGroup',
  'audience',
  'program',
  'keywords',
  'contentLanguage'
];

// Fetch data from API with pagination
async function fetchDataFromAPI(offset = 0) {
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'Shiksha-Reports-Cron/1.0',
    'Cookie': 'AWSALB=AexPo8Pmp6oMCH3rjxzJLf4yo+LvQLlq+eal+Hr8XngG57iNuDahB+T7tcxcrBvMa6eURBlRJjjG9vrRIYdF++asDMxFA95NkXfwLSL5YYfwo3heTwT8xiE3Byb2; AWSALBCORS=AexPo8Pmp6oMCH3rjxzJLf4yo+LvQLlq+eal+Hr8XngG57iNuDahB+T7tcxcrBvMa6eURBlRJjjG9vrRIYdF++asDMxFA95NkXfwLSL5YYfwo3heTwT8xiE3Byb2'
  };

  const payload = {
    request: {
      filters: {
        status: ["Live","Retired"],
        primaryCategory: ["Learning Resource", "Story", "Activity", "Interactive"]
      },
      fields: [
        "identifier", "name", "author", "primaryCategory", "channel", "status",
        "contentType", "contentLanguage", "se_domains", "se_subdomains", "se_subjects",
        "targetAgeGroup", "audience", "program", "keywords", "description",
        "createdBy", "lastPublishedOn", "createdOn"
      ],
      limit: LIMIT,
      offset: offset
    }
  };

  console.log(`[API MIGRATION] Fetching data with offset: ${offset}, limit: ${LIMIT}`);
  const res = await axios.post(API_URL, payload, { headers });
  return res.data;
}

// Process field value - convert arrays to JSON strings for text columns
function processFieldValue(fieldName, value) {
  // If the field should be an array
  if (ARRAY_FIELDS.includes(fieldName)) {
    // If value is already an array, convert to JSON string
    if (Array.isArray(value)) {
      return JSON.stringify(value);
    }
    // If value is null or undefined, return null
    if (value == null) {
      return null;
    }
    // If it's a string, wrap it in an array and convert to JSON
    if (typeof value === 'string') {
      return JSON.stringify([value]);
    }
    // Otherwise return null for safety
    return null;
  }
  
  // For non-array fields, return value as is
  return value;
}

// Insert data into database
async function insertDataToDatabase(destClient, data) {
  console.log(`[API MIGRATION] Inserting ${data.length} records to database`);
  
  for (const record of data) {
  const insertQuery = `
    INSERT INTO public."Content"(
      "identifier", "name", "author", "primaryCategory", "channel", "status",
      "contentType", "contentLanguage", "domains", "subdomains", "subjects",
      "targetAgeGroup", "audience", "program", "keywords", "description",
      "createdBy", "lastPublishedOn", "createdOn"
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
    ON CONFLICT ("identifier") DO UPDATE SET
      "name" = EXCLUDED."name",
      "author" = EXCLUDED."author",
      "primaryCategory" = EXCLUDED."primaryCategory",
      "channel" = EXCLUDED."channel",
      "status" = EXCLUDED."status",
      "contentType" = EXCLUDED."contentType",
      "contentLanguage" = EXCLUDED."contentLanguage",
      "domains" = EXCLUDED."domains",
      "subdomains" = EXCLUDED."subdomains",
      "subjects" = EXCLUDED."subjects",
      "targetAgeGroup" = EXCLUDED."targetAgeGroup",
      "audience" = EXCLUDED."audience",
      "program" = EXCLUDED."program",
      "keywords" = EXCLUDED."keywords",
      "description" = EXCLUDED."description",
      "createdBy" = EXCLUDED."createdBy",
      "lastPublishedOn" = EXCLUDED."lastPublishedOn",
      "createdOn" = EXCLUDED."createdOn"
    RETURNING "identifier"
  `;

  const values = [
    record.identifier,
    record.name,
    record.author,
    record.primaryCategory,
    record.channel,
    record.status,
    record.contentType,
    processFieldValue('contentLanguage', record.contentLanguage),
    processFieldValue('se_domains', record.se_domains),
    processFieldValue('se_subdomains', record.se_subdomains),
    processFieldValue('se_subjects', record.se_subjects),
    processFieldValue('targetAgeGroup', record.targetAgeGroup),
    processFieldValue('audience', record.audience),
    processFieldValue('program', record.program),
    processFieldValue('keywords', record.keywords),
    record.description,
    record.createdBy,
    record.lastPublishedOn,
    record.createdOn
  ];

  const result = await destClient.query(insertQuery, values);
  console.log(`[API MIGRATION] ✅ Inserted/updated record: ${result.rows[0].identifier}`);
}

  console.log(`[API MIGRATION] ✅ Successfully processed ${data.length} records`);
}

// Main migration function with pagination
async function migrateFromAPI(startOffset = 0) {
  console.log('=== STARTING API MIGRATION ===');
  const destClient = new Client(dbConfig.destination);

  try {
    await destClient.connect();
    console.log('[API MIGRATION] Connected to destination database');

    // Resume from specified offset (useful for recovery)
    let offset = startOffset;
    let totalRecords = 0;
    let hasMoreData = true;
    
    if (startOffset > 0) {
      console.log(`[API MIGRATION] ⚠️ Resuming from offset: ${startOffset}`);
    }

    while (hasMoreData) {
      console.log(`\n[API MIGRATION] Fetching batch starting at offset: ${offset}`);
      
      const response = await fetchDataFromAPI(offset);
      
      // Extract content from response
      const apiData = response?.result?.content || [];
      
      if (!apiData || apiData.length === 0) {
        console.log('[API MIGRATION] No more data to fetch');
        hasMoreData = false;
        break;
      }
      
      console.log(`[API MIGRATION] Received ${apiData.length} records from API`);

      // Insert data into database
      await insertDataToDatabase(destClient, apiData);

      totalRecords += apiData.length;
      console.log(`[API MIGRATION] 📊 Progress: Processed ${totalRecords} records so far (current offset: ${offset})`);
      
      // If we got less than LIMIT records, we've reached the end
      if (apiData.length < LIMIT) {
        console.log('[API MIGRATION] Reached end of data (received less than limit)');
        hasMoreData = false;
      } else {
        offset += LIMIT; // Move to next batch: 0 -> 1000 -> 2000 -> 3000...
        console.log(`[API MIGRATION] ✅ Batch completed. Next offset will be: ${offset}`);
      }
    }

    console.log(`\n[API MIGRATION] ✅ API migration completed successfully`);
    console.log(`[API MIGRATION] Total records processed: ${totalRecords}`);
  } catch (error) {
    console.error('[API MIGRATION] ❌ Error during API migration:', error);
    console.error(`[API MIGRATION] ⚠️ Failed at offset: ${offset}`);
    console.error(`[API MIGRATION] 💡 To resume, run: migrateFromAPI(${offset})`);
    throw error;
  } finally {
    await destClient.end();
    console.log('[API MIGRATION] Disconnected from database');
  }
  console.log('=== COMPLETED API MIGRATION ===');
}

// Run the migration only if this script is run directly
if (require.main === module) {
  console.log('Running api-migration.js directly');
  
  // Get offset from command line argument (e.g., node api-migration.js 10000)
  const startOffset = parseInt(process.argv[2]) || 0;
  
  if (startOffset > 0) {
    console.log(`📍 Starting migration from offset: ${startOffset}`);
  }
  
  migrateFromAPI(startOffset).catch(err => {
    console.error('API migration failed:', err);
    process.exit(1);
  });
} else {
  console.log('api-migration.js loaded as a module');
}

module.exports = {
  migrateFromAPI,
  fetchDataFromAPI,
  insertDataToDatabase
};