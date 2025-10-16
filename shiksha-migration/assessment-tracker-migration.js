const { Client } = require('pg');
const dbConfig = require('./db');
const axios = require('axios');

console.log('=== Loading assessment-tracker-migration.js ===');

function isUUID(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function toInt(value) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

// Cache for userId -> tenantId lookups
const userIdToTenantId = new Map();

async function getTenantIdForUser(sourceClient, userId) {
  if (!userId) return null;
  if (userIdToTenantId.has(userId)) return userIdToTenantId.get(userId);
  
  try {
    // Try different possible table name variations
    const possibleQueries = [
      'SELECT "tenantId" FROM public."UserTenantMapping" WHERE "userId" = $1 LIMIT 1',
    ];
    
    for (const query of possibleQueries) {
      try {
        const res = await sourceClient.query(query, [userId]);
        if (res.rows.length > 0) {
          const tenantId = res.rows[0].tenantId;
          console.log(`[ASSESSMENT TRACKER] Found tenantId: ${tenantId} for user: ${userId} using query: ${query}`);
          userIdToTenantId.set(userId, tenantId);
          return tenantId;
        }
      } catch (queryError) {
        // Try next query variation
        continue;
      }
    }
    
    console.warn(`[ASSESSMENT TRACKER] No tenantId found in any table variation for user: ${userId}`);
    userIdToTenantId.set(userId, null);
    return null;
  } catch (e) {
    console.warn('[ASSESSMENT TRACKER] Error fetching tenantId for user', userId, e.message);
    userIdToTenantId.set(userId, null);
    return null;
  }
}

async function getAssessmentData(assessmentId) {
  try {
    console.log("assessmentIdsss",assessmentId);
    // ==================== OLD CODE (COMMENTED OUT) ====================
    // const baseUrl = process.env.MIDDLEWARE_SERVICE_BASE_URL;
    // if (!baseUrl) {
    //   console.warn('[ASSESSMENT TRACKER] MIDDLEWARE_SERVICE_BASE_URL not configured, using default values');
    //   return { 
    //     name: 'Unknown Assessment',
    //     type: 'Assessment'
    //   };
    // }

    // if (!assessmentId) {
    //   throw new Error('Identifier is required for API call');
    // }

    // const url = new URL('action/composite/v3/search', baseUrl);

    // const apiResponse = await axios.post(
    //   url.toString(),
    //   {
    //     request: {
    //       filters: {
    //         identifier: [assessmentId],
    //       },
    //     },
    //   },
    //   {
    //     timeout: 10000, // 10 second timeout
    //     headers: {
    //       'Content-Type': 'application/json',
    //     },
    //   },
    // );

    // const questionSet = apiResponse.data.result?.QuestionSet?.[0];
    // const assessmentName = questionSet?.name || 'Unknown Assessment';
    // const assessmentType = questionSet?.assessmentType || 'Assessment';
    // ==================== END OLD CODE ====================

    // ==================== NEW CODE (ACTIVE) ====================
    const baseUrl = process.env.MIDDLEWARE_SERVICE_BASE_URL;
    if (!baseUrl) {
      console.warn('[ASSESSMENT TRACKER] COURSE_HIERARCHY_API_URL not configured, using default values');
      return { 
        name: 'Unknown Assessment',
        type: 'Assessment'
      };
    }

    if (!assessmentId) {
      throw new Error('Identifier is required for API call');
    }

    // Construct URL: baseUrl + assessmentId
    const url = `${baseUrl}api/course/v1/hierarchy/${assessmentId}?mode=edit`;
    console.log(`[ASSESSMENT TRACKER] Fetching assessment data from: ${url}`);

    const apiResponse = await axios.get(
      url,
      {
        timeout: 10000, // 10 second timeout
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
        },
      },
    );

    // Extract data from the new API response structure
    let contentData;
    if (apiResponse.data?.result?.content) {
      contentData = apiResponse.data.result.content;
    } else if (apiResponse.data?.result) {
      contentData = apiResponse.data.result;
    } else {
      throw new Error('Invalid API response structure or empty content');
    }
    console.log("contentData",contentData);
    const assessmentName = contentData?.name || 'Unknown Assessment';
    const assessmentType = contentData?.assessmentType || 'Assessment';
    // ==================== END NEW CODE ====================
    
    console.log(`[ASSESSMENT TRACKER] Assessment data for ${assessmentId}:`);
    console.log(`  - Name: ${assessmentName}`);
    console.log(`  - Type: ${assessmentType}`);
    
    return {
      name: assessmentName,
      type: assessmentType
    };
  } catch (error) {
    console.error(
      '[ASSESSMENT TRACKER] Error fetching assessment data for assessmentId:',
      assessmentId,
      error.message,
    );
    return { 
      name: 'Unknown Assessment',
      type: 'Assessment'
    }; // Fallback to default values
  }
}

async function migrateAssessmentTracker() {
  console.log('=== STARTING ASSESSMENT TRACKER MIGRATION ===');
  const sourceClient = new Client(dbConfig.assessment_source);
  const destClient = new Client(dbConfig.assessment_destination);

  try {
    await sourceClient.connect();
    console.log('[ASSESSMENT TRACKER] Connected to source database');
    await destClient.connect();
    console.log('[ASSESSMENT TRACKER] Connected to destination database');

    // Fetch CourseIDs from destination where AssessmentType = 'Assessment'
    const courseIdsRes = await destClient.query(`
      SELECT DISTINCT "CourseID"
      FROM public."AssessmentTracker"
      WHERE "AssessmentType" = 'Assessment'
      AND "CourseID" IS NOT NULL
      AND "CourseID" != ''
    `);
    console.log("courseIdsRes",courseIdsRes);
    const allCourseIds = courseIdsRes.rows.map(row => row.CourseID);
    console.log(`[ASSESSMENT TRACKER] Found ${allCourseIds.length} CourseIDs with AssessmentType = 'Assessment' in destination`);

    if (allCourseIds.length === 0) {
      console.log('[ASSESSMENT TRACKER] No CourseIDs to process. Exiting.');
      return;
    }

    // Process in batches of 500 to avoid query size limits
    const BATCH_SIZE = 100;
    const totalBatches = Math.ceil(allCourseIds.length / BATCH_SIZE);
    let totalProcessed = 0;

    console.log(`[ASSESSMENT TRACKER] Processing ${allCourseIds.length} CourseIDs in ${totalBatches} batches of ${BATCH_SIZE}`);

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const start = batchIndex * BATCH_SIZE;
      const end = Math.min(start + BATCH_SIZE, allCourseIds.length);
      const batchCourseIds = allCourseIds.slice(start, end);

      console.log(`\n[ASSESSMENT TRACKER] === Processing Batch ${batchIndex + 1}/${totalBatches} (CourseIDs ${start + 1}-${end}) ===`);

      // Fetch from source where contentId is in the batch of courseIds
      const assessmentsRes = await sourceClient.query(`
        SELECT
          "assessmentTrackingId",
          "userId",
          "courseId",
          "contentId",
          "assessmentSummary",
          "timeSpent",
          "attemptId",
          "tenantId"
        FROM public.assessment_tracking
        WHERE "contentId" = ANY($1::text[])
      `, [batchCourseIds]);

      console.log(`[ASSESSMENT TRACKER] Found ${assessmentsRes.rows.length} assessment rows in batch ${batchIndex + 1}`);

      for (const row of assessmentsRes.rows) {
        await upsertOne(sourceClient, destClient, row);
        totalProcessed++;
        
        // For testing: stop after first record update
        console.log('[ASSESSMENT TRACKER] 🛑 Stopping after one record for testing');
        // return;
      }

      console.log(`[ASSESSMENT TRACKER] Batch ${batchIndex + 1} completed. Total processed so far: ${totalProcessed}`);
    }

    console.log(`\n[ASSESSMENT TRACKER] Migration completed successfully. Total records processed: ${totalProcessed}`);
  } catch (err) {
    console.error('[ASSESSMENT TRACKER] Critical error:', err);
  } finally {
    await sourceClient.end();
    await destClient.end();
    console.log('[ASSESSMENT TRACKER] Disconnected from databases');
  }
}

async function upsertOne(sourceClient, destClient, a) {
  console.log("[ASSESSMENT TRACKER] Processing record:", a.assessmentTrackingId);
  const assesTrackingId = a.assessmentTrackingId;
  const userId = a.userId;
  const courseIdRaw = a.courseId || '';
  const contentIdRaw = a.contentId || '';
  const timeSpent = toInt(a.timeSpent);
  const totalScore = Number(a.totalScore || 0);
  const totalMaxScore = Number(a.totalMaxScore || 0);
  const assessmentSummaryText =
    a.assessmentSummary != null ? JSON.stringify(a.assessmentSummary) : null;
  const attemptId = a.attemptId || null;
  const tenantId = a.tenantId || '10a9f829-3652-47d0-b17b-68c4428f9f89';
  // Resolve TenantID from usertenantmapping
  // let tenantId = await getTenantIdForUser(sourceClient, userId);
  
  // if (!tenantId) {
  //   console.warn(`[ASSESSMENT TRACKER] No tenantId found for user ${userId}, using fallback`);
  //   tenantId = '10a9f829-3652-47d0-b17b-68c4428f9f89'; // Fallback only if no tenantId exists
  // } else {
  //   console.log(`[ASSESSMENT TRACKER] Using tenantId from userTenantMapping: ${tenantId} for user: ${userId}`);
  // }
  
  // CourseID can be stored as-is (do_ identifier or UUID)
  const courseId = courseIdRaw;
  console.log("courseId",courseId,contentIdRaw);
  
  // Fetch assessment data (name and type) from API using contentId
  const assessmentData = await getAssessmentData(contentIdRaw);
  const assessmentName = assessmentData.name;
  const assessmentType = assessmentData.type;
  
  console.log(`[ASSESSMENT TRACKER] Using assessmentType from API: ${assessmentType} (not evaluatedBy: ${a.evaluatedBy})`);

  // Upsert into destination
  const upsertSql = `
    INSERT INTO public."AssessmentTracker" (
      "AssesTrackingID", "AssessmentID", "CourseID", "UserID", "TenantID",
      "TotalMaxScore", "TotalScore", "TimeSpent", "AssessmentSummary",
      "AttemptID", "AssessmentType", "AssessmentName"
    )
    VALUES ($1, gen_random_uuid(), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT ("AssesTrackingID")
    DO UPDATE SET
      "CourseID" = EXCLUDED."CourseID",
      "UserID" = EXCLUDED."UserID",
      "TenantID" = EXCLUDED."TenantID",
      "TotalMaxScore" = EXCLUDED."TotalMaxScore",
      "TotalScore" = EXCLUDED."TotalScore",
      "TimeSpent" = EXCLUDED."TimeSpent",
      "AssessmentSummary" = EXCLUDED."AssessmentSummary",
      "AttemptID" = EXCLUDED."AttemptID",
      "AssessmentType" = EXCLUDED."AssessmentType",
      "AssessmentName" = EXCLUDED."AssessmentName"
  `;

  const params = [
    assesTrackingId,
    courseId,
    userId,
    tenantId,
    totalMaxScore,
    totalScore,
    timeSpent,
    assessmentSummaryText,
    attemptId,
    assessmentType,
    assessmentName
  ];

  try {
    await destClient.query(upsertSql, params);
    console.log('[ASSESSMENT TRACKER] Upserted', assesTrackingId);
  } catch (e) {
    console.error('[ASSESSMENT TRACKER] Upsert error for', assesTrackingId, e.message);
  }
}

if (require.main === module) {
  console.log('Running assessment-tracker-migration.js directly');
  migrateAssessmentTracker().catch((err) => {
    console.error('AssessmentTracker migration failed with unhandled error:', err);
    process.exit(1);
  });
}

module.exports = { migrateAssessmentTracker };