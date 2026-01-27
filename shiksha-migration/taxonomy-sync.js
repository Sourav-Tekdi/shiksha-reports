const { Client } = require('pg');
const axios = require('axios');
const path = require('path');
const fs = require('fs');
const dbConfig = require('./db');

console.log('=== Taxonomy Sync with INTERSECTION Logic ===');

// Configuration
const FRAMEWORK_NAME = 'scp-framework';
const API_URL = `https://lap.prathamdigital.org/api/framework/v1/read/${FRAMEWORK_NAME}?categories=board,gradeLevel,subject,medium`;

// Helper functions
function findByIdentifier(items, identifier) {
  return items.find(item => item.identifier === identifier);
}

function escapeSql(str) {
  if (!str) return '';
  return str.toString().replace(/'/g, "''");
}

async function syncTaxonomy() {
  const destClient = new Client(dbConfig.destination);
  
  try {
    console.log('\n🚀 STARTING TAXONOMY SYNC');
    console.log('Framework:', FRAMEWORK_NAME);
    
    // Fetch from API
    console.log('\n📡 Fetching data from API...');
    const response = await axios.get(API_URL);
    const categories = response.data.result.framework.categories;

    const boards = categories.find(c => c.code === 'board')?.terms || [];
    const mediums = categories.find(c => c.code === 'medium')?.terms || [];
    const grades = categories.find(c => c.code === 'gradeLevel')?.terms || [];
    const subjects = categories.find(c => c.code === 'subject')?.terms || [];

    console.log(`✓ ${boards.length} boards, ${mediums.length} mediums, ${grades.length} grades, ${subjects.length} subjects`);

    // Connect to DB
    await destClient.connect();
    console.log('✓ Connected to database\n');

    // Fetch existing
    const result = await destClient.query(`SELECT id, level1, level2, level3, level4, status FROM taxonomy WHERE taxonomyid = $1`, [FRAMEWORK_NAME]);
    const existingRecords = result.rows;
    const existingMap = new Map();
    for (const r of existingRecords) {
      existingMap.set(`${r.level1}|${r.level2}|${r.level3}|${r.level4}`, r);
    }

    console.log(`Found ${existingRecords.length} existing records\n`);

    // Generate expected with INTERSECTION logic
    const expectedRecords = [];
    const expectedKeys = new Set();

    for (const board of boards) {
      if (board.status === 'Retired') continue;
      
      const boardAssocs = Array.isArray(board.associations) ? board.associations : [];
      const boardMediums = boardAssocs.filter(a => a?.category === 'medium' && a.status === 'Live');
      const boardSubjects = boardAssocs.filter(a => a?.category === 'subject' && a.status === 'Live');

      console.log(`📋 ${board.name}: ${boardMediums.length} mediums, ${boardSubjects.length} subjects`);

      for (const boardMedium of boardMediums) {
        const medium = findByIdentifier(mediums, boardMedium.identifier);
        if (!medium || medium.status === 'Retired') continue;

        const mediumAssocs = Array.isArray(medium.associations) ? medium.associations : [];
        const mediumSubjects = mediumAssocs.filter(a => a?.category === 'subject' && a.status === 'Live');

        // INTERSECTION: Board ∩ Medium
        const matchedSubjects = mediumSubjects.filter(ms => 
          boardSubjects.some(bs => bs.identifier === ms.identifier)
        );

        console.log(`  ${medium.name}: ${matchedSubjects.length} matched subjects`);

        for (const grade of grades) {
          if (grade.status === 'Retired') continue;

          const gradeAssocs = Array.isArray(grade.associations) ? grade.associations : [];
          const gradeSubjects = gradeAssocs.filter(a => a?.category === 'subject' && a.status === 'Live');

          // FINAL INTERSECTION: (Board ∩ Medium) ∩ Grade
          const finalSubjects = matchedSubjects.filter(ms => 
            gradeSubjects.some(gs => gs.identifier === ms.identifier)
          );

          for (const subjectAssoc of finalSubjects) {
            const subject = findByIdentifier(subjects, subjectAssoc.identifier);
            if (!subject || subject.status === 'Retired') continue;

            expectedRecords.push({
              level1: grade.name,
              level2: board.name,
              level3: medium.name,
              level4: subject.name,
              status: subject.status
            });

            expectedKeys.add(`${grade.name}|${board.name}|${medium.name}|${subject.name}`);
          }
        }
      }
    }

    console.log(`\n✓ Generated ${expectedRecords.length} expected records\n`);

    // Compare
    const insertStatements = [];
    const deleteStatements = [];
    let matchedCount = 0;

    for (const exp of expectedRecords) {
      const key = `${exp.level1}|${exp.level2}|${exp.level3}|${exp.level4}`;
      if (!existingMap.has(key)) {
        const name = `${exp.level2} - ${exp.level1} - ${exp.level3} - ${exp.level4}`;
        const sql = `INSERT INTO taxonomy (taxonomyid, taxonomy_name, taxonomy_description, level1, level2, level3, level4, level5, status) VALUES ('${FRAMEWORK_NAME}', '${escapeSql(name)}', '${escapeSql(name)}', '${escapeSql(exp.level1)}', '${escapeSql(exp.level2)}', '${escapeSql(exp.level3)}', '${escapeSql(exp.level4)}', NULL, '${exp.status}');`;
        insertStatements.push({ sql, ...exp });
        console.log(`➕ ${exp.level2} > ${exp.level3} > ${exp.level1} > ${exp.level4}`);
      } else {
        matchedCount++;
      }
    }

    for (const [key, record] of existingMap) {
      if (!expectedKeys.has(key)) {
        const sql = `DELETE FROM taxonomy WHERE id = ${record.id};`;
        deleteStatements.push({ sql, ...record });
        console.log(`🗑️  ${record.level2} > ${record.level3} > ${record.level1} > ${record.level4}`);
      }
    }

    // Save SQL files
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputDir = path.join(__dirname, 'taxonomy-scripts');
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir);

    if (insertStatements.length > 0) {
      let content = `-- INSERT for ${FRAMEWORK_NAME}\n-- ${insertStatements.length} records\n\n`;
      insertStatements.forEach(s => { content += s.sql + '\n'; });
      fs.writeFileSync(path.join(outputDir, `taxonomy-insert-${timestamp}.sql`), content);
      console.log(`\n✓ INSERT script saved`);
    }

    if (deleteStatements.length > 0) {
      let content = `-- DELETE for ${FRAMEWORK_NAME}\n-- ${deleteStatements.length} records\n\n`;
      deleteStatements.forEach(s => { content += s.sql + '\n'; });
      fs.writeFileSync(path.join(outputDir, `taxonomy-delete-${timestamp}.sql`), content);
      console.log(`✓ DELETE script saved`);
    }

    console.log('\n' + '='.repeat(60));
    console.log(`Expected: ${expectedRecords.length} | DB: ${existingRecords.length} | Matched: ${matchedCount}`);
    console.log(`To Insert: ${insertStatements.length} | To Delete: ${deleteStatements.length}`);
    console.log('='.repeat(60));

    console.log('\n✅ Sync completed!');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    throw error;
  } finally {
    await destClient.end();
  }
}

if (require.main === module) {
  syncTaxonomy().then(() => process.exit(0)).catch(err => { console.error(err); process.exit(1); });
}

module.exports = { syncTaxonomy };
