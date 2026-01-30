#!/usr/bin/env node

const fs = require('fs');
const yaml = require('yaml');
const path = require('path');
const { execSync } = require('child_process');
const debug = false; // Set to true to see deletion logs

// Read and parse YAML config
const config = yaml.parse(fs.readFileSync('hackathon_config.yaml', 'utf8'));

// Get repository name from git
function getRepoName() {
  try {
    const remoteUrl = execSync('git remote get-url origin', {
      encoding: 'utf8',
    }).trim();
    // Extract repo name from URL (works for both HTTPS and SSH)
    const match = remoteUrl.match(/\/([^\/]+?)(?:\.git)?$/);
    return match ? match[1] : path.basename(process.cwd());
  } catch (error) {
    // Fallback to directory name if git command fails
    return path.basename(process.cwd());
  }
}

// Add repository name to config
config.repo_name = getRepoName();

// Add calculated fields for template processing
if (config.judging_criteria) {
  config.judging_criteria.forEach((criteria, index) => {
    criteria.weight_decimal = (criteria.weight / 100).toFixed(2);
    criteria.loop = { index: index + 1 };
  });
}

// Helper function to replace template variables
function replaceTemplateVars(content, data) {
  return content.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const keys = key.trim().split('.');
    let value = data;
    for (const k of keys) {
      if (value === undefined || value === null) {
        return match; // Return original if path doesn't exist
      }
      value = value[k];
    }
    return value !== undefined && value !== null ? value : match;
  });
}

// Helper function to process conditionals within a specific context (for loops)
function processConditionalsInContext(content, itemName, item) {
  return content.replace(
    /\{%\s*if\s+([^%]+)\s*%\}([\s\S]*?)(?:\{%\s*else\s*%\}([\s\S]*?))?\{%\s*endif\s*%\}/g,
    (match, condition, ifContent, elseContent = '') => {
      const trimmedCondition = condition.trim();
      
      // Check if condition references the loop item (e.g., phase.duration)
      if (trimmedCondition.startsWith(itemName + '.')) {
        const propertyPath = trimmedCondition.substring(itemName.length + 1);
        const keys = propertyPath.split('.');
        let value = item;
        for (const k of keys) {
          if (value === undefined || value === null) {
            return elseContent;
          }
          value = value[k];
        }
        const isTruthy = value !== undefined && value !== null && value !== '' && value !== false;
        return isTruthy ? ifContent : elseContent;
      }
      
      // Return original match for non-loop-item conditions (will be processed later)
      return match;
    }
  );
}

// Helper function to process template loops
function processTemplateLoops(content, data) {
  return content.replace(
    /\{%\s*for\s+(\w+)\s+in\s+([^%]+)\s*%\}([\s\S]*?)\{%\s*endfor\s*%\}/g,
    (match, itemName, collectionPath, template) => {
      const keys = collectionPath.trim().split('.');
      let collection = data;
      for (const k of keys) {
        if (collection === undefined || collection === null) {
          return ''; // Return empty string if collection doesn't exist
        }
        collection = collection[k];
      }

      if (!Array.isArray(collection)) {
        return ''; // Return empty string if not an array
      }

      return collection
        .map((item, index) => {
          let result = template;
          
          // Process conditionals within the loop context first
          result = processConditionalsInContext(result, itemName, item);
          
          // Replace simple item reference (for string values)
          result = result.replace(new RegExp(`{{${itemName}}}`, 'g'), item);
          // Replace item properties (for object values)
          result = result.replace(
            new RegExp(`{{${itemName}\\.([^}]+)}}`, 'g'),
            (m, key) => {
              const value = item[key.trim()];
              return value !== undefined && value !== null ? value : m;
            }
          );
          // Replace loop properties
          result = result.replace(/{{loop\.index}}/g, index + 1);
          return result;
        })
        .join('');
    }
  );
}

// Helper function to get nested value from data object
function getNestedValue(data, varPath) {
  const keys = varPath.trim().split('.');
  let value = data;
  for (const k of keys) {
    if (value === undefined || value === null) {
      return undefined;
    }
    value = value[k];
  }
  return value;
}

// Helper function to process template conditionals
function processTemplateConditionals(content, data) {
  return content.replace(
    /\{%\s*if\s+([^%]+)\s*%\}([\s\S]*?)(?:\{%\s*else\s*%\}([\s\S]*?))?\{%\s*endif\s*%\}/g,
    (match, condition, ifContent, elseContent = '') => {
      const trimmedCondition = condition.trim();
      
      // Check for equality condition (e.g., theme.type == 'specific')
      const equalityMatch = trimmedCondition.match(/^(.+?)\s*==\s*['"](.+?)['"]$/);
      if (equalityMatch) {
        const [, varPath, expectedValue] = equalityMatch;
        const value = getNestedValue(data, varPath);
        return value === expectedValue ? ifContent : elseContent;
      }

      // Check for truthiness condition (e.g., phase.duration, contact.additional_info)
      const value = getNestedValue(data, trimmedCondition);
      const isTruthy = value !== undefined && value !== null && value !== '' && value !== false;
      return isTruthy ? ifContent : elseContent;
    }
  );
}

// Update README
function updateReadme() {
  const template = fs.readFileSync('template_README', 'utf8');
  let content = template;

  // Process conditionals first
  content = processTemplateConditionals(content, config);

  // Process loops
  content = processTemplateLoops(content, config);

  // Then replace simple variables
  content = replaceTemplateVars(content, config);

  fs.writeFileSync('README.md', content);
}

// Update Rubric
function updateRubric() {
  const template = fs.readFileSync('template_hackathon-rating-rubric', 'utf8');
  let content = template;

  // Process conditionals first
  content = processTemplateConditionals(content, config);

  // Process loops
  content = processTemplateLoops(content, config);

  // Then replace simple variables
  content = replaceTemplateVars(content, config);

  fs.writeFileSync('hackathon-rating-rubric.md', content);
}

// Update Thought Starters
function updateThoughtStarters() {
  const template = fs.readFileSync('template_Thought_Starters', 'utf8');
  let content = template;

  // Process conditionals first
  content = processTemplateConditionals(content, config);

  // Process loops
  content = processTemplateLoops(content, config);

  // Then replace simple variables
  content = replaceTemplateVars(content, config);

  fs.writeFileSync('Thought_Starters.md', content);
}

// Update Evaluation Template
function updateEvaluation() {
  const template = fs.readFileSync('template_evaluation', 'utf8');
  let content = template;

  // Process conditionals first
  content = processTemplateConditionals(content, config);

  // Process loops
  content = processTemplateLoops(content, config);

  // Then replace simple variables
  content = replaceTemplateVars(content, config);

  fs.writeFileSync('evaluation_template.md', content);
}

// Cleanup function
function cleanup() {
  try {
    // Delete template files
    const templateFiles = [
      'template_README',
      'template_hackathon-rating-rubric',
      'template_Thought_Starters',
      'template_evaluation',
    ];

    templateFiles.forEach((file) => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        if (debug) console.log(`Deleted: ${file}`);
      }
    });

    // Delete config file
    if (fs.existsSync('hackathon_config.yaml')) {
      fs.unlinkSync('hackathon_config.yaml');
      if (debug) console.log('Deleted: hackathon_config.yaml');
    }

    // Delete node_modules folder
    if (fs.existsSync('node_modules')) {
      fs.rmSync('node_modules', { recursive: true, force: true });
      if (debug) console.log('Deleted: node_modules');
    }

    // Delete any package files
    const packageFiles = [
      'package.json',
      'package-lock.json',
      'yarn.lock',
      'pnpm-lock.yaml',
    ];

    packageFiles.forEach((file) => {
      if (fs.existsSync(file)) {
        fs.unlinkSync(file);
        if (debug) console.log(`Deleted: ${file}`);
      }
    });

    // Delete .gitignore file
    if (fs.existsSync('.gitignore')) {
      fs.unlinkSync('.gitignore');
      if (debug) console.log('Deleted: .gitignore');
    }

    // Delete .github folder
    if (fs.existsSync('.github')) {
      fs.rmSync('.github', { recursive: true, force: true });
      if (debug) console.log('Deleted: .github');
    }

    // Delete this script itself (last action)
    if (fs.existsSync(__filename)) {
      fs.unlinkSync(__filename);
      if (debug) console.log(`Deleted: ${path.basename(__filename)}`);
    }
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
  console.log('Cleanup complete!');
}

// Main execution
try {
  console.log('Updating template files...');
  updateReadme();
  updateRubric();
  updateThoughtStarters();
  updateEvaluation();
  console.log('Template files updated successfully!');

  // Clean up template files, config, and script
  console.log('Cleaning up...');
  // cleanup();
  console.log('Agora hackathon project is ready for your event!');
} catch (error) {
  console.error('Error updating templates:', error);
  process.exit(1);
}
