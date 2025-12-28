#!/usr/bin/env node

/**
 * 快速测试脚本
 * 用于在开发过程中快速运行特定测试
 */

const { spawn } = require('child_process');
const path = require('path');

const args = process.argv.slice(2);
const testType = args[0] || 'unit';

console.log('🧪 DocuSnap 快速测试工具\n');

if (testType === 'unit') {
  console.log('📦 运行单元测试...\n');
  const mocha = spawn('npx', [
    'mocha',
    '--require', 'ts-node/register',
    'test/unit/**/*.test.ts',
    '--color'
  ], {
    stdio: 'inherit',
    shell: true
  });

  mocha.on('close', (code) => {
    if (code === 0) {
      console.log('\n✅ 单元测试通过！');
    } else {
      console.log('\n❌ 单元测试失败！');
      process.exit(code);
    }
  });
} else if (testType === 'integration') {
  console.log('🔧 运行集成测试...\n');
  console.log('提示：集成测试需要启动 VSCode，可能需要较长时间。\n');
  
  const test = spawn('npm', ['test'], {
    stdio: 'inherit',
    shell: true
  });

  test.on('close', (code) => {
    if (code === 0) {
      console.log('\n✅ 集成测试通过！');
    } else {
      console.log('\n❌ 集成测试失败！');
      process.exit(code);
    }
  });
} else if (testType === 'all') {
  console.log('🚀 运行所有测试...\n');
  
  // 先运行单元测试
  const unit = spawn('npx', [
    'mocha',
    '--require', 'ts-node/register',
    'test/unit/**/*.test.ts',
    '--color'
  ], {
    stdio: 'inherit',
    shell: true
  });

  unit.on('close', (unitCode) => {
    if (unitCode !== 0) {
      console.log('\n❌ 单元测试失败！');
      process.exit(unitCode);
    }
    
    console.log('\n✅ 单元测试通过！');
    console.log('\n🔧 开始运行集成测试...\n');
    
    // 再运行集成测试
    const integration = spawn('npm', ['test'], {
      stdio: 'inherit',
      shell: true
    });

    integration.on('close', (integrationCode) => {
      if (integrationCode === 0) {
        console.log('\n✅ 所有测试通过！');
      } else {
        console.log('\n❌ 集成测试失败！');
        process.exit(integrationCode);
      }
    });
  });
} else {
  console.log('用法：');
  console.log('  node test/runQuickTest.js [unit|integration|all]');
  console.log('');
  console.log('选项：');
  console.log('  unit        - 仅运行单元测试（快速）');
  console.log('  integration - 仅运行集成测试（需要 VSCode）');
  console.log('  all         - 运行所有测试');
  console.log('');
  console.log('示例：');
  console.log('  node test/runQuickTest.js unit');
  console.log('  node test/runQuickTest.js all');
}
