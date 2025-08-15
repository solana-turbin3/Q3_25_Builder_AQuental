import * as fs from 'fs';
import * as path from 'path';

// Fix function to update createSprint calls to use correct parameter order and types
function fixCreateSprintCalls(content: string): string {
  // Fix parameter order: should be (sprintId, startTime, duration, amount, acceleration)
  const createSprintRegex = /\.createSprint\s*\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\s*\)/g;
  
  content = content.replace(createSprintRegex, (match, param1, param2, param3, param4, param5) => {
    // Check if params look wrong (if param2 is amount-like)
    if (param2.includes('amount') || param2.includes('BN') && !param2.includes('startTime')) {
      // Wrong order: sprintId, amount, duration, acceleration, startTime
      // Fix to: sprintId, startTime, duration, amount, acceleration
      return `.createSprint(${param1}, ${param5}, ${param3}, ${param2}, ${param4})`;
    }
    return match;
  });

  // Ensure duration and acceleration are wrapped with converter functions
  content = content.replace(/SprintDuration\.(\w+)(?![\s\)])/g, 'toDurationObject(SprintDuration.$1)');
  content = content.replace(/AccelerationType\.(\w+)(?![\s\)])/g, 'toAccelerationObject(AccelerationType.$1)');

  return content;
}

// Process test files
const testFiles = [
  './tests/fuzz-tests.ts',
  './tests/fuzz-tests-improved.ts',
  './tests/sprint-vault-fixed.ts',
  './tests/test_new_directives.ts',
];

testFiles.forEach(filePath => {
  if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    const updatedContent = fixCreateSprintCalls(content);
    
    if (content !== updatedContent) {
      fs.writeFileSync(filePath, updatedContent);
      console.log(`Fixed ${filePath}`);
    }
  }
});

console.log('Enum conversion fixes complete');
