const { Client } = require('pg');
const axios = require('axios');
const https = require('https');
const dns = require('dns');
const fs = require('fs');
const path = require('path');
const dbConfig = require('./db');

console.log('=== Loading taxonomy-sync.js ===');

// Force IPv4 to avoid IPv6 timeout issues
dns.setDefaultResultOrder('ipv4first');

// ============================================================
// CONFIGURATION - All frameworks to sync
// ============================================================
const FRAMEWORK_NAMES = ['pragyanpath-framework', 'pos-framework', 'scp-framework'];
// ============================================================
// API Configuration
const API_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  'Referer': 'https://lap.prathamdigital.org/course-planner',
  'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"'
};

// Create axios instance with IPv4 preference and timeout
const axiosInstance = axios.create({
  timeout: 30000, // 30 seconds timeout
  httpsAgent: new https.Agent({
    family: 4, // Force IPv4
    rejectUnauthorized: true
  })
});

// Fetch framework data from API with retry
async function fetchFrameworkData(frameworkName, retries = 3) {
  const FRAMEWORK_API_URL = `https://lap.prathamdigital.org/api/framework/v1/read/${frameworkName}`;
  console.log('[TAXONOMY SYNC] Fetching framework data from API...');
  console.log(`[TAXONOMY SYNC] API URL: ${FRAMEWORK_API_URL}`);
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`[TAXONOMY SYNC] Attempt ${attempt}/${retries}...`);
      
      const response = await axiosInstance.get(FRAMEWORK_API_URL, { headers: API_HEADERS });
      
      if (response.data?.responseCode !== 'OK') {
        throw new Error(`API returned error: ${response.data?.params?.errmsg || 'Unknown error'}`);
      }
      
      console.log('[TAXONOMY SYNC] ✅ Successfully fetched framework data from API');
      return response.data.result.framework;
    } catch (error) {
      console.error(`[TAXONOMY SYNC] ❌ Attempt ${attempt} failed:`, error.message);
      
      if (attempt === retries) {
        console.error('[TAXONOMY SYNC] ❌ All retry attempts exhausted');
        throw error;
      }
      
      // Wait before retry (exponential backoff)
      const waitTime = attempt * 2000;
      console.log(`[TAXONOMY SYNC] Waiting ${waitTime/1000}s before retry...`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }
}

// Parse API response and extract structured data
// Using DESCRIPTION field for matching (converted to lowercase)
function parseFrameworkData(framework) {
  console.log('[TAXONOMY SYNC] Parsing framework data...');
  console.log('[TAXONOMY SYNC] Using DESCRIPTION field for matching (lowercase)');
  
  const parsedData = {
    boards: [],
    subjectStatus: {} // keyed by lowercase description
  };
  
  // Find the board category
  const boardCategory = framework.categories?.find(cat => cat.code === 'board');
  const mediumCategory = framework.categories?.find(cat => cat.code === 'medium');
  const gradeLevelCategory = framework.categories?.find(cat => cat.code === 'gradeLevel');
  const subjectCategory = framework.categories?.find(cat => cat.code === 'subject');
  
  if (!boardCategory) {
    throw new Error('Board category not found in framework data');
  }
  
  // Extract subject statuses (keyed by lowercase description)
  if (subjectCategory?.terms) {
    for (const term of subjectCategory.terms) {
      if (term.status === 'Retired') {
        const descLower = (term.description || term.name || '').toLowerCase();
        parsedData.subjectStatus[descLower] = 'Retired';
      }
    }
  }
  
  // Parse each board
  for (const boardTerm of boardCategory.terms || []) {
    const board = {
      code: boardTerm.code,
      name: boardTerm.name,
      description: boardTerm.description || boardTerm.name, // Use description, fallback to name
      status: boardTerm.status,
      mediums: [],    // Will store { code, name, description }
      grades: [],     // Will store { code, name, description }
      subjects: []    // Will store { code, name, description, status }
    };
    
    // Extract mediums, grades, and subjects from associations
    if (boardTerm.associations) {
      for (const assoc of boardTerm.associations) {
        const assocDesc = assoc.description || assoc.name; // Use description, fallback to name
        const assocDescLower = assocDesc.toLowerCase();
        
        if (assoc.category === 'medium') {
          const exists = board.mediums.find(m => (m.description || '').toLowerCase() === assocDescLower);
          if (!exists) {
            board.mediums.push({ 
              code: assoc.code, 
              name: assoc.name, 
              description: assocDesc 
            });
          }
        }
        if (assoc.category === 'gradeLevel') {
          const exists = board.grades.find(g => (g.description || '').toLowerCase() === assocDescLower);
          if (!exists) {
            board.grades.push({ 
              code: assoc.code, 
              name: assoc.name, 
              description: assocDesc 
            });
          }
        }
        if (assoc.category === 'subject') {
          const exists = board.subjects.find(s => (s.description || '').toLowerCase() === assocDescLower);
          if (!exists) {
            board.subjects.push({ 
              code: assoc.code, 
              name: assoc.name, 
              description: assocDesc,
              status: assoc.status 
            });
            // Also track subject status from associations (keyed by lowercase description)
            if (assoc.status === 'Retired') {
              parsedData.subjectStatus[assocDescLower] = 'Retired';
            }
          }
        }
      }
    }
    
    parsedData.boards.push(board);
  }
  
  console.log(`[TAXONOMY SYNC] Parsed ${parsedData.boards.length} boards`);
  console.log(`[TAXONOMY SYNC] Found ${Object.keys(parsedData.subjectStatus).length} retired subjects`);
  
  return parsedData;
}

// Store parsed framework data globally
let frameworkData = null;

// Get status for a subject (using lowercase description)
function getSubjectStatus(subjectDescription, subjectStatus) {
  const descLower = (subjectDescription || '').toLowerCase();
  if (subjectStatus && subjectStatus[descLower]) {
    return subjectStatus[descLower];
  }
  return "Live";
}

// Generate all expected taxonomy combinations from JSON (using description in lowercase)
function generateExpectedTaxonomy(parsedData) {
  const expected = [];
  
  for (const board of parsedData.boards) {
    // Skip retired boards with no mediums/grades
    if (board.mediums.length === 0 || board.grades.length === 0) {
      continue;
    }
    
    for (const medium of board.mediums) {
      for (const grade of board.grades) {
        for (const subject of board.subjects) {
          expected.push({
            // Store descriptions in lowercase for comparison
            level1: (grade.description || '').toLowerCase(),
            level2: (board.description || '').toLowerCase(),
            level3: (medium.description || '').toLowerCase(),
            level4: (subject.description || '').toLowerCase(),
            // Keep original values for display/logging
            level1Display: grade.description,
            level2Display: board.description,
            level3Display: medium.description,
            level4Display: subject.description,
            // Get status from subject or subjectStatus map
            status: subject.status === 'Retired' ? 'Retired' : getSubjectStatus(subject.description, parsedData.subjectStatus),
            boardStatus: board.status,
            boardCode: board.code
          });
        }
      }
    }
  }
  
  return expected;
}

// Create a unique key for comparison (all values converted to lowercase and trimmed)
function createKey(level1, level2, level3, level4) {
  const l1 = (level1 || '').toString().toLowerCase().trim();
  const l2 = (level2 || '').toString().toLowerCase().trim();
  const l3 = (level3 || '').toString().toLowerCase().trim();
  const l4 = (level4 || '').toString().toLowerCase().trim();
  return `${l1}|${l2}|${l3}|${l4}`;
}

// Escape single quotes for SQL
function escapeSql(str) {
  if (!str) return str;
  return str.replace(/'/g, "''");
}

// Main sync function
async function syncTaxonomy(frameworkName) {
  console.log('=== STARTING TAXONOMY SYNC ===');
  console.log(`🎯 Framework: ${frameworkName}`);
  
  // Step 1: Fetch framework data from API
  const rawFramework = await fetchFrameworkData(frameworkName);
  
  // Step 2: Parse the framework data
  frameworkData = parseFrameworkData(rawFramework);
  
  // Print API data summary
  console.log('\n' + '='.repeat(60));
  console.log('              API DATA SUMMARY');
  console.log('='.repeat(60));
  console.log(`📋 Total Boards: ${frameworkData.boards.length}`);
  console.log(`📋 Retired Subjects: ${Object.keys(frameworkData.subjectStatus).join(', ') || 'None'}`);
  console.log('='.repeat(60) + '\n');
  
  const destClient = new Client(dbConfig.destination);
  
  const insertStatements = [];
  const updateStatements = [];
  const deleteStatements = [];
  const summary = {
    totalInJson: 0,
    totalInDb: 0,
    matched: 0,
    toInsert: 0,
    toUpdate: 0,
    toDelete: 0,
    boardsChecked: []
  };

  try {
    await destClient.connect();
    console.log('[TAXONOMY SYNC] Connected to destination database');

    // Fetch all existing taxonomy data for this framework
    console.log('[TAXONOMY SYNC] Fetching existing taxonomy data...');
    const result = await destClient.query(`
      SELECT id, taxonomyid, taxonomy_name, taxonomy_description, 
             level1, level2, level3, level4, level5, status 
      FROM public.taxonomy
      WHERE taxonomyid = $1
    `, [frameworkName]);
    
    const dbRecords = result.rows;
    summary.totalInDb = dbRecords.length;
    console.log(`[TAXONOMY SYNC] Found ${dbRecords.length} records in database`);

    // Create a map of existing records for quick lookup
    const dbMap = new Map();
    for (const record of dbRecords) {
      const key = createKey(record.level1, record.level2, record.level3, record.level4);
      dbMap.set(key, record);
    }

    // Generate expected taxonomy from parsed API data
    const expectedRecords = generateExpectedTaxonomy(frameworkData);
    summary.totalInJson = expectedRecords.length;
    console.log(`[TAXONOMY SYNC] Expected ${expectedRecords.length} records from API`);

    // Compare and generate SQL statements
    console.log('\n[TAXONOMY SYNC] Comparing data board by board (matching by lowercase description)...\n');
    
    const processedBoards = new Set();
    const expectedKeys = new Set(); // Track all expected keys from API
    
    for (const expected of expectedRecords) {
      // Create key using lowercase descriptions
      const key = createKey(expected.level1, expected.level2, expected.level3, expected.level4);
      expectedKeys.add(key); // Add to expected keys set
      const existing = dbMap.get(key);
      
      // Track board processing (use display value for logging)
      if (!processedBoards.has(expected.level2)) {
        processedBoards.add(expected.level2);
        console.log(`\n📋 Checking Board: ${expected.level2Display}`);
        summary.boardsChecked.push({
          name: expected.level2Display,
          key: expected.level2,
          mediums: new Set(),
          subjects: new Set(),
          inserts: 0,
          updates: 0,
          matched: 0
        });
      }
      
      const boardSummary = summary.boardsChecked.find(b => b.key === expected.level2);
      boardSummary.mediums.add(expected.level3Display);
      boardSummary.subjects.add(expected.level4Display);
      
      if (!existing) {
        // Record doesn't exist - need to INSERT (use original descriptions from JSON for level values)
        // Format: Board - Grade - Medium - Subject
        const taxonomyName = `${expected.level2Display} - ${expected.level1Display} - ${expected.level3Display} - ${expected.level4Display}`;
        const insertSql = `INSERT INTO public.taxonomy (taxonomyid, taxonomy_name, taxonomy_description, level1, level2, level3, level4, level5, status) VALUES ('${frameworkName}', '${escapeSql(taxonomyName)}', '${escapeSql(taxonomyName)}', '${escapeSql(expected.level1Display)}', '${escapeSql(expected.level2Display)}', '${escapeSql(expected.level3Display)}', '${escapeSql(expected.level4Display)}', NULL, '${expected.status}');`;
        
        insertStatements.push({
          sql: insertSql,
          board: expected.level2Display,
          medium: expected.level3Display,
          grade: expected.level1Display,
          subject: expected.level4Display
        });
        
        summary.toInsert++;
        boardSummary.inserts++;
        console.log(`  ➕ NEW: ${expected.level3Display} > ${expected.level1Display} > ${expected.level4Display}`);
      } else {
        // Record exists - check if status needs update
        if (existing.status !== expected.status) {
          const updateSql = `UPDATE public.taxonomy SET status = '${expected.status}' WHERE id = ${existing.id};`;
          
          updateStatements.push({
            sql: updateSql,
            id: existing.id,
            board: expected.level2Display,
            medium: expected.level3Display,
            grade: expected.level1Display,
            subject: expected.level4Display,
            oldStatus: existing.status,
            newStatus: expected.status
          });
          
          summary.toUpdate++;
          boardSummary.updates++;
          console.log(`  🔄 UPDATE: ${expected.level3Display} > ${expected.level1Display} > ${expected.level4Display} (${existing.status} → ${expected.status})`);
        } else {
          summary.matched++;
          boardSummary.matched++;
        }
      }
    }

    // Check for retired boards (records that exist in DB but board is retired in JSON)
    // Compare using lowercase descriptions
    console.log('\n[TAXONOMY SYNC] Checking for retired boards...');
    for (const board of frameworkData.boards) {
      if (board.status === 'Retired') {
        console.log(`  ⚠️ Board "${board.description}" is RETIRED in JSON`);
        const boardDescLower = (board.description || '').toLowerCase();
        
        // Find all records for this board in DB and mark them as retired
        for (const [key, record] of dbMap) {
          const dbBoardDescLower = (record.level2 || '').toLowerCase();
          if (dbBoardDescLower === boardDescLower && record.status !== 'Retired') {
            const updateSql = `UPDATE public.taxonomy SET status = 'Retired' WHERE id = ${record.id}; -- Board retired: ${board.description}`;
            
            updateStatements.push({
              sql: updateSql,
              id: record.id,
              board: board.description,
              medium: record.level3,
              grade: record.level1,
              subject: record.level4,
              oldStatus: record.status,
              newStatus: 'Retired',
              reason: 'Board retired'
            });
            
            summary.toUpdate++;
            console.log(`    🔄 Retiring: ${record.level3} > ${record.level1} > ${record.level4}`);
          }
        }
      }
    }

    // Check for records that exist in DB but not in API (should be deleted)
    console.log('\n[TAXONOMY SYNC] Checking for records in DB but not in API...');
    for (const [key, record] of dbMap) {
      if (!expectedKeys.has(key)) {
        // This record exists in DB but not in API response - mark for deletion
        const deleteSql = `DELETE FROM public.taxonomy WHERE id = ${record.id}; -- Not found in API: ${record.level2} - ${record.level1} - ${record.level3} - ${record.level4}`;
        
        deleteStatements.push({
          sql: deleteSql,
          id: record.id,
          board: record.level2,
          medium: record.level3,
          grade: record.level1,
          subject: record.level4,
          taxonomyName: record.taxonomy_name,
          reason: 'Not present in API response'
        });
        
        summary.toDelete++;
        console.log(`  🗑️  DELETE: ${record.level2} > ${record.level3} > ${record.level1} > ${record.level4}`);
      }
    }

    // Generate output files (as logs)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = path.join(__dirname, 'taxonomy-scripts');
    
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir);
    }

    // Write INSERT script (as log)
    if (insertStatements.length > 0) {
      const insertFile = path.join(outputDir, `taxonomy-insert-${timestamp}.sql`);
      let insertContent = `-- Taxonomy INSERT Script (LOG)\n-- Generated: ${new Date().toISOString()}\n-- Total records to insert: ${insertStatements.length}\n-- Status: EXECUTED\n\n`;
      
      // Group by board
      const groupedInserts = {};
      for (const stmt of insertStatements) {
        if (!groupedInserts[stmt.board]) {
          groupedInserts[stmt.board] = [];
        }
        groupedInserts[stmt.board].push(stmt);
      }
      
      for (const [board, stmts] of Object.entries(groupedInserts)) {
        insertContent += `\n-- Board: ${board} (${stmts.length} records)\n`;
        for (const stmt of stmts) {
          insertContent += stmt.sql + '\n';
        }
      }
      
      fs.writeFileSync(insertFile, insertContent);
      console.log(`\n📄 INSERT script logged to: ${insertFile}`);
    }

    // Write UPDATE script (as log)
    if (updateStatements.length > 0) {
      const updateFile = path.join(outputDir, `taxonomy-update-${timestamp}.sql`);
      let updateContent = `-- Taxonomy UPDATE Script (LOG)\n-- Generated: ${new Date().toISOString()}\n-- Total records to update: ${updateStatements.length}\n-- Status: EXECUTED\n\n`;
      
      for (const stmt of updateStatements) {
        updateContent += `-- ${stmt.board} > ${stmt.medium} > ${stmt.grade} > ${stmt.subject} (${stmt.oldStatus} → ${stmt.newStatus})\n`;
        updateContent += stmt.sql + '\n\n';
      }
      
      fs.writeFileSync(updateFile, updateContent);
      console.log(`📄 UPDATE script logged to: ${updateFile}`);
    }

    // Write DELETE script (as log)
    if (deleteStatements.length > 0) {
      const deleteFile = path.join(outputDir, `taxonomy-delete-${timestamp}.sql`);
      let deleteContent = `-- Taxonomy DELETE Script (LOG)\n-- Generated: ${new Date().toISOString()}\n-- Total records to delete: ${deleteStatements.length}\n-- Status: EXECUTED\n-- Reason: Records exist in DB but not in API response\n\n`;
      
      for (const stmt of deleteStatements) {
        deleteContent += `-- ${stmt.board} > ${stmt.medium} > ${stmt.grade} > ${stmt.subject}\n`;
        deleteContent += `-- Taxonomy Name: ${stmt.taxonomyName}\n`;
        deleteContent += stmt.sql + '\n\n';
      }
      
      fs.writeFileSync(deleteFile, deleteContent);
      console.log(`📄 DELETE script logged to: ${deleteFile}`);
    }

    // Execute INSERT statements directly in database
    if (insertStatements.length > 0) {
      console.log('\n[TAXONOMY SYNC] 🚀 Executing INSERT statements...');
      let insertSuccess = 0;
      let insertFailed = 0;
      
      for (const stmt of insertStatements) {
        try {
          await destClient.query(stmt.sql);
          insertSuccess++;
          console.log(`  ✅ Inserted: ${stmt.board} - ${stmt.grade} - ${stmt.medium} - ${stmt.subject}`);
        } catch (err) {
          insertFailed++;
          console.error(`  ❌ Failed to insert: ${stmt.board} - ${stmt.grade} - ${stmt.medium} - ${stmt.subject}`);
          console.error(`     Error: ${err.message}`);
        }
      }
      
      console.log(`[TAXONOMY SYNC] INSERT completed: ${insertSuccess} success, ${insertFailed} failed`);
    }

    // Execute UPDATE statements directly in database
    if (updateStatements.length > 0) {
      console.log('\n[TAXONOMY SYNC] 🚀 Executing UPDATE statements...');
      let updateSuccess = 0;
      let updateFailed = 0;
      
      for (const stmt of updateStatements) {
        try {
          await destClient.query(stmt.sql);
          updateSuccess++;
          console.log(`  ✅ Updated: ${stmt.board} - ${stmt.grade} - ${stmt.medium} - ${stmt.subject} (${stmt.oldStatus} → ${stmt.newStatus})`);
        } catch (err) {
          updateFailed++;
          console.error(`  ❌ Failed to update: ${stmt.board} - ${stmt.grade} - ${stmt.medium} - ${stmt.subject}`);
          console.error(`     Error: ${err.message}`);
        }
      }
      
      console.log(`[TAXONOMY SYNC] UPDATE completed: ${updateSuccess} success, ${updateFailed} failed`);
    }

    // Execute DELETE statements directly in database
    if (deleteStatements.length > 0) {
      console.log('\n[TAXONOMY SYNC] 🚀 Executing DELETE statements...');
      let deleteSuccess = 0;
      let deleteFailed = 0;
      
      for (const stmt of deleteStatements) {
        try {
          await destClient.query(stmt.sql);
          deleteSuccess++;
          console.log(`  ✅ Deleted: ${stmt.board} - ${stmt.grade} - ${stmt.medium} - ${stmt.subject}`);
        } catch (err) {
          deleteFailed++;
          console.error(`  ❌ Failed to delete: ${stmt.board} - ${stmt.grade} - ${stmt.medium} - ${stmt.subject}`);
          console.error(`     Error: ${err.message}`);
        }
      }
      
      console.log(`[TAXONOMY SYNC] DELETE completed: ${deleteSuccess} success, ${deleteFailed} failed`);
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('                    SYNC SUMMARY');
    console.log('='.repeat(60));
    console.log(`🎯 Framework:                 ${frameworkName}`);
    console.log(`📊 Total records in API:      ${summary.totalInJson}`);
    console.log(`📊 Total records in Database: ${summary.totalInDb}`);
    console.log(`✅ Matched (no changes):      ${summary.matched}`);
    console.log(`➕ INSERTED (new records):    ${summary.toInsert}`);
    console.log(`🔄 UPDATED (status change):   ${summary.toUpdate}`);
    console.log(`🗑️  DELETED (not in API):     ${summary.toDelete}`);
    console.log('='.repeat(60));
    
    console.log('\n📋 Board-wise Summary:');
    console.log('-'.repeat(80));
    console.log('Board Name'.padEnd(40) + 'Mediums'.padEnd(10) + 'Subjects'.padEnd(10) + 'New'.padEnd(8) + 'Update'.padEnd(8) + 'OK');
    console.log('-'.repeat(80));
    
    for (const board of summary.boardsChecked) {
      console.log(
        board.name.padEnd(40) + 
        String(board.mediums.size).padEnd(10) + 
        String(board.subjects.size).padEnd(10) + 
        String(board.inserts).padEnd(8) + 
        String(board.updates).padEnd(8) + 
        String(board.matched)
      );
    }
    console.log('-'.repeat(80));

    if (summary.toInsert === 0 && summary.toUpdate === 0 && summary.toDelete === 0) {
      console.log('\n✅ Database is already in sync with API. No changes needed!');
    } else {
      console.log(`\n✅ Database sync completed!`);
      console.log(`📄 SQL logs saved to: ${outputDir}`);
    }

  } catch (error) {
    console.error('[TAXONOMY SYNC] ❌ Error during sync:', error);
    throw error;
  } finally {
    await destClient.end();
    console.log('\n[TAXONOMY SYNC] Disconnected from database');
  }
  
  console.log('=== COMPLETED TAXONOMY SYNC ===');
}

// Run the sync only if this script is run directly
if (require.main === module) {
  console.log('Running taxonomy-sync.js directly');
  console.log(`\n🎯 Frameworks to sync: ${FRAMEWORK_NAMES.join(', ')}\n`);
  
  // Run sync for all frameworks one by one
  (async () => {
    for (let i = 0; i < FRAMEWORK_NAMES.length; i++) {
      const frameworkName = FRAMEWORK_NAMES[i];
      console.log('\n' + '═'.repeat(80));
      console.log(`    SYNCING FRAMEWORK ${i + 1}/${FRAMEWORK_NAMES.length}: ${frameworkName}`);
      console.log('═'.repeat(80) + '\n');
      
      try {
        await syncTaxonomy(frameworkName);
        console.log(`\n✅ Successfully completed sync for: ${frameworkName}`);
      } catch (err) {
        console.error(`\n❌ Failed to sync framework: ${frameworkName}`);
        console.error('Error:', err);
        // Continue with next framework even if one fails
      }
      
      // Add a delay between frameworks to avoid overwhelming the API
      if (i < FRAMEWORK_NAMES.length - 1) {
        console.log('\nWaiting 2 seconds before next framework...\n');
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
    
    console.log('\n' + '═'.repeat(80));
    console.log('    ALL FRAMEWORKS SYNC COMPLETED');
    console.log('═'.repeat(80));
  })().catch(err => {
    console.error('Taxonomy sync process failed:', err);
    process.exit(1);
  });
} else {
  console.log('taxonomy-sync.js loaded as a module');
}

module.exports = {
  syncTaxonomy,
  generateExpectedTaxonomy,
  fetchFrameworkData,
  parseFrameworkData
};

