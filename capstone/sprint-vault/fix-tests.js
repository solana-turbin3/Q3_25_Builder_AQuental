#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Function to fix test files
function fixTestFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;

  // Fix 1: Import BN if not imported
  if (!content.includes('import { BN }') && !content.includes('import BN from')) {
    const anchorImportRegex = /import \* as anchor from "@coral-xyz\/anchor";/;
    if (anchorImportRegex.test(content)) {
      content = content.replace(anchorImportRegex, 
        'import * as anchor from "@coral-xyz/anchor";\nimport { BN } from "@coral-xyz/anchor";');
      modified = true;
      console.log(`Fixed BN import in ${filePath}`);
    }
  }

  // Fix 2: Fix createSprint method calls - wrong parameter order
  // Old order: sprintId, amount, duration, acceleration, startTime
  // New order: sprintId, startTime, duration, amount, acceleration
  const createSprintPattern = /\.createSprint\s*\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\s*\)/g;
  
  const matches = [...content.matchAll(createSprintPattern)];
  if (matches.length > 0) {
    matches.forEach(match => {
      const [fullMatch, param1, param2, param3, param4, param5] = match;
      
      // Check if this looks like the wrong order (if param2 looks like an amount)
      if (param2.includes('Amount') || param2.includes('USDC') || param2.includes('new BN')) {
        // Wrong order detected, reorder to: sprintId, startTime, duration, amount, acceleration
        const newCall = `.createSprint(${param1}, ${param5}, ${param3}, ${param2}, ${param4})`;
        content = content.replace(fullMatch, newCall);
        modified = true;
        console.log(`Fixed createSprint parameter order in ${filePath}`);
      }
    });
  }

  // Fix 3: Convert numeric literals to BN
  // Replace startTime values that aren't wrapped in BN
  content = content.replace(/new BN\(startTime\)/g, 'new BN(startTime)');
  
  // Fix 4: Convert duration and acceleration enums to objects
  content = content.replace(/SprintDuration\.OneWeek(?!\s*\))/g, 'toDurationObject(SprintDuration.OneWeek)');
  content = content.replace(/SprintDuration\.TwoWeeks(?!\s*\))/g, 'toDurationObject(SprintDuration.TwoWeeks)');
  content = content.replace(/SprintDuration\.ThreeWeeks(?!\s*\))/g, 'toDurationObject(SprintDuration.ThreeWeeks)');
  content = content.replace(/SprintDuration\.FourWeeks(?!\s*\))/g, 'toDurationObject(SprintDuration.FourWeeks)');
  
  content = content.replace(/AccelerationType\.Linear(?!\s*\))/g, 'toAccelerationObject(AccelerationType.Linear)');
  content = content.replace(/AccelerationType\.Quadratic(?!\s*\))/g, 'toAccelerationObject(AccelerationType.Quadratic)');
  content = content.replace(/AccelerationType\.Cubic(?!\s*\))/g, 'toAccelerationObject(AccelerationType.Cubic)');

  // Fix 5: Ensure helper functions are imported
  if ((content.includes('toDurationObject') || content.includes('toAccelerationObject')) && 
      !content.includes('import { toDurationObject') && 
      !content.includes('import { toAccelerationObject')) {
    // Add the import
    const importPattern = /from ['"]\.\/utils\/test-helpers['"];?/;
    if (importPattern.test(content)) {
      content = content.replace(importPattern, (match) => {
        return `, toDurationObject, toAccelerationObject${match}`;
      });
      modified = true;
    }
  }

  // Fix 6: Replace endTime calculations with duration objects
  content = content.replace(/const endTime = startTime \+ [^;]+;/g, (match) => {
    return '// ' + match + ' // Replaced with duration enum';
  });

  if (modified) {
    fs.writeFileSync(filePath, content);
    console.log(`Fixed ${filePath}`);
  }

  return modified;
}

// Find all test files
function findTestFiles(dir) {
  const files = [];
  const items = fs.readdirSync(dir);

  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);

    if (stat.isDirectory() && item !== 'node_modules' && item !== 'target') {
      files.push(...findTestFiles(fullPath));
    } else if (stat.isFile() && (item.endsWith('.test.ts') || item.endsWith('test.ts') || item.endsWith('tests.ts'))) {
      files.push(fullPath);
    }
  }

  return files;
}

// Main execution
const testsDir = path.join(__dirname, 'tests');
const testFiles = findTestFiles(testsDir);

console.log(`Found ${testFiles.length} test files to fix...`);

let fixedCount = 0;
for (const file of testFiles) {
  if (fixTestFile(file)) {
    fixedCount++;
  }
}

console.log(`Fixed ${fixedCount} test files`);
